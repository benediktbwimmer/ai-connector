from __future__ import annotations

import json
import logging
from typing import AsyncIterator, Callable, Dict

import httpx
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from app.config import get_settings
from app.models import ChatCompletionRequest, ChatCompletionResponse
from app.providers.base import ChatProvider
from app.providers.ollama_provider import OllamaProvider
from app.providers.openai_provider import OpenAIProvider

logger = logging.getLogger(__name__)

settings = get_settings()

app = FastAPI(title="AI Connector", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


ProviderFactory = Callable[[], ChatProvider]
PROVIDERS: Dict[str, ProviderFactory] = {
    "openai": OpenAIProvider,
    "ollama": OllamaProvider,
}


@app.get("/healthz")
async def health_check() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/chat/completions", response_model=ChatCompletionResponse)
async def create_chat_completion(
    request: ChatCompletionRequest,
) -> JSONResponse:
    provider = resolve_provider(request.provider)
    try:
        result = await provider.create_completion(request)
    except httpx.HTTPStatusError as exc:
        detail = extract_error_detail(exc)
        logger.error("OpenAI/Ollama API error: %s", detail)
        raise HTTPException(status_code=exc.response.status_code, detail=detail)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc))
    except Exception as exc:  # pragma: no cover - catch-all for stability
        logger.exception("Completion failed")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc))
    return JSONResponse(content=result.model_dump())


@app.post("/chat/completions/stream")
async def stream_chat_completion(
    request: ChatCompletionRequest,
) -> StreamingResponse:
    provider = resolve_provider(request.provider)

    async def event_stream() -> AsyncIterator[str]:
        try:
            async for chunk in provider.create_completion_stream(request):
                payload = json.dumps(chunk.model_dump())
                yield f"data: {payload}\n\n"
        except httpx.HTTPStatusError as exc:
            detail = extract_error_detail(exc)
            logger.error("Streaming API error: %s", detail)
            error_payload = json.dumps({"error": detail})
            yield f"data: {error_payload}\n\n"
        except RuntimeError as exc:
            error_payload = json.dumps({"error": str(exc)})
            yield f"data: {error_payload}\n\n"
        except Exception as exc:  # pragma: no cover
            logger.exception("Streaming completion failed")
            error_payload = json.dumps({"error": str(exc)})
            yield f"data: {error_payload}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


def resolve_provider(name: str) -> ChatProvider:
    factory = PROVIDERS.get(name)
    if not factory:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown provider")
    provider = factory()
    return provider


def extract_error_detail(exc: httpx.HTTPStatusError) -> str:
    try:
        payload = exc.response.json()
    except ValueError:
        return exc.response.text
    if isinstance(payload, dict):
        if "error" in payload:
            error = payload["error"]
            if isinstance(error, dict):
                return error.get("message") or json.dumps(error)
            return str(error)
        return json.dumps(payload)
    return str(payload)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=settings.port,
        reload=False,
    )
