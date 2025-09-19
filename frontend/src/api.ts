export const API_BASE_URL = ((): string => {
  const envValue = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (envValue) {
    return envValue.replace(/\/$/, '');
  }
  const { origin } = window.location;
  return origin.replace(/\/$/, '');
})();

const jsonHeaders = {
  'Content-Type': 'application/json',
};

export async function apiGet<T>(path: string): Promise<T> {
  const url = new URL(path, API_BASE_URL).toString();
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GET ${path} failed (${response.status})`);
  }
  return (await response.json()) as T;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const url = new URL(path, API_BASE_URL).toString();
  const response = await fetch(url, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(body ?? {}),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `POST ${path} failed (${response.status})`);
  }
  return (await response.json()) as T;
}

export function createWebSocket(path: string): WebSocket {
  const base = new URL(path, API_BASE_URL);
  base.protocol = base.protocol.replace('http', 'ws');
  return new WebSocket(base.toString());
}

export interface ModelInfo {
  provider: 'openai' | 'ollama';
  model: string;
  display_name: string;
}

export interface SettingsResponse {
  openai_api_key_set: boolean;
  openai_base_url: string;
  profile_name: string;
  profile_email?: string | null;
}

export interface UsageSnapshot {
  totals: {
    requests: number;
    prompt_tokens: number;
    completion_tokens: number;
    prompt_chars: number;
    eval_count: number;
    cost_usd: number;
  };
  per_model: Record<
    string,
    {
      provider: string;
      model: string;
      requests: number;
      prompt_tokens: number;
      completion_tokens: number;
      prompt_chars: number;
      eval_count: number;
      cost_usd: number;
      last_updated: string;
    }
  >;
  last_updated: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface ChatCompletionChunk {
  provider: 'openai' | 'ollama';
  model: string;
  delta: unknown;
  done: boolean;
  raw?: Record<string, unknown>;
}
