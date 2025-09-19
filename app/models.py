from __future__ import annotations

from typing import Any, AsyncIterator, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant", "tool"]
    content: str


class ResponseFormatConfig(BaseModel):
    type: Literal["text", "json_object", "json_schema"] = Field(
        ..., description="Desired response format"
    )
    json_schema: Optional[Dict[str, Any]] = Field(
        default=None,
        description="JSON schema to enforce when type is json_schema",
    )


class ChatCompletionRequest(BaseModel):
    provider: Literal["openai", "ollama"] = Field(
        default="openai", description="LLM backend to use"
    )
    model: Optional[str] = Field(
        default=None,
        description="Model identifier for the selected provider",
    )
    messages: List[ChatMessage]
    temperature: Optional[float] = Field(default=None)
    max_tokens: Optional[int] = Field(default=None)
    top_p: Optional[float] = Field(default=None)
    response_format: Optional[ResponseFormatConfig] = Field(default=None)


class ChatCompletionResponse(BaseModel):
    provider: Literal["openai", "ollama"]
    model: str
    content: Any
    usage: Optional[Dict[str, Any]] = None
    raw: Optional[Dict[str, Any]] = None


class ChatCompletionChunk(BaseModel):
    provider: Literal["openai", "ollama"]
    model: str
    delta: Any
    done: bool = False
    raw: Optional[Dict[str, Any]] = None


ChunkIterator = AsyncIterator[ChatCompletionChunk]


class SettingsUpdate(BaseModel):
    openai_api_key: Optional[str] = None
    openai_base_url: Optional[str] = None


class ProfileUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None


class SettingsResponse(BaseModel):
    openai_api_key_set: bool
    openai_base_url: str
    profile_name: str
    profile_email: Optional[str] = None


class ModelInfo(BaseModel):
    provider: Literal["openai", "ollama"]
    model: str
    display_name: str
