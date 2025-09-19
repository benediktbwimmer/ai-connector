import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';

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

function ChatPage(): JSX.Element {
  const [models, setModels] = useState<GroupedModels>({});
  const [selectedProvider, setSelectedProvider] = useState<'ollama' | 'openai'>('ollama');
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
        if (!grouped[selectedProvider] || grouped[selectedProvider].length === 0) {
          const fallback = (Object.keys(grouped)[0] as 'ollama' | 'openai') ?? 'ollama';
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

  const handleSend = () => {
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

  const statusClass = socketReady ? 'status-dot online' : 'status-dot';

  return (
    <div className="card">
      <div className="flex-row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 className="section-title">Chat</h2>
        <div className="status-indicator">
          <span className={statusClass} />
          <span>{socketReady ? 'Connected' : 'Connecting...'}</span>
        </div>
      </div>
      <div className="chat-controls">
        <div className="flex-row">
          <div className="flex-1">
            <label htmlFor="provider">Provider</label>
            <select
              id="provider"
              value={selectedProvider}
              onChange={(event) => {
                const provider = event.target.value as 'ollama' | 'openai';
                setSelectedProvider(provider);
                const nextModel = models[provider]?.[0]?.model;
                if (nextModel) {
                  setSelectedModel(nextModel);
                }
              }}
            >
              <option value="ollama">Ollama (local)</option>
              <option value="openai">OpenAI</option>
            </select>
          </div>
          <div className="flex-1">
            <label htmlFor="model">Model</label>
            <select
              id="model"
              value={selectedModel}
              onChange={(event) => setSelectedModel(event.target.value)}
            >
              {modelOptions.map((model) => (
                <option key={`${model.provider}-${model.model}`} value={model.model}>
                  {model.display_name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="systemPrompt">System prompt</label>
          <textarea
            id="systemPrompt"
            value={systemPrompt}
            onChange={(event) => setSystemPrompt(event.target.value)}
          />
        </div>

        <div className="flex-row">
          <div className="flex-1">
            <label htmlFor="responseFormat">Response format</label>
            <select
              id="responseFormat"
              value={responseFormat}
              onChange={(event) => setResponseFormat(event.target.value as ResponseFormat)}
            >
              <option value="text">Freeform text</option>
              <option value="json_object">JSON object</option>
              <option value="json_schema">JSON schema</option>
            </select>
          </div>
          <div className="flex-1">
            <label>API base</label>
            <input value={API_BASE_URL} readOnly />
          </div>
        </div>

        {responseFormat === 'json_schema' && (
          <div>
            <label htmlFor="schema">JSON schema</label>
            <textarea
              id="schema"
              className="code-input"
              value={schemaText}
              onChange={(event) => setSchemaText(event.target.value)}
            />
          </div>
        )}

        <div>
          <label htmlFor="userInput">Message</label>
          <textarea
            id="userInput"
            value={userInput}
            onChange={(event) => setUserInput(event.target.value)}
            placeholder="Ask something..."
            rows={3}
          />
          <button onClick={handleSend} disabled={isStreaming || !userInput.trim()}>
            {isStreaming ? 'Streaming…' : 'Send'}
          </button>
        </div>
      </div>

      <div style={{ marginTop: '2rem' }}>
        <h3 className="section-title">Conversation</h3>
        {allMessages.map((message, idx) => (
          <div key={`${message.role}-${idx}`} className={`chat-message ${message.role}`}>
            <strong>{message.role.toUpperCase()}</strong>
            <div>{message.content || '(empty)'}</div>
          </div>
        ))}
      </div>

      {error && <div className="error">{error}</div>}
    </div>
  );
}

export default ChatPage;
