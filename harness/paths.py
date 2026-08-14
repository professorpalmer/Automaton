from __future__ import annotations

from pathlib import Path


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def tenant_root(root: Path | None = None) -> Path:
    return (root or repo_root()) / "tenant"


def secrets_dir(root: Path | None = None) -> Path:
    return tenant_root(root) / "secrets"


def jobs_dir(root: Path | None = None) -> Path:
    return tenant_root(root) / "jobs"


def products_dir(root: Path | None = None) -> Path:
    return tenant_root(root) / "products"


def uploads_dir(root: Path | None = None) -> Path:
    return tenant_root(root) / "uploads"


def tenant_wiki_dir(root: Path | None = None) -> Path:
    return tenant_root(root) / "wiki"
