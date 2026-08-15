from __future__ import annotations

"""Provider-billed receipts. Unknown cost stays unknown — never snap to $0."""

from typing import Optional

from harness.jobs import Receipt


def from_usage(
    *,
    model: str,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    provider_cost: Optional[float] = None,
    estimated_cost: Optional[float] = None,
    note: str = "",
) -> Receipt:
    if provider_cost is not None:
        return Receipt(
            source="provider",
            model=model,
            cost_usd=float(provider_cost),
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            note=note,
        )
    if estimated_cost is not None:
        return Receipt(
            source="estimated",
            model=model,
            cost_usd=float(estimated_cost),
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            note=note,
        )
    return Receipt(
        source="unknown",
        model=model,
        cost_usd=None,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        note=note or "usage present but unpriceable",
    )


def from_cache(*, note: str = "") -> Receipt:
    return Receipt(
        source="cache",
        model="replay",
        cost_usd=0.0,
        note=note or "reused a prior product",
    )


def job_spend_usd(receipts: list[Receipt]) -> Optional[float]:
    known = [row.cost_usd for row in receipts if row.cost_usd is not None]
    if not known:
        if receipts:
            return None
        return 0.0
    return round(sum(known), 6)
