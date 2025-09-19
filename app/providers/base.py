from __future__ import annotations

from abc import ABC, abstractmethod
from typing import AsyncIterator

from app.models import ChatCompletionChunk, ChatCompletionRequest, ChatCompletionResponse


class ChatProvider(ABC):
    @abstractmethod
    async def create_completion(
        self, request: ChatCompletionRequest
    ) -> ChatCompletionResponse:
        """Create a non-streaming chat completion."""

    @abstractmethod
    async def create_completion_stream(
        self, request: ChatCompletionRequest
    ) -> AsyncIterator[ChatCompletionChunk]:
        """Yield streaming chat completion deltas."""
