from __future__ import annotations

import json
import logging
import asyncio
from pathlib import Path
from typing import Any, AsyncIterator, Callable, Dict, List, Optional

import httpx
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError

from app.config import get_settings
from app.models import (
    ChatCompletionRequest,
    ChatCompletionResponse,
    ModelInfo,
    ProfileUpdate,
    SettingsResponse,
    SettingsUpdate,
)
from app.pricing import estimate_cost_usd
from app.providers.base import ChatProvider
from app.providers.ollama_provider import OllamaProvider
from app.providers.openai_provider import OpenAIProvider
from app.runtime import (
    UsageSnapshot,
    get_runtime_settings,
    get_usage_tracker,
    update_runtime_settings,
)

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

usage_tracker = get_usage_tracker()
FRONTEND_DIST = Path(__file__).resolve().parent / "static"


@app.get("/healthz")
async def health_check() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/settings", response_model=SettingsResponse)
async def get_settings_view() -> SettingsResponse:
    runtime = get_runtime_settings()
    return _build_settings_response(runtime)


@app.post("/settings", response_model=SettingsResponse)
async def update_settings_view(payload: SettingsUpdate) -> SettingsResponse:
    updates: Dict[str, Optional[str]] = {}
    if payload.openai_api_key is not None:
        updates["openai_api_key"] = payload.openai_api_key or None
    if payload.openai_base_url is not None:
        updates["openai_base_url"] = payload.openai_base_url or None
    await update_runtime_settings(**updates)
    runtime = get_runtime_settings()
    return _build_settings_response(runtime)


@app.get("/profile", response_model=SettingsResponse)
async def get_profile_view() -> SettingsResponse:
    runtime = get_runtime_settings()
    return _build_settings_response(runtime)


@app.post("/profile", response_model=SettingsResponse)
async def update_profile_view(payload: ProfileUpdate) -> SettingsResponse:
    updates: Dict[str, Optional[str]] = {}
    if payload.name is not None:
        updates["profile_name"] = payload.name or "Operator"
    if payload.email is not None:
        updates["profile_email"] = payload.email or None
    if updates:
        await update_runtime_settings(**updates)
    runtime = get_runtime_settings()
    return _build_settings_response(runtime)


@app.get("/models", response_model=List[ModelInfo])
async def list_models() -> List[ModelInfo]:
    models: List[ModelInfo] = []
    models.extend(await _fetch_ollama_models())
    models.extend(_list_openai_models())
    # Ensure uniqueness by model identifier
    seen = set()
    unique_models = []
    for model in models:
        key = (model.provider, model.model)
        if key in seen:
            continue
        seen.add(key)
        unique_models.append(model)
    return unique_models


@app.get("/usage", response_model=UsageSnapshot)
async def get_usage() -> UsageSnapshot:
    return await usage_tracker.current()


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
    usage = normalize_usage(result.provider, result.usage)
    prompt_chars = count_prompt_chars(request)
    cost = estimate_cost_usd(result.provider, result.model, usage)
    await usage_tracker.record(
        result.provider,
        result.model,
        usage,
        prompt_chars=prompt_chars,
        cost_usd=cost,
    )
    return JSONResponse(content=result.model_dump())


@app.post("/chat/completions/stream")
async def stream_chat_completion(
    request: ChatCompletionRequest,
) -> StreamingResponse:
    provider = resolve_provider(request.provider)
    prompt_chars = count_prompt_chars(request)

    async def event_stream() -> AsyncIterator[str]:
        pending_usage: Optional[Dict[str, Any]] = None
        try:
            async for chunk in provider.create_completion_stream(request):
                usage_candidate = usage_from_chunk(chunk)
                if usage_candidate:
                    pending_usage = usage_candidate
                payload = json.dumps(chunk.model_dump())
                yield f"data: {payload}\n\n"
                if chunk.done:
                    normalized_usage = normalize_usage(chunk.provider, pending_usage)
                    cost = estimate_cost_usd(chunk.provider, chunk.model, normalized_usage)
                    await usage_tracker.record(
                        chunk.provider,
                        chunk.model,
                        normalized_usage,
                        prompt_chars=prompt_chars,
                        cost_usd=cost,
                    )
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


@app.websocket("/ws/chat")
async def websocket_chat(websocket: WebSocket) -> None:
    await websocket.accept()
    while True:
        try:
            payload = await websocket.receive_json()
        except WebSocketDisconnect:
            break
        except Exception as exc:  # pragma: no cover - defensive
            logger.error("Invalid WebSocket payload: %s", exc)
            await websocket.send_json({"type": "error", "data": "Invalid payload"})
            continue
        action = payload.get("action", "chat")
        if action != "chat":
            await websocket.send_json({"type": "error", "data": "Unsupported action"})
            continue
        request_data = payload.get("request")
        if not isinstance(request_data, dict):
            await websocket.send_json({"type": "error", "data": "Missing request body"})
            continue
        try:
            request = ChatCompletionRequest.model_validate(request_data)
        except ValidationError as exc:
            await websocket.send_json({"type": "error", "data": exc.errors()})
            continue
        provider = resolve_provider(request.provider)
        prompt_chars = count_prompt_chars(request)
        pending_usage: Optional[Dict[str, Any]] = None
        try:
            async for chunk in provider.create_completion_stream(request):
                usage_candidate = usage_from_chunk(chunk)
                if usage_candidate:
                    pending_usage = usage_candidate
                await websocket.send_json({"type": "chunk", "data": chunk.model_dump()})
                if chunk.done:
                    normalized_usage = normalize_usage(chunk.provider, pending_usage)
                    cost = estimate_cost_usd(chunk.provider, chunk.model, normalized_usage)
                    await usage_tracker.record(
                        chunk.provider,
                        chunk.model,
                        normalized_usage,
                        prompt_chars=prompt_chars,
                        cost_usd=cost,
                    )
                    await websocket.send_json({"type": "done"})
        except httpx.HTTPStatusError as exc:
            detail = extract_error_detail(exc)
            await websocket.send_json({"type": "error", "data": detail})
        except WebSocketDisconnect:
            break
        except Exception as exc:  # pragma: no cover
            logger.exception("WebSocket chat failed")
            await websocket.send_json({"type": "error", "data": str(exc)})
    try:
        await websocket.close()
    except RuntimeError:
        pass


@app.websocket("/ws/monitoring")
async def websocket_monitoring(websocket: WebSocket) -> None:
    await websocket.accept()
    listener_id, queue = await usage_tracker.register()
    try:
        while True:
            try:
                snapshot = await queue.get()
                await websocket.send_json({"type": "snapshot", "data": snapshot})
            except WebSocketDisconnect:
                break
            except Exception:  # pragma: no cover - defensive
                logger.debug("WebSocket monitoring send failed", exc_info=True)
                break
    finally:
        await usage_tracker.unregister(listener_id)
        try:
            await websocket.close()
        except RuntimeError:
            pass


def count_prompt_chars(request: ChatCompletionRequest) -> int:
    return sum(len(message.content or "") for message in request.messages)


def normalize_usage(
    provider: str, usage: Optional[Dict[str, Any]]
) -> Optional[Dict[str, Any]]:
    if not usage:
        return usage
    if provider == "ollama":
        prompt_tokens = int(usage.get("prompt_eval_count") or usage.get("prompt_tokens") or 0)
        completion_tokens = int(usage.get("eval_count") or usage.get("completion_tokens") or 0)
        return {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "eval_count": int(usage.get("eval_count") or completion_tokens or 0),
        }
    return {
        "prompt_tokens": int(usage.get("prompt_tokens", 0)),
        "completion_tokens": int(usage.get("completion_tokens", 0)),
    }


def usage_from_chunk(chunk: ChatCompletionChunk) -> Optional[Dict[str, Any]]:
    raw = chunk.raw
    if not isinstance(raw, dict):
        return None
    if chunk.provider == "openai":
        usage = raw.get("usage")
        if isinstance(usage, dict):
            return usage
    if chunk.provider == "ollama" and raw.get("done"):
        return {
            "eval_count": raw.get("eval_count", 0),
            "prompt_eval_count": raw.get("prompt_eval_count", 0),
        }
    return None


def _build_settings_response(runtime_settings) -> SettingsResponse:
    effective_openai_base = runtime_settings.openai_base_url or settings.openai_base_url
    key_set = bool(runtime_settings.openai_api_key or settings.openai_api_key)
    return SettingsResponse(
        openai_api_key_set=key_set,
        openai_base_url=effective_openai_base,
        profile_name=runtime_settings.profile_name,
        profile_email=runtime_settings.profile_email,
    )


async def _fetch_ollama_models() -> List[ModelInfo]:
    models: List[ModelInfo] = []
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(f"{settings.ollama_base_url}/api/tags")
        response.raise_for_status()
        data = response.json() if response.content else {}
        for entry in data.get("models", []):
            name = entry.get("model") or entry.get("name")
            if not name:
                continue
            models.append(
                ModelInfo(provider="ollama", model=name, display_name=name)
            )
    except Exception:  # pragma: no cover - best-effort discovery
        logger.debug("Unable to fetch Ollama models", exc_info=True)
    if not models:
        models.append(
            ModelInfo(
                provider="ollama",
                model=settings.default_ollama_model,
                display_name=settings.default_ollama_model,
            )
        )
    return models


def _list_openai_models() -> List[ModelInfo]:
    runtime = get_runtime_settings()
    candidates = {
        settings.default_openai_model,
        "gpt-4o",
        "gpt-4.1",
        "gpt-4o-mini",
    }
    if runtime.openai_base_url and runtime.openai_base_url != settings.openai_base_url:
        # When using a custom endpoint we cannot assume available models
        candidates.add(settings.default_openai_model)
    models: List[ModelInfo] = [
        ModelInfo(provider="openai", model=model_id, display_name=model_id)
        for model_id in candidates
    ]
    return models


if FRONTEND_DIST.exists():
    assets_dir = FRONTEND_DIST / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="frontend-assets")

    @app.get("/", include_in_schema=False)
    async def serve_frontend_root() -> FileResponse:
        return FileResponse(FRONTEND_DIST / "index.html")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_frontend(full_path: str) -> FileResponse:
        candidate = (FRONTEND_DIST / full_path).resolve()
        try:
            candidate.relative_to(FRONTEND_DIST)
        except ValueError:
            return FileResponse(FRONTEND_DIST / "index.html")
        if candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")


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
