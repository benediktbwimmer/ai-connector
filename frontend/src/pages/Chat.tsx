import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, JSX } from 'react';

import { API_BASE_URL, apiGet, createWebSocket } from '../api';
import type { ChatCompletionChunk, ChatMessage, ModelInfo } from '../api';

interface GroupedModels {
  [provider: string]: ModelInfo[];
}

const DEFAULT_SYSTEM_PROMPT = 'You are a helpful assistant.';
const DEFAULT_SCHEMA = JSON.stringify(
  {
    type: 'object',
    properties: {
      tip: { type: 'string' },
    },
    required: ['tip'],
  },
  null,
  2,
);

type ResponseFormat = 'text' | 'json_object' | 'json_schema';

type ProviderKey = 'ollama' | 'openai';

function ChatPage(): JSX.Element {
  const [models, setModels] = useState<GroupedModels>({});
  const [selectedProvider, setSelectedProvider] = useState<ProviderKey>('ollama');
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [conversation, setConversation] = useState<ChatMessage[]>([]);
  const [userInput, setUserInput] = useState('');
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [streamContent, setStreamContent] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [socketReady, setSocketReady] = useState(false);
  const [responseFormat, setResponseFormat] = useState<ResponseFormat>('text');
  const [schemaText, setSchemaText] = useState(DEFAULT_SCHEMA);
  const [showComposerDetails, setShowComposerDetails] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<number | undefined>(undefined);
  const streamContentRef = useRef('');

  const modelOptions = useMemo(() => models[selectedProvider] ?? [], [models, selectedProvider]);

  useEffect(() => {
    apiGet<ModelInfo[]>('/models')
      .then((list) => {
        const grouped: GroupedModels = list.reduce((acc, model) => {
          if (!acc[model.provider]) {
            acc[model.provider] = [];
          }
          acc[model.provider].push(model);
          return acc;
        }, {} as GroupedModels);
        Object.values(grouped).forEach((group) => group.sort((a, b) => a.model.localeCompare(b.model)));
        setModels(grouped);
        const providerHasModels = grouped[selectedProvider]?.length;
        if (!providerHasModels) {
          const fallback = (Object.keys(grouped)[0] as ProviderKey | undefined) ?? 'ollama';
          setSelectedProvider(fallback);
          const first = grouped[fallback]?.[0]?.model;
          if (first) {
            setSelectedModel(first);
          }
        } else if (!selectedModel) {
          const first = grouped[selectedProvider]?.[0]?.model;
          if (first) {
            setSelectedModel(first);
          }
        }
      })
      .catch((err) => {
        console.error('Failed to load models', err);
        setError('Unable to load available models.');
      });
  }, [selectedModel, selectedProvider]);

  const handleMessage = useCallback((event: MessageEvent<string>) => {
    try {
      const payload = JSON.parse(event.data) as { type: string; data?: unknown };
      if (payload.type === 'chunk') {
        const chunk = payload.data as ChatCompletionChunk;
        if (chunk.delta) {
          if (typeof chunk.delta === 'string') {
            setStreamContent((prev) => prev + chunk.delta);
          } else if (typeof chunk.delta === 'object') {
            setStreamContent((prev) => prev + JSON.stringify(chunk.delta));
          }
        }
        if (chunk.done) {
          const finalText = streamContentRef.current || '(no content)';
          setConversation((prev) => [
            ...prev,
            {
              role: 'assistant',
              content: finalText,
            },
          ]);
          streamContentRef.current = '';
          setStreamContent('');
          setIsStreaming(false);
        }
      } else if (payload.type === 'done') {
        if (streamContentRef.current) {
          setConversation((prev) => [
            ...prev,
            { role: 'assistant', content: streamContentRef.current },
          ]);
        }
        streamContentRef.current = '';
        setStreamContent('');
        setIsStreaming(false);
      } else if (payload.type === 'error') {
        const detail = typeof payload.data === 'string' ? payload.data : 'Request failed';
        setError(detail);
        setIsStreaming(false);
        streamContentRef.current = '';
        setStreamContent('');
      }
    } catch (err) {
      console.error('Malformed WebSocket message', err);
    }
  }, []);

  useEffect(() => {
    streamContentRef.current = streamContent;
  }, [streamContent]);

  useEffect(() => {
    let cancelled = false;
    const connect = () => {
      if (cancelled) {
        return;
      }
      const ws = createWebSocket('/ws/chat');
      wsRef.current = ws;
      ws.onopen = () => {
        setSocketReady(true);
      };
      ws.onclose = () => {
        setSocketReady(false);
        if (!cancelled) {
          if (reconnectTimer.current) {
            clearTimeout(reconnectTimer.current);
          }
          reconnectTimer.current = window.setTimeout(connect, 1500);
        }
      };
      ws.onerror = () => {
        ws.close();
      };
      ws.onmessage = handleMessage;
    };
    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
      }
      wsRef.current?.close();
    };
  }, [handleMessage]);

  const allMessages = useMemo(() => {
    const systemMessage: ChatMessage = { role: 'system', content: systemPrompt };
    const streamMessage: ChatMessage | null = streamContent
      ? { role: 'assistant', content: streamContent }
      : null;
    return [systemMessage, ...conversation, ...(streamMessage ? [streamMessage] : [])];
  }, [conversation, streamContent, systemPrompt]);

  const sendMessage = () => {
    if (!userInput.trim()) {
      return;
    }
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setError('Chat connection not ready. Retrying...');
      return;
    }
    const pendingMessages = [
      ...conversation,
      { role: 'user' as const, content: userInput.trim() },
    ];
    const requestPayload: Record<string, unknown> = {
      provider: selectedProvider,
      model: selectedModel,
      messages: [
        { role: 'system', content: systemPrompt },
        ...pendingMessages,
      ],
    };
    if (responseFormat === 'json_object') {
      requestPayload.response_format = { type: 'json_object' };
    } else if (responseFormat === 'json_schema') {
      try {
        const parsed = JSON.parse(schemaText || '{}');
        requestPayload.response_format = {
          type: 'json_schema',
          json_schema: {
            name: 'structured_output',
            schema: parsed,
          },
        };
      } catch (err) {
        console.error('Invalid JSON schema', err);
        setError('Invalid JSON schema. Please fix before sending.');
        return;
      }
    }
    setConversation(pendingMessages);
    setUserInput('');
    setError(null);
    setStreamContent('');
    streamContentRef.current = '';
    setIsStreaming(true);
    wsRef.current.send(
      JSON.stringify({
        action: 'chat',
        request: requestPayload,
      }),
    );
  };

  useEffect(() => {
    if (modelOptions.length > 0 && !modelOptions.find((option) => option.model === selectedModel)) {
      setSelectedModel(modelOptions[0].model);
    }
  }, [modelOptions, selectedModel]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    sendMessage();
  };

  const statusClasses = socketReady
    ? 'h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_0_4px_rgba(16,185,129,0.15)]'
    : 'h-2.5 w-2.5 rounded-full bg-slate-600';

  const isEmptyState = conversation.length === 0 && !streamContent && !isStreaming;

  return (
    <div className="flex h-full flex-1 flex-col">
      <div className="flex flex-1 justify-center overflow-hidden">
        <div className="flex h-full w-full max-w-5xl flex-col px-4 pb-6 pt-8 sm:px-8">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/60 pb-6">
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-[0.4em] text-slate-500">Ask anything</p>
              <h1 className="text-2xl font-semibold text-slate-100 sm:text-3xl">Where should we begin?</h1>
            </div>
            <div className="flex items-center gap-3 rounded-full border border-slate-800/70 bg-slate-900/60 px-4 py-2 text-sm text-slate-400">
              <span className={statusClasses} />
              <span>{socketReady ? 'Connected' : 'Connecting…'}</span>
            </div>
          </div>

          <div className="flex flex-col gap-3 py-6 text-sm text-slate-300">
            <div className="flex flex-wrap items-center gap-3">
              {(['ollama', 'openai'] as ProviderKey[]).map((provider) => (
                <button
                  key={provider}
                  type="button"
                  onClick={() => {
                    setSelectedProvider(provider);
                    const nextModel = models[provider]?.[0]?.model;
                    if (nextModel) {
                      setSelectedModel(nextModel);
                    }
                  }}
                  className={`rounded-full border px-4 py-2 transition-colors ${
                    selectedProvider === provider
                      ? 'border-sky-400/60 bg-sky-500/10 text-sky-200'
                      : 'border-slate-800/70 bg-slate-900/50 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {provider === 'ollama' ? 'Ollama (local)' : 'OpenAI'}
                </button>
              ))}
              <div className="flex-1" />
              <div className="flex items-center gap-3 rounded-full border border-slate-800/70 bg-slate-900/60 px-4 py-2">
                <span className="text-xs uppercase tracking-[0.3em] text-slate-500">API</span>
                <span className="text-sm text-slate-300">{API_BASE_URL}</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="text-slate-400" htmlFor="model">
                Model
              </label>
              <select
                id="model"
                value={selectedModel}
                onChange={(event) => setSelectedModel(event.target.value)}
                className="w-full max-w-xs appearance-none rounded-full border border-slate-800/70 bg-slate-900/60 px-4 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
              >
                {modelOptions.map((model) => (
                  <option key={`${model.provider}-${model.model}`} value={model.model}>
                    {model.display_name}
                  </option>
                ))}
              </select>
              <label className="ml-auto text-slate-400" htmlFor="responseFormat">
                Format
              </label>
              <select
                id="responseFormat"
                value={responseFormat}
                onChange={(event) => setResponseFormat(event.target.value as ResponseFormat)}
                className="w-full max-w-[11rem] appearance-none rounded-full border border-slate-800/70 bg-slate-900/60 px-4 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
              >
                <option value="text">Freeform text</option>
                <option value="json_object">JSON object</option>
                <option value="json_schema">JSON schema</option>
              </select>
            </div>
          </div>

          <div className="relative flex-1 overflow-hidden rounded-3xl border border-slate-800/60 bg-slate-950/40 shadow-glow">
            <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-slate-950 via-slate-950/60 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-slate-950 via-slate-950/60 to-transparent" />
            <div className="relative h-full overflow-y-auto px-6 py-8 scrollbar-thin">
              {isEmptyState ? (
                <div className="flex h-full flex-col items-center justify-center gap-6 text-center text-slate-400">
                  <p className="max-w-lg text-balance text-base sm:text-lg">
                    Start the conversation by sharing a question or task. I'll keep things organized and respond as soon as a model is ready.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-6">
                  {allMessages.map((message, idx) => {
                    const isUser = message.role === 'user';
                    const isSystem = message.role === 'system';
                    return (
                      <div
                        key={`${message.role}-${idx}-${message.content?.slice(0, 12)}`}
                        className={`max-w-2xl rounded-3xl border px-6 py-4 text-sm leading-relaxed transition-colors ${
                          isSystem
                            ? 'border-slate-800/60 bg-slate-900/40 text-slate-400'
                            : isUser
                              ? 'ml-auto border-slate-300/70 bg-slate-100 text-slate-900 shadow-lg'
                              : 'border-slate-800/60 bg-slate-900/50 text-slate-200'
                        }`}
                      >
                        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">
                          {message.role}
                        </div>
                        <div className="whitespace-pre-wrap text-base">{message.content || '(empty)'}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="mt-6 rounded-3xl border border-slate-800/60 bg-slate-950/70 p-4 shadow-lg sm:p-6">
            <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
              <div className="rounded-2xl border border-slate-800/70 bg-slate-950/60 px-4 py-2 focus-within:border-sky-500">
                <label className="text-xs uppercase tracking-[0.3em] text-slate-500" htmlFor="userInput">
                  Give me something to think about
                </label>
                <textarea
                  id="userInput"
                  value={userInput}
                  onChange={(event) => setUserInput(event.target.value)}
                  placeholder="Ask anything…"
                  rows={3}
                  className="mt-2 w-full resize-none border-none bg-transparent text-base text-slate-100 outline-none placeholder:text-slate-500"
                />
              </div>
              {error && (
                <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                  {error}
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
                <button
                  type="button"
                  onClick={() => setShowComposerDetails((previous) => !previous)}
                  className="flex items-center gap-2 rounded-full border border-slate-800/70 bg-slate-900/60 px-4 py-2 text-xs uppercase tracking-[0.2em] text-slate-400 transition hover:text-slate-200"
                >
                  <span>{showComposerDetails ? 'Hide' : 'Show'} context</span>
                </button>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="submit"
                    disabled={isStreaming || !userInput.trim()}
                    className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-sky-400 via-sky-500 to-indigo-500 px-6 py-2 text-sm font-medium text-slate-950 transition hover:from-sky-300 hover:via-sky-400 hover:to-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isStreaming ? 'Streaming…' : 'Send'}
                  </button>
                </div>
              </div>
              {showComposerDetails && (
                <div className="grid gap-4 rounded-2xl border border-slate-800/60 bg-slate-950/60 p-4 text-sm text-slate-200">
                  <div className="grid gap-2">
                    <label className="text-xs uppercase tracking-[0.3em] text-slate-500" htmlFor="systemPrompt">
                      System prompt
                    </label>
                    <textarea
                      id="systemPrompt"
                      value={systemPrompt}
                      onChange={(event) => setSystemPrompt(event.target.value)}
                      rows={3}
                      className="min-h-[120px] w-full rounded-xl border border-slate-800/70 bg-slate-900/60 px-4 py-3 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                    />
                  </div>
                  {responseFormat === 'json_schema' && (
                    <div className="grid gap-2">
                      <label className="text-xs uppercase tracking-[0.3em] text-slate-500" htmlFor="schema">
                        JSON schema
                      </label>
                      <textarea
                        id="schema"
                        value={schemaText}
                        onChange={(event) => setSchemaText(event.target.value)}
                        className="min-h-[160px] w-full rounded-xl border border-slate-800/70 bg-slate-900/60 px-4 py-3 font-mono text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
                      />
                    </div>
                  )}
                </div>
              )}
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ChatPage;
