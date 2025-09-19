from __future__ import annotations

import asyncio
import datetime as dt
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

from pydantic import BaseModel


class RuntimeSettings(BaseModel):
    openai_api_key: Optional[str] = None
    openai_base_url: Optional[str] = None
    profile_name: str = "Operator"
    profile_email: Optional[str] = None


@dataclass
class UsageAggregate:
    provider: str
    model: str
    requests: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    prompt_chars: int = 0
    eval_count: int = 0
    cost_usd: float = 0.0
    last_updated: dt.datetime = field(default_factory=lambda: dt.datetime.now(dt.timezone.utc))


class UsageSnapshot(BaseModel):
    totals: Dict[str, Any]
    per_model: Dict[str, Any]
    last_updated: dt.datetime


class UsageTracker:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._per_key: Dict[str, UsageAggregate] = {}
        self._listeners: Dict[int, asyncio.Queue] = {}
        self._listener_id_seq: int = 0
        self._last_broadcast: Optional[UsageSnapshot] = None

    async def record(
        self,
        provider: str,
        model: str,
        usage: Optional[Dict[str, Any]] = None,
        *,
        prompt_chars: Optional[int] = None,
        cost_usd: Optional[float] = None,
    ) -> UsageSnapshot:
        key = f"{provider}:{model}"
        async with self._lock:
            agg = self._per_key.get(key)
            if not agg:
                agg = UsageAggregate(provider=provider, model=model)
                self._per_key[key] = agg
            agg.requests += 1
            if usage:
                agg.prompt_tokens += int(usage.get("prompt_tokens", 0))
                agg.completion_tokens += int(usage.get("completion_tokens", 0))
                agg.eval_count += int(usage.get("eval_count", 0))
            if prompt_chars is not None:
                agg.prompt_chars += prompt_chars
            if cost_usd is not None:
                agg.cost_usd += cost_usd
            agg.last_updated = dt.datetime.now(dt.timezone.utc)
            snapshot = self._build_snapshot_locked()
            self._last_broadcast = snapshot
            listeners = list(self._listeners.values())
        for queue in listeners:
            await queue.put(snapshot.model_dump(mode="json"))
        return snapshot

    async def register(self) -> tuple[int, asyncio.Queue]:
        queue: asyncio.Queue = asyncio.Queue(maxsize=10)
        async with self._lock:
            listener_id = self._listener_id_seq
            self._listener_id_seq += 1
            self._listeners[listener_id] = queue
            snapshot = self._last_broadcast or self._build_snapshot_locked()
        await queue.put(snapshot.model_dump(mode="json"))
        return listener_id, queue

    async def unregister(self, listener_id: int) -> None:
        async with self._lock:
            self._listeners.pop(listener_id, None)

    async def current(self) -> UsageSnapshot:
        async with self._lock:
            return self._last_broadcast or self._build_snapshot_locked()

    def _build_snapshot_locked(self) -> UsageSnapshot:
        totals = {
            "requests": 0,
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "prompt_chars": 0,
            "eval_count": 0,
            "cost_usd": 0.0,
        }
        per_model: Dict[str, Any] = {}
        for key, agg in self._per_key.items():
            totals["requests"] += agg.requests
            totals["prompt_tokens"] += agg.prompt_tokens
            totals["completion_tokens"] += agg.completion_tokens
            totals["prompt_chars"] += agg.prompt_chars
            totals["eval_count"] += agg.eval_count
            totals["cost_usd"] += agg.cost_usd
            per_model[key] = {
                "provider": agg.provider,
                "model": agg.model,
                "requests": agg.requests,
                "prompt_tokens": agg.prompt_tokens,
                "completion_tokens": agg.completion_tokens,
                "prompt_chars": agg.prompt_chars,
                "eval_count": agg.eval_count,
                "cost_usd": agg.cost_usd,
                "last_updated": agg.last_updated,
            }
        return UsageSnapshot(
            totals=totals,
            per_model=per_model,
            last_updated=dt.datetime.now(dt.timezone.utc),
        )


_runtime_settings = RuntimeSettings()
_usage_tracker = UsageTracker()


def get_runtime_settings() -> RuntimeSettings:
    return _runtime_settings


async def update_runtime_settings(**kwargs: Any) -> RuntimeSettings:
    global _runtime_settings
    data = _runtime_settings.model_dump()
    data.update(kwargs)
    _runtime_settings = RuntimeSettings(**data)
    return _runtime_settings


def get_usage_tracker() -> UsageTracker:
    return _usage_tracker
