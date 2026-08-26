from __future__ import annotations

"""Tenant budget cap. Unknown spend stays unknown; over-cap calls are refused."""

import json
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional

from harness.jobs import Receipt
from harness.paths import secrets_dir
from harness.receipts import job_spend_usd
from harness.vault import assert_not_wiki

DEFAULT_CAP_USD = 5.0
BUDGET_FILENAME = "budget.json"


@dataclass
class Budget:
    cap_usd: float
    spent_usd: Optional[float]

    @property
    def remaining_usd(self) -> Optional[float]:
        if self.spent_usd is None:
            return None
        return round(self.cap_usd - self.spent_usd, 6)

    @property
    def exhausted(self) -> bool:
        if self.spent_usd is None:
            return False
        return self.spent_usd >= self.cap_usd


class BudgetExhausted(RuntimeError):
    pass


def load_cap_usd(root: Optional[Path] = None) -> float:
    path = secrets_dir(root) / BUDGET_FILENAME
    if not path.is_file():
        return DEFAULT_CAP_USD
    assert_not_wiki(path)
    payload = json.loads(path.read_text(encoding="utf-8"))
    return float(payload.get("cap_usd", DEFAULT_CAP_USD))


def write_cap_usd(cap_usd: float, root: Optional[Path] = None) -> Path:
    dest = secrets_dir(root) / BUDGET_FILENAME
    assert_not_wiki(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps({"cap_usd": float(cap_usd)}, indent=2) + "\n", encoding="utf-8")
    dest.chmod(0o600)
    return dest


def budget_for(receipts: List[Receipt], root: Optional[Path] = None) -> Budget:
    return Budget(cap_usd=load_cap_usd(root), spent_usd=job_spend_usd(receipts))


def assert_can_bill(receipts: List[Receipt], root: Optional[Path] = None) -> Budget:
    current = budget_for(receipts, root)
    if current.exhausted:
        raise BudgetExhausted(
            f"tenant budget cap reached (${current.cap_usd:.2f}). No further billed calls."
        )
    return current
