"""
core/banner.py
--------------
Renders the structured startup banner (rich Panel) shown when the server boots.
"""
import os
import sys

from rich.align import Align
from rich.console import Console, Group
from rich.panel import Panel
from rich.table import Table
from rich.text import Text

from app.core.config import settings

TAGLINE = "Institutional-Grade Market Intelligence Terminal"


def print_startup_banner(host: str | None = None, port: int | None = None) -> None:
    """Print the boxed, colored startup banner to stdout."""
    # Windows consoles often default to cp1252, which cannot encode the box/✓
    # glyphs. Force UTF-8 so the panel renders instead of crashing.
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    except Exception:
        pass
    console = Console(legacy_windows=False)

    host = host or os.getenv("STRIKFIN_HOST", "127.0.0.1")
    port = int(port or os.getenv("STRIKFIN_PORT", "8000"))
    base = f"http://{host}:{port}"

    # ── Endpoints table (label → URL) ─────────────────────────
    endpoints = Table.grid(padding=(0, 2))
    endpoints.add_column(style="bold white", justify="left")
    endpoints.add_column(style="cyan")
    endpoints.add_row("API", base)
    endpoints.add_row("Swagger", f"{base}/api/docs")
    endpoints.add_row("ReDoc", f"{base}/api/redoc")
    endpoints.add_row("Health", f"{base}/health")

    # ── Runtime context ───────────────────────────────────────
    context = Text()
    context.append("ENV ", style="bold white")
    context.append(settings.APP_ENV, style="yellow")
    context.append("   ·   Vendor ", style="bold white")
    context.append(settings.MARKET_DATA_VENDOR, style="yellow")
    context.append("   ·   LLM ", style="bold white")
    context.append(settings.LLM_PROVIDER, style="yellow")

    status = Text()
    status.append("Status   ", style="bold white")
    status.append("Ready", style="bold green")

    body = Group(
        Align.center(Text(TAGLINE, style="italic bright_white")),
        Text(""),
        Text("Endpoints", style="bold white"),
        endpoints,
        Text(""),
        context,
        Text(""),
        status,
    )

    panel = Panel(
        body,
        title=f"[bold green]{settings.APP_NAME} v{settings.APP_VERSION}[/]",
        title_align="left",
        border_style="green",
        padding=(1, 3),
        expand=False,
    )

    console.print()
    console.print("[green]✔[/] Configuration loaded "
                  f"([cyan]{settings.APP_ENV}[/])")
    console.print(panel)
