from __future__ import annotations

from harness.receipts import from_usage, job_spend_usd


def test_provider_cost_wins() -> None:
    row = from_usage(model="qwen/qwen3-vl-30b-a3b-instruct", provider_cost=0.0021)
    assert row.source == "provider"
    assert row.cost_usd == 0.0021


def test_unknown_does_not_become_zero() -> None:
    row = from_usage(model="deepseek/deepseek-v4-flash", prompt_tokens=12)
    assert row.source == "unknown"
    assert row.cost_usd is None
    assert job_spend_usd([row]) is None


def test_empty_job_spend_is_zero() -> None:
    assert job_spend_usd([]) == 0.0
