from __future__ import annotations

import pytest

from harness.budget import BudgetExhausted, assert_can_bill, load_cap_usd, write_cap_usd
from harness.jobs import Receipt


def test_default_cap_is_five(tmp_path) -> None:
    assert load_cap_usd(tmp_path) == 5.0


def test_exhausted_cap_blocks_billed_calls(tmp_path) -> None:
    write_cap_usd(0.01, tmp_path)
    receipts = [Receipt(source="provider", model="flash", cost_usd=0.02)]
    with pytest.raises(BudgetExhausted, match="cap"):
        assert_can_bill(receipts, tmp_path)


def test_unknown_spend_does_not_pretend_to_be_zero(tmp_path) -> None:
    receipts = [Receipt(source="unknown", model="flash", cost_usd=None)]
    current = assert_can_bill(receipts, tmp_path)
    assert current.spent_usd is None
    assert current.exhausted is False
