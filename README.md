# AI Connector Service

A lightweight FastAPI service that fronts local Ollama (`gpt-oss-20b`) as well as OpenAI chat models. It exposes blocking and streaming chat completion endpoints, and handles both plain text and structured JSON responses.

## Features

- `/chat/completions` – standard chat completion response.
- `/chat/completions/stream` – Server-Sent Events stream for incremental tokens.
- Built-in support for JSON/structured outputs via `response_format`.
- Choose between OpenAI (`provider: "openai"`) and local Ollama (`provider: "ollama"`).

## Configuration

Environment variables:

- `PORT` (default `8000`): HTTP port.
- `OPENAI_API_KEY`: Required for OpenAI provider requests.
- `OPENAI_BASE_URL` (optional): Override the OpenAI API endpoint.
- `OLLAMA_BASE_URL` (default `http://127.0.0.1:11434`): Ollama API endpoint.

## Running locally

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port ${PORT:-8000}
```

## Docker

Build and run the container:

```bash
docker build -t ai-connector .
docker run --rm -p 8000:8000 -e PORT=8000 -e OPENAI_API_KEY=your_key ai-connector
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
