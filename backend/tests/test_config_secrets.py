from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

from app import config


def test_environment_token_takes_precedence() -> None:
    def must_not_load_local() -> object:
        raise AssertionError("local secrets must not be loaded when env is set")

    assert config._resolve_mappls_prod_access_token(
        {"MAPPLS_PROD_ACCESS_TOKEN": "  ENV_TEST_TOKEN  "},
        must_not_load_local,
    ) == "ENV_TEST_TOKEN"


def test_local_secrets_fallback_works() -> None:
    assert config._resolve_mappls_prod_access_token(
        {"MAPPLS_PROD_ACCESS_TOKEN": "   "},
        lambda: "  LOCAL_TEST_TOKEN  ",
    ) == "LOCAL_TEST_TOKEN"


def test_local_module_loader_isolated_from_real_file(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_module = SimpleNamespace(
        MAPPLS_PROD_ACCESS_TOKEN="  MODULE_TEST_TOKEN  "
    )
    monkeypatch.setattr(
        config.importlib,
        "import_module",
        lambda name: fake_module if name == "app.local_secrets" else None,
    )
    assert config._load_local_mappls_token() == "MODULE_TEST_TOKEN"


def test_missing_environment_and_local_secret_returns_none() -> None:
    assert config._resolve_mappls_prod_access_token({}, lambda: None) is None
    assert config._resolve_mappls_prod_access_token({}, lambda: "   ") is None


def test_missing_local_module_returns_none(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def missing(name: str) -> object:
        raise ImportError(name)

    monkeypatch.setattr(config.importlib, "import_module", missing)
    assert config._load_local_mappls_token() is None


def test_tracked_example_contains_only_safe_placeholder() -> None:
    example = (
        Path(__file__).resolve().parents[1]
        / "app"
        / "local_secrets.example.py"
    )
    assert example.read_text(encoding="utf-8") == (
        'MAPPLS_PROD_ACCESS_TOKEN = "PUT_YOUR_TOKEN_HERE"\n'
    )
