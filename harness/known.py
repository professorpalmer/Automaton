from __future__ import annotations

"""Tenant apps that already exist. Do not invent a stub when the operator names one."""

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Sequence

from harness.jobs import Job, JobStore
from harness.paths import projects_dir
from harness.vault import refuse_secret_payload

TFA = re.compile(r"https://soldiersangels\.tfaforms\.net/\d+", re.I)
LABELED = re.compile(
    r"([A-Za-z][A-Za-z0-9&'./ -]{2,80}?)\s*[-:]\s*(https://soldiersangels\.tfaforms\.net/\d+)",
    re.I,
)
UPDATE = re.compile(r"\b(update|updates|change|changes|fix|fixes|replace)\b", re.I)
LINKY = re.compile(r"\b(link|links|url|urls|form|forms|portal)\b", re.I)


@dataclass(frozen=True)
class KnownProduct:
    slug: str
    display: str
    live_url: str
    aliases: tuple
    links: tuple


PRODUCTS = (
    KnownProduct(
        slug="sa-hotb",
        display="Home of the Brave",
        live_url="https://sa-hotb.onrender.com",
        aliases=("sa-hotb", "hotb", "home of the brave", "homeofthebrave"),
        links=(
            ("Reimbursement Form", "https://soldiersangels.tfaforms.net/188"),
            ("Event Coordinator Registration", "https://soldiersangels.tfaforms.net/185"),
            ("VA Site Registration", "https://soldiersangels.tfaforms.net/187"),
            ("Volunteer Registration Form", "https://soldiersangels.tfaforms.net/186"),
            ("Event Detail Information", "https://soldiersangels.tfaforms.net/189"),
        ),
    ),
)


def match_product(brief: str) -> Optional[KnownProduct]:
    text = (brief or "").lower()
    for product in PRODUCTS:
        if any(alias in text for alias in product.aliases):
            return product
    return None


def is_link_update(brief: str) -> bool:
    text = brief or ""
    if not TFA.search(text):
        return False
    if match_product(text):
        return True
    return bool(UPDATE.search(text) and LINKY.search(text))


def is_known_link_update(brief: str) -> bool:
    return match_product(brief) is not None and is_link_update(brief)


def extract_link_updates(brief: str) -> List[dict]:
    rows = []
    seen = set()
    for label, url in LABELED.findall(brief or ""):
        name = re.sub(r"\s+", " ", label).strip(" -:\t")
        name = re.sub(
            r"^(can we update these links\??|updates? to|here is the link for)\s+",
            "",
            name,
            flags=re.I,
        )
        key = url.lower()
        if key in seen or not name:
            continue
        seen.add(key)
        rows.append({"label": name, "url": url})
    return rows


def find_checkout(product: KnownProduct, root: Optional[Path] = None) -> Optional[Path]:
    here = Path(root) if root is not None else None
    candidates = [
        projects_dir(here) / product.slug,
        (here / product.slug) if here is not None else None,
        (here / "known" / product.slug) if here is not None else None,
    ]
    for dest in candidates:
        if dest is None:
            continue
        if dest.is_dir() and any(dest.rglob("hotb_2026.json")):
            return dest
    return None


def apply_link_updates(checkout: Path, updates: Sequence[dict]) -> List[str]:
    changed = []
    for seed in checkout.rglob("hotb_2026.json"):
        if "node_modules" in seed.parts:
            continue
        payload = json.loads(seed.read_text(encoding="utf-8"))
        links = payload.get("links") or []
        dirty = False
        for update in updates:
            target = _match_link(links, update["label"])
            if target is None or target.get("url") == update["url"]:
                continue
            target["url"] = update["url"]
            dirty = True
            line = f"{target.get('label') or update['label']} now points at {update['url']}."
            if line not in changed:
                changed.append(line)
        if dirty:
            refuse_secret_payload(json.dumps(payload))
            seed.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return changed


def pending_link_updates(product: KnownProduct, updates: Sequence[dict]) -> List[dict]:
    known = [{"label": label, "url": url} for label, url in product.links]
    pending = []
    for update in updates:
        target = _match_link(known, update["label"])
        if target is None:
            pending.append(update)
            continue
        if target["url"] != update["url"]:
            pending.append(
                {"label": target["label"], "url": update["url"], "was": target["url"]}
            )
    return pending


def apply_known_update(
    store: JobStore,
    job: Job,
    brief: str,
    root: Optional[Path] = None,
) -> Job:
    from harness.gates import PHASE_STEER, STATUS_REPORT_BACK

    product = match_product(brief)
    updates = extract_link_updates(brief)
    if product is None:
        return job
    job.slug = product.slug
    job.title = f"{product.display} link updates"
    job.live_url = product.live_url
    job.needed = []
    job.asks = []
    checkout = find_checkout(product, root)
    pending = pending_link_updates(product, updates)
    if checkout is not None:
        changed = apply_link_updates(checkout, updates)
        if changed:
            lines = [
                f"I have {product.display}. I applied Sara's link updates in the repo.",
                " ".join(changed) + f" Live app: {product.live_url}",
            ]
        else:
            lines = [
                f"I have {product.display}. Those FormAssembly links already match the seed.",
                f"Live app: {product.live_url}",
            ]
    elif pending:
        wanted = "; ".join(f"{item['label']} to {item['url']}" for item in pending)
        lines = [
            f"I have {product.display}. I will not invent a new tool.",
            f"{wanted}. I cannot open that repo from this box. Live app: {product.live_url}",
        ]
    else:
        lines = [
            f"I have {product.display}. Those FormAssembly links already match the live app.",
            f"Live app: {product.live_url}",
        ]
    job.phase = PHASE_STEER
    job.status = STATUS_REPORT_BACK
    job.report = "\n\n".join(lines)
    store.save(job)
    return store.get(job.id)


def _match_link(links: Sequence[dict], label: str) -> Optional[dict]:
    want = _norm(label)
    for item in links:
        have = _norm(item.get("label") or "")
        if have == want or want in have or have in want:
            return item
    return None


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (text or "").lower())
