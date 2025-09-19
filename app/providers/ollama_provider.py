from __future__ import annotations

import json
import re
from typing import Any, AsyncIterator, Dict, List

import httpx

from app.config import get_settings
from app.models import (
    ChatCompletionChunk,
    ChatCompletionRequest,
    ChatCompletionResponse,
    ResponseFormatConfig,
)
from app.providers.base import ChatProvider


SETTINGS = get_settings()


class OllamaProvider(ChatProvider):
    async def create_completion(
        self, request: ChatCompletionRequest
    ) -> ChatCompletionResponse:
        payload = self._build_payload(request, stream=False)
        async with httpx.AsyncClient(timeout=120) as client:
            response = await client.post(
                url=f"{SETTINGS.ollama_base_url}/api/chat",
                json=payload,
            )
        response.raise_for_status()
        data = response.json()
        message = data.get("message", {})
        content: Any = message.get("content")
        if request.response_format and request.response_format.type != "text":
            content = self._safe_json_loads(content)
        usage = None
        if "eval_count" in data or "eval_duration" in data:
            usage = {
                "eval_count": data.get("eval_count"),
                "eval_duration": data.get("eval_duration"),
                "total_duration": data.get("total_duration"),
            }
        return ChatCompletionResponse(
            provider="ollama",
            model=data.get("model", payload["model"]),
            content=content,
            usage=usage,
            raw=data,
        )

    async def create_completion_stream(
        self, request: ChatCompletionRequest
    ) -> AsyncIterator[ChatCompletionChunk]:
        payload = self._build_payload(request, stream=True)
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream(
                "POST",
                url=f"{SETTINGS.ollama_base_url}/api/chat",
                json=payload,
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line:
                        continue
                    data = json.loads(line)
                    message = data.get("message", {})
                    delta = message.get("content")
                    if (
                        request.response_format
                        and request.response_format.type != "text"
                        and delta
                    ):
                        delta = self._safe_json_loads(delta)
                    done = data.get("done", False)
                    yield ChatCompletionChunk(
                        provider="ollama",
                        model=data.get("model", payload["model"]),
                        delta=delta,
                        done=done,
                        raw=data,
                    )
                    if done:
                        break

    @staticmethod
    def _safe_json_loads(candidate: Any) -> Any:
        if isinstance(candidate, dict):
            return candidate
        if not isinstance(candidate, str):
            return candidate
        parsed = OllamaProvider._extract_json_chunk(candidate)
        return parsed

    def _build_payload(
        self, request: ChatCompletionRequest, stream: bool
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "model": request.model or SETTINGS.default_ollama_model,
            "messages": self._build_messages(request),
            "stream": stream,
        }
        options: Dict[str, Any] = {}
        if request.temperature is not None:
            options["temperature"] = request.temperature
        if request.top_p is not None:
            options["top_p"] = request.top_p
        if request.max_tokens is not None:
            options["num_predict"] = request.max_tokens
        if options:
            payload["options"] = options
        return payload

    @staticmethod
    def _extract_json_chunk(text: str) -> Any:
        """Attempt to extract a JSON object from free-form model output."""

        stripped = text.strip()
        if not stripped:
            return stripped
        try:
            return json.loads(stripped)
        except json.JSONDecodeError:
            match = re.search(r"\{.*\}", stripped, re.DOTALL)
            if match:
                candidate = match.group(0)
                try:
                    return json.loads(candidate)
                except json.JSONDecodeError:
                    pass
        return stripped

    def _build_messages(self, request: ChatCompletionRequest) -> List[Dict[str, Any]]:
        base_messages = [message.model_dump() for message in request.messages]
        if not request.response_format or request.response_format.type == "text":
            return base_messages
        instruction = self._structured_output_instruction(request.response_format)
        if instruction:
            # Ensure our structured output guardrail is the first system message
            return [instruction] + base_messages
        return base_messages

    def _structured_output_instruction(
        self, response_format: ResponseFormatConfig
    ) -> Dict[str, str] | None:
        if response_format.type == "json_object":
            return {
                "role": "system",
                "content": "You must answer with a single valid JSON object and no extra text.",
            }
        if response_format.type == "json_schema":
            schema_payload = response_format.json_schema or {}
            schema = schema_payload.get("schema") or schema_payload
            schema_str = json.dumps(schema, ensure_ascii=False)
            return {
                "role": "system",
                "content": (
                    "Respond strictly with JSON that validates against the following schema: "
                    f"{schema_str}. No commentary."
                ),
            }
        return None
