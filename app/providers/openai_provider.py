from __future__ import annotations

import json
from typing import Any, AsyncIterator, Dict

import httpx

from app.config import get_settings
from app.models import (
    ChatCompletionChunk,
    ChatCompletionRequest,
    ChatCompletionResponse,
    ResponseFormatConfig,
)
from app.providers.base import ChatProvider
from app.runtime import get_runtime_settings


SETTINGS = get_settings()


class OpenAIProvider(ChatProvider):
    async def create_completion(
        self, request: ChatCompletionRequest
    ) -> ChatCompletionResponse:
        payload = self._build_payload(request, stream=False)
        api_key, base_url = self._resolve_api_details()
        async with httpx.AsyncClient(timeout=120) as client:
            response = await client.post(
                url=f"{base_url}/chat/completions",
                headers=self._default_headers(api_key),
                json=payload,
            )
        response.raise_for_status()
        data = response.json()
        choice = data["choices"][0]["message"]
        content: Any
        if request.response_format and request.response_format.type != "text":
            try:
                content = json.loads(choice["content"])
            except json.JSONDecodeError:
                content = choice["content"]
        else:
            content = choice.get("content")
        return ChatCompletionResponse(
            provider="openai",
            model=data.get("model", payload["model"]),
            content=content,
            usage=data.get("usage"),
            raw=data,
        )

    async def create_completion_stream(
        self, request: ChatCompletionRequest
    ) -> AsyncIterator[ChatCompletionChunk]:
        payload = self._build_payload(request, stream=True)
        api_key, base_url = self._resolve_api_details()
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream(
                "POST",
                url=f"{base_url}/chat/completions",
                headers=self._default_headers(api_key),
                json=payload,
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line:
                        continue
                    if line.startswith(":"):
                        continue
                    if line.strip() == "data: [DONE]":
                        break
                    if not line.startswith("data: "):
                        continue
                    data_str = line[len("data: ") :]
                    data = json.loads(data_str)
                    delta = data["choices"][0]["delta"].get("content")
                    if delta is None and data["choices"][0]["delta"].get("tool_calls"):
                        delta = data["choices"][0]["delta"]["tool_calls"]
                    finish_reason = data["choices"][0].get("finish_reason")
                    is_done = finish_reason is not None
                    yield ChatCompletionChunk(
                        provider="openai",
                        model=data.get("model", payload["model"]),
                        delta=delta,
                        done=is_done,
                        raw=data,
                    )
                    if is_done:
                        break

    def _build_payload(
        self, request: ChatCompletionRequest, stream: bool
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "model": request.model or SETTINGS.default_openai_model,
            "messages": [message.model_dump() for message in request.messages],
            "stream": stream,
        }
        if request.temperature is not None:
            payload["temperature"] = request.temperature
        if request.max_tokens is not None:
            payload["max_tokens"] = request.max_tokens
        if request.top_p is not None:
            payload["top_p"] = request.top_p
        if request.response_format:
            payload["response_format"] = self._map_response_format(
                request.response_format
            )
        if stream:
            payload["stream_options"] = {"include_usage": True}
        return payload

    @staticmethod
    def _map_response_format(response_format: ResponseFormatConfig) -> Dict[str, Any]:
        if response_format.type == "text":
            return {"type": "text"}
        if response_format.type == "json_object":
            return {"type": "json_object"}
        if response_format.type == "json_schema":
            if not response_format.json_schema:
                raise ValueError("json_schema response requires a json_schema payload")
            name = response_format.json_schema.get("name", "structured_output")
            schema = response_format.json_schema.get("schema")
            if not schema:
                raise ValueError("json_schema response requires a schema property")
            return {
                "type": "json_schema",
                "json_schema": {
                    "name": name,
                    "schema": schema,
                },
            }
        raise ValueError(f"Unsupported response format type: {response_format.type}")

    @staticmethod
    def _default_headers(api_key: str) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

    @staticmethod
    def _resolve_api_details() -> tuple[str, str]:
        runtime_settings = get_runtime_settings()
        api_key = runtime_settings.openai_api_key or SETTINGS.openai_api_key
        base_url = runtime_settings.openai_base_url or SETTINGS.openai_base_url
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is not configured")
        return api_key, base_url
