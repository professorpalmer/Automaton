from __future__ import annotations

from pathlib import Path
from typing import Optional


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def tenant_root(root: Optional[Path] = None) -> Path:
    return (root or repo_root()) / "tenant"


def org_root(root: Optional[Path] = None) -> Path:
    from harness.gates import tenant_slug

    return tenant_root(root) / tenant_slug()


def secrets_dir(root: Optional[Path] = None) -> Path:
    return org_root(root) / "secrets"


def jobs_dir(root: Optional[Path] = None) -> Path:
    return org_root(root) / "jobs"


def products_dir(root: Optional[Path] = None) -> Path:
    return org_root(root) / "products"


def uploads_dir(root: Optional[Path] = None) -> Path:
    return org_root(root) / "uploads"


def catalog_dir(root: Optional[Path] = None) -> Path:
    return org_root(root) / "catalog"


def projects_dir(root: Optional[Path] = None) -> Path:
    return org_root(root) / "projects"


def tenant_wiki_dir(root: Optional[Path] = None) -> Path:
    """Internal catalog. Not Portable LLM Wiki."""
    return catalog_dir(root)


def product_relpath(job_id: str, name: str = "index.html") -> str:
    from harness.gates import tenant_slug

    return f"tenant/{tenant_slug()}/products/{job_id}/{name}"
