from __future__ import annotations

"""Full-auto factory: brief in, operator tool out. No approval between waves."""

import html
import io
import json
import re
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional

from harness.gates import TENANT_DISPLAY
from harness.jobs import Job, JobStore
from harness.paths import product_relpath, products_dir
from harness.vault import refuse_secret_payload

WAVE_NAMES = ["spec", "ship", "verify"]

COLOR_WORDS = {
    "green": "#1f5c45",
    "forest": "#1f5c45",
    "blue": "#4472c4",
    "navy": "#1b365d",
    "red": "#c00000",
    "gold": "#c4a35a",
    "amber": "#c4a35a",
    "orange": "#c05621",
}

DEFAULT_ACCENT = "#1f5c45"


@dataclass
class ProductSpec:
    title: str
    lede: str
    primary_action: str
    accent: str
    fields: List[str] = field(default_factory=list)
    kind: str = "poster"


def parse_spec(brief: str, sidecar_text: Optional[str] = None) -> ProductSpec:
    refuse_secret_payload(brief)
    if sidecar_text:
        refuse_secret_payload(sidecar_text)
    text = (brief or "").strip() or "Untitled operator tool"
    first = text.split("\n")[0].strip()
    first = re.sub(r"^(build|make|create|ship)\s+(a|an|the)\s+", "", first, flags=re.I)
    first = first.rstrip(".")
    title = first[:72] if first else "Untitled operator tool"
    lede = text
    if sidecar_text:
        lede = f"{text}\n\nFrom the screenshot: {sidecar_text.strip()}"
    action = "Run"
    quoted = re.search(
        r"(?:button|cta)\s+(?:labeled|called|named|that says)\s+[\"']([^\"']+)[\"']",
        text,
        flags=re.I,
    )
    if quoted:
        action = quoted.group(1).strip()
    elif re.search(r"\bsubmit\b", text, flags=re.I):
        action = "Submit"
    elif re.search(r"\bexport\b", text, flags=re.I):
        action = "Export"
    elif re.search(r"\bupload\b", text, flags=re.I):
        action = "Upload"
    accent = DEFAULT_ACCENT
    for word, hex_color in COLOR_WORDS.items():
        if re.search(rf"\b{word}\b", text, flags=re.I):
            accent = hex_color
            break
    fields: List[str] = []
    if re.search(r"\b(xlsx|spreadsheet|workbook|excel)\b", text, flags=re.I):
        fields.append("Workbook (.xlsx)")
    elif re.search(r"\bupload\b", text, flags=re.I):
        fields.append("File")
    if re.search(r"\bcsv\b", text, flags=re.I):
        fields.append("CSV")
    kind = "service" if wants_service(text) else "poster"
    if kind == "service" and action == "Run":
        action = "Run reconciliation"
    return ProductSpec(
        title=title,
        lede=lede,
        primary_action=action,
        accent=accent,
        fields=fields,
        kind=kind,
    )


def wants_service(brief: str) -> bool:
    return bool(
        re.search(
            r"\b(reconcil|workbook|\.xlsx|spreadsheet|ledger|exception queue|"
            r"flixbus|lyft|operator dashboard)\b",
            brief or "",
            flags=re.I,
        )
    )


def product_dir(job: Job, root: Optional[Path] = None) -> Path:
    return products_dir(root) / job.id


def product_index(job: Job, root: Optional[Path] = None) -> Path:
    return product_dir(job, root) / "index.html"


def render_tool(spec: ProductSpec) -> str:
    fields_html = ""
    for label in spec.fields:
        fields_html += (
            f'    <label>{html.escape(label)}'
            f'<input type="file" name="upload" /></label>\n'
        )
    if not fields_html:
        fields_html = "    <p class=\"hint\">No file needed. Use the action when you are ready.</p>\n"
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{html.escape(spec.title)} · {html.escape(TENANT_DISPLAY)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700&family=Source+Sans+3:wght@400;600;700&display=swap" rel="stylesheet" />
  <style>
    :root {{
      --bg: #f3efe6;
      --bg-deep: #e7e0d2;
      --ink: #1c2a22;
      --muted: #5c6b62;
      --accent: {spec.accent};
      --accent-ink: #f7f4ec;
      --display: "Fraunces", Georgia, serif;
      --sans: "Source Sans 3", "Segoe UI", sans-serif;
    }}
    * {{ box-sizing: border-box; }}
    html, body {{ margin: 0; min-height: 100%; }}
    body {{
      font-family: var(--sans);
      color: var(--ink);
      overscroll-behavior: contain;
      scrollbar-gutter: stable;
      background:
        radial-gradient(1200px 600px at 10% -10%, #fff8ea 0%, transparent 55%),
        radial-gradient(900px 500px at 100% 0%, #dce8df 0%, transparent 50%),
        linear-gradient(180deg, var(--bg) 0%, var(--bg-deep) 100%);
    }}
    .page {{ width: min(760px, calc(100% - 2.5rem)); margin: 0 auto; padding: 1.5rem 0 3rem; }}
    .brand {{ font-family: var(--display); font-size: 1.15rem; margin: 0 0 2rem; }}
    h1 {{ font-family: var(--display); font-size: clamp(1.8rem, 3vw, 2.4rem); margin: 0 0 0.5rem; }}
    .lede {{ color: var(--muted); line-height: 1.5; white-space: pre-wrap; }}
    form {{ display: grid; gap: 1rem; margin-top: 1.5rem; }}
    label {{ display: grid; gap: 0.35rem; font-weight: 600; }}
    input[type="file"] {{ font: inherit; }}
    .hint {{ color: var(--muted); }}
    button.primary {{
      justify-self: start;
      font: 700 1rem var(--sans);
      background: var(--accent);
      color: var(--accent-ink);
      border: 0;
      padding: 0.7rem 1.2rem;
      cursor: pointer;
    }}
    button.primary:focus {{ outline: 2px solid var(--ink); outline-offset: 2px; }}
    .result {{ margin-top: 1.25rem; color: var(--muted); }}
  </style>
</head>
<body>
  <div class="page">
    <p class="brand">{html.escape(TENANT_DISPLAY)}</p>
    <h1>{html.escape(spec.title)}</h1>
    <p class="lede">{html.escape(spec.lede)}</p>
    <form id="tool-form">
{fields_html}      <button class="primary" type="submit">{html.escape(spec.primary_action)}</button>
    </form>
    <p class="result" id="result" hidden>Ready. This local tool records the action; wire live data when access is granted.</p>
  </div>
  <script>
    document.getElementById("tool-form").addEventListener("submit", function (event) {{
      event.preventDefault();
      var box = document.getElementById("result");
      box.hidden = false;
    }});
  </script>
</body>
</html>
"""


def spec_wave(store: JobStore, job: Job, sidecar_text: Optional[str] = None) -> ProductSpec:
    store.begin_wave(job, "spec")
    spec = parse_spec(job.brief, sidecar_text)
    store.pass_wave(
        job,
        "spec",
        f"title={spec.title}; action={spec.primary_action}; accent={spec.accent}",
    )
    return spec


def ship_wave(store: JobStore, job: Job, spec: ProductSpec, root: Optional[Path] = None) -> Path:
    store.begin_wave(job, "ship")
    dest_dir = product_dir(job, root)
    dest_dir.mkdir(parents=True, exist_ok=True)
    if spec.kind == "service":
        _ship_service(dest_dir, spec)
        keep_operator_workbook(job, dest_dir)
        store.pass_wave(job, "ship", f"wrote {product_relpath(job.id, 'app.py')} service")
        return dest_dir / "app.py"
    dest = dest_dir / "index.html"
    dest.write_text(render_tool(spec), encoding="utf-8")
    store.pass_wave(job, "ship", f"wrote {product_relpath(job.id)}")
    return dest


def keep_operator_workbook(job: Job, dest_dir: Path) -> None:
    for record in job.files:
        if record.kind != "workbook":
            continue
        src = Path(record.path)
        if not src.is_file():
            continue
        dest_dir.joinpath("intake" + (src.suffix or ".xlsx")).write_bytes(src.read_bytes())
        return


def _ship_service(dest_dir: Path, spec: ProductSpec) -> None:
    here = Path(__file__).resolve().parent
    shutil.copy2(here / "recon_engine.py", dest_dir / "engine.py")
    shutil.copy2(here / "service_app.py", dest_dir / "app.py")
    (dest_dir / "spec.json").write_text(
        json.dumps(
            {
                "kind": "service",
                "title": spec.title,
                "lede": spec.lede,
                "primary_action": spec.primary_action,
                "accent": spec.accent,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    (dest_dir / "requirements.txt").write_text(
        "fastapi>=0.115\nuvicorn[standard]>=0.32\npython-multipart>=0.0.12\nopenpyxl>=3.1\n",
        encoding="utf-8",
    )
    (dest_dir / "render.yaml").write_text(
        "services:\n"
        "  - type: web\n"
        "    runtime: python\n"
        "    plan: free\n"
        "    buildCommand: pip install -r requirements.txt\n"
        "    startCommand: uvicorn app:app --host 0.0.0.0 --port $PORT\n",
        encoding="utf-8",
    )
    (dest_dir / "index.html").write_text(render_tool(spec), encoding="utf-8")


def verify_wave(store: JobStore, job: Job, spec: ProductSpec, dest: Path) -> None:
    store.begin_wave(job, "verify")
    if spec.kind == "service":
        dest_dir = dest if dest.is_dir() else dest.parent
        missing = [
            name
            for name in ("app.py", "engine.py", "spec.json", "render.yaml", "requirements.txt")
            if not (dest_dir / name).is_file()
        ]
        if missing:
            store.fail_wave(job, "verify", "missing " + ", ".join(missing))
            raise RuntimeError("verify failed: " + ", ".join(missing))
        from harness.recon_engine import run_workbook
        from openpyxl import Workbook

        book = Workbook()
        fa = book.active
        fa.title = "FA"
        fa.append(["id", "name"])
        fa.append(["1", "Ann"])
        fa.append(["2", "Ben"])
        lyft = book.create_sheet("Lyft")
        lyft.append(["id", "status"])
        lyft.append(["1", "Ride"])
        lyft.append(["2", "Cancel"])
        buf = io.BytesIO()
        book.save(buf)
        result = run_workbook(buf.getvalue(), "sample.xlsx")
        notes = " ".join(result.get("notes") or [])
        if "FormAssembly" not in notes:
            store.fail_wave(job, "verify", "engine hid the access boundary")
            raise RuntimeError("verify failed: access boundary")
        if result.get("matched") != 1 or result.get("non_matchable") != 1:
            store.fail_wave(job, "verify", "two-sheet match did not skip cancels")
            raise RuntimeError("verify failed: two-sheet match")
        store.pass_wave(job, "verify", "service files and two-sheet workbook match")
        return
    if not dest.is_file():
        store.fail_wave(job, "verify", "index.html missing")
        raise RuntimeError("shipped tool missing")
    body = dest.read_text(encoding="utf-8")
    missing = []
    if html.escape(TENANT_DISPLAY) not in body:
        missing.append("brand")
    if html.escape(spec.primary_action) not in body:
        missing.append("primary action")
    if html.escape(spec.title) not in body:
        missing.append("title")
    if f"--accent: {spec.accent}" not in body:
        missing.append("accent")
    if missing:
        store.fail_wave(job, "verify", "missing " + ", ".join(missing))
        raise RuntimeError("verify failed: " + ", ".join(missing))
    store.pass_wave(job, "verify", "brand, title, action, and accent present")
