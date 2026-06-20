"""
app/core/token_store.py
-----------------------
Manages Fyers access token storage and retrieval.
Reads from .env on startup.
Updates .env when a new token is generated.
Single user app — one token at a time.
"""
import os
import re
from datetime import datetime, timezone
from pathlib import Path

from app.core.config import settings

# ── In-memory token store ─────────────────────────────────────
_store: dict = {
    "access_token": settings.FYERS_ACCESS_TOKEN or "",
    "generated_at": None,
    "is_valid":     False,
}


# ─────────────────────────────────────────────────────────────
# GET
# ─────────────────────────────────────────────────────────────

def get_access_token() -> str | None:
    """Returns current access token or None if not set."""
    token = _store.get("access_token", "")
    return token if token else None


def is_token_valid() -> bool:
    """Check if we have a non-empty token."""
    return bool(_store.get("access_token", ""))


def get_token_info() -> dict:
    """Returns token metadata for status endpoint."""
    return {
        "has_token":     is_token_valid(),
        "generated_at":  _store.get("generated_at"),
        "vendor":        "fyers",
        "client_id":     settings.FYERS_CLIENT_ID,
        "app_id":        settings.FYERS_APP_ID,
    }


# ─────────────────────────────────────────────────────────────
# SET
# ─────────────────────────────────────────────────────────────

def set_access_token(token: str) -> None:
    """
    Store token in memory AND write to .env file.
    So app restart doesn't lose the token.
    """
    _store["access_token"] = token
    _store["generated_at"] = datetime.now(timezone.utc).isoformat()
    _store["is_valid"]     = True

    # Persist to .env
    _write_token_to_env(token)


def clear_access_token() -> None:
    """Clear token from memory and .env."""
    _store["access_token"] = ""
    _store["generated_at"] = None
    _store["is_valid"]     = False
    _write_token_to_env("")


# ─────────────────────────────────────────────────────────────
# .env writer
# ─────────────────────────────────────────────────────────────

def _write_token_to_env(token: str) -> None:
    """
    Updates FYERS_ACCESS_TOKEN line in .env file.
    If line doesn't exist, appends it.
    """
    env_path = Path(__file__).parent.parent.parent / ".env"

    if not env_path.exists():
        return

    content = env_path.read_text(encoding="utf-8")
    pattern = r"^FYERS_ACCESS_TOKEN=.*$"
    new_line = f"FYERS_ACCESS_TOKEN={token}"

    if re.search(pattern, content, flags=re.MULTILINE):
        content = re.sub(pattern, new_line, content, flags=re.MULTILINE)
    else:
        content = content.rstrip() + f"\n{new_line}\n"

    env_path.write_text(content, encoding="utf-8")