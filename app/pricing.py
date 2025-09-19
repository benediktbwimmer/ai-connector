from __future__ import annotations

from typing import Dict, Optional

OPENAI_PRICING: Dict[str, Dict[str, float]] = {
    "gpt-4o-mini": {"input": 0.00015, "output": 0.0006},
    "gpt-4o": {"input": 0.0025, "output": 0.01},
    "gpt-4.1": {"input": 0.0025, "output": 0.01},
}


def estimate_cost_usd(
    provider: str,
    model: str,
    usage: Optional[Dict[str, int]],
) -> float:
    if not usage:
        return 0.0
    if provider != "openai":
        return 0.0
    pricing = OPENAI_PRICING.get(model) or OPENAI_PRICING.get(model.lower())
    if not pricing:
        return 0.0
    prompt_tokens = usage.get("prompt_tokens", 0)
    completion_tokens = usage.get("completion_tokens", 0)
    cost = (
        (prompt_tokens / 1000.0) * pricing.get("input", 0.0)
        + (completion_tokens / 1000.0) * pricing.get("output", 0.0)
    )
    return round(cost, 10)
