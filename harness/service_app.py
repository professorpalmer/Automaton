from __future__ import annotations

"""Standalone operator service. Copied into a product dir for Render. Local preview loads this file."""

import csv
import io
import json
import sys
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, File, UploadFile
from fastapi.responses import HTMLResponse, Response

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

try:
    from engine import flatten_row, run_workbook, run_workbooks
except ImportError:
    from harness.recon_engine import flatten_row, run_workbook, run_workbooks


def _spec() -> dict:
    path = HERE / "spec.json"
    if not path.is_file():
        return {
            "title": "Operator tool",
            "lede": "",
            "primary_action": "Run reconciliation",
            "accent": "#1f5c45",
        }
    return json.loads(path.read_text(encoding="utf-8"))


app = FastAPI(title="Soldiers' Angels operator tool", docs_url=None, redoc_url=None)


def _page(body: str) -> str:
    spec = _spec()
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{_esc(spec.get("title", "Tool"))} · Soldiers' Angels</title>
  <style>
    :root {{ --bg:#f3efe6; --ink:#1c2a22; --muted:#5c6b62; --accent:{_esc(spec.get("accent", "#1f5c45"))}; --accent-ink:#f7f4ec; --display:Georgia,serif; --sans:"Segoe UI",sans-serif; }}
    * {{ box-sizing: border-box; }}
    body {{ margin:0; font-family:var(--sans); color:var(--ink); background:var(--bg); }}
    .page {{ width:min(760px, calc(100% - 2.5rem)); margin:0 auto; padding:1.5rem 0 3rem; }}
    .brand {{ font-family:var(--display); margin:0 0 2rem; }}
    h1 {{ font-family:var(--display); font-size:clamp(1.8rem,3vw,2.4rem); margin:0 0 0.5rem; }}
    .lede, .note, th, td {{ color:var(--muted); }}
    form {{ display:grid; gap:1rem; margin-top:1.5rem; }}
    button {{ justify-self:start; font:700 1rem var(--sans); background:var(--accent); color:var(--accent-ink); border:0; padding:0.7rem 1.2rem; cursor:pointer; }}
    table {{ width:100%; border-collapse:collapse; margin-top:1rem; }}
    th, td {{ text-align:left; padding:0.4rem 0; border-bottom:1px solid #d8d2c6; }}
    a {{ color:var(--ink); }}
  </style>
</head>
<body>
  <div class="page">
    <p class="brand">Soldiers' Angels</p>
    {body}
  </div>
</body>
</html>"""


def _esc(value: Any) -> str:
    return (
        str(value or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _kept_workbook() -> Path | None:
    for name in ("intake.xlsx", "intake.xlsm", "intake.xls", "intake.csv"):
        path = HERE / name
        if path.is_file():
            return path
    return None


@app.get("/", response_class=HTMLResponse)
def home() -> str:
    spec = _spec()
    kept = _kept_workbook()
    kept_block = ""
    if kept is not None:
        kept_block = (
            f"<p class=\"note\">I already have { _esc(kept.name) } from when we started.</p>"
            f"<form method=\"post\" action=\"run-kept\">"
            f"<button type=\"submit\">Run that file</button></form>"
        )
    return _page(
        f"<h1>{_esc(spec.get('title'))}</h1>"
        f"<p class=\"lede\">{_esc(spec.get('lede'))}</p>"
        f"<p class=\"note\">Upload this month's workbook. Live FormAssembly, Lyft, and SharePoint are not connected.</p>"
        f"{kept_block}"
        f"<form method=\"post\" action=\"run\" enctype=\"multipart/form-data\">"
        f"<label>Workbook or first CSV<input type=\"file\" name=\"upload\" accept=\".xlsx,.csv\" required /></label>"
        f"<label>Optional second CSV<input type=\"file\" name=\"other\" accept=\".csv,.xlsx\" /></label>"
        f"<button type=\"submit\">{_esc(spec.get('primary_action') or 'Run reconciliation')}</button>"
        f"</form>"
    )


def _export_dir() -> Path:
    dest = HERE / "exports"
    dest.mkdir(parents=True, exist_ok=True)
    return dest


def _write_exports(result: dict) -> None:
    dest = _export_dir()
    (dest / "ledger.csv").write_bytes(_csv(result.get("ledger") or []))
    (dest / "exceptions.csv").write_bytes(_csv(result.get("exception_rows") or []))


def _preview(title: str, rows: list, limit: int = 8) -> str:
    if not rows:
        return ""
    flat = [flatten_row(row) for row in rows[:limit]]
    keys: list[str] = []
    for row in flat:
        for key in row:
            if key not in keys:
                keys.append(key)
    head = "".join(f"<th>{_esc(key)}</th>" for key in keys)
    body = "".join(
        "<tr>"
        + "".join(f"<td>{_esc(row.get(key, ''))}</td>" for key in keys)
        + "</tr>"
        for row in flat
    )
    more = ""
    if len(rows) > limit:
        more = f"<p class=\"note\">Showing {limit} of {len(rows)}.</p>"
    return (
        f"<h2>{_esc(title)}</h2>"
        f"<table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>"
        f"{more}"
    )


def _result_page(result: dict) -> str:
    _write_exports(result)
    sheets = "".join(
        f"<tr><td>{_esc(sheet['name'])}</td><td>{sheet['rows']}</td></tr>"
        for sheet in result.get("sheets") or []
    )
    notes = "".join(f"<p class=\"note\">{_esc(note)}</p>" for note in result.get("notes") or [])
    return _page(
        f"<h1>{_esc(_spec().get('title'))}</h1>"
        f"<p class=\"lede\">Matched {result.get('matched', 0)}. "
        f"Exceptions {result.get('exceptions', 0)}. "
        f"Not matched (cancels) {result.get('non_matchable', 0)}.</p>"
        f"<table><thead><tr><th>Sheet</th><th>Rows</th></tr></thead><tbody>{sheets}</tbody></table>"
        f"{notes}"
        f"{_preview('Ledger', result.get('ledger') or [])}"
        f"{_preview('Exceptions', result.get('exception_rows') or [])}"
        f"<p><a href=\"export/ledger.csv\">Download ledger</a> · "
        f"<a href=\"export/exceptions.csv\">Download exceptions</a></p>"
        f"<p><a href=\"./\">Run another file</a></p>"
    )


@app.post("/run", response_class=HTMLResponse)
async def run(
    upload: UploadFile = File(...),
    other: Optional[UploadFile] = File(None),
) -> str:
    blobs = [(await upload.read(), upload.filename or "upload.xlsx")]
    if other is not None and (other.filename or "").strip():
        extra = await other.read()
        if extra:
            blobs.append((extra, other.filename))
    return _result_page(run_workbooks(blobs))


@app.post("/run-kept", response_class=HTMLResponse)
def run_kept() -> str:
    kept = _kept_workbook()
    if kept is None:
        return home()
    return _result_page(run_workbook(kept.read_bytes(), kept.name))


@app.get("/export/{name}")
def export(name: str) -> Response:
    key = "ledger.csv" if name.startswith("ledger") else "exceptions.csv"
    path = _export_dir() / key
    blob = path.read_bytes() if path.is_file() else b""
    return Response(content=blob, media_type="text/csv")


def _csv(rows: list) -> bytes:
    if not rows:
        return b""
    flat = [flatten_row(row) for row in rows]
    keys: list[str] = []
    for row in flat:
        for key in row:
            if key not in keys:
                keys.append(key)
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=keys, extrasaction="ignore")
    writer.writeheader()
    for row in flat:
        writer.writerow({key: row.get(key, "") for key in keys})
    return buf.getvalue().encode("utf-8")
