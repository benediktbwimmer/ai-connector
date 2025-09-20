# AI Connector Service

A lightweight FastAPI service that fronts local Ollama (`gpt-oss:20b`) as well as OpenAI chat models. It exposes blocking and streaming chat completion endpoints, handles both plain text and structured JSON responses, and ships with a React frontend for chat, profile/settings management, and live monitoring.

## Features

- `/chat/completions` – standard chat completion response.
- `/chat/completions/stream` – Server-Sent Events stream for incremental tokens.
- Built-in support for JSON/structured outputs via `response_format`.
- Choose between OpenAI (`provider: "openai"`) and local Ollama (`provider: "ollama"`).
- WebSocket chat streaming at `/ws/chat` and real-time usage monitoring at `/ws/monitoring`.
- React SPA served from `/` with pages for Chat, Profile, Settings, and Monitoring (FastAPI docs remain at `/docs`).

## Configuration

Environment variables:

- `PORT` (default `8000`): HTTP port.
- `OPENAI_API_KEY`: Required for OpenAI provider requests (can also be provided at runtime via the UI or `/settings`).
- `OPENAI_BASE_URL` (optional): Override the OpenAI API endpoint.
- `OLLAMA_BASE_URL` (default `http://127.0.0.1:11434`; use `http://host.docker.internal:11434` when running in Docker): Ollama API endpoint.

## Running locally

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port ${PORT:-8000}
```

### Frontend development

```bash
cd frontend
npm install
# Optionally point at a remote API
export VITE_API_BASE_URL="http://localhost:8000"
npm run dev
```

The production build is bundled automatically by the Docker image; static assets land under `app/static` and are served by FastAPI.

## Docker

Build and run the container:

```bash
docker build -t ai-connector .
docker run --rm \\
  -p 8000:8000 \\
  -e PORT=8000 \\
  -e OPENAI_API_KEY=your_key \\
  -e OLLAMA_BASE_URL=http://host.docker.internal:11434 \\
  ai-connector
```

## Request payload

```json
{
  "provider": "openai",
  "model": "gpt-4o-mini",
  "messages": [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "List three colors."}
  ],
  "response_format": {
    "type": "json_schema",
    "json_schema": {
      "name": "color_list",
      "schema": {
        "type": "object",
        "properties": {
          "colors": {
            "type": "array",
            "items": {"type": "string"}
          }
        },
        "required": ["colors"]
      }
    }
  }
}
```

For streaming, send the same payload to `/chat/completions/stream`.

## Health check

- `GET /healthz` returns `{ "status": "ok" }`.

## Additional APIs

- `GET/POST /settings` – manage OpenAI API key & base URL at runtime.
- `GET/POST /profile` – update display name/email metadata shown in the UI.
- `GET /models` – discover available Ollama and OpenAI model names.
- `GET /usage` & WebSocket `/ws/monitoring` – retrieve or subscribe to aggregated usage and cost metrics.
