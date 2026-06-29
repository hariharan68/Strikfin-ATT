"""
app.py  (backend)
-----------------
Launch entry point for the Strikfin backend.

Start the server from the backend/ folder with:

    uv run app.py                 # http://127.0.0.1:8000  (auto-reload)
    uv run app.py --port 8001     # override port
    uv run app.py --host 0.0.0.0  # bind all interfaces
    uv run app.py --no-reload     # disable auto-reload

Equivalent under the hood to: uvicorn app.main:app --reload
Always runs inside uv's managed Python 3.11 env, so the old
"No module named 'asyncpg'" (global Python 3.14) error can no longer happen.
"""
import os
import sys

import uvicorn


def main() -> None:
    # Force UTF-8 on this process's stdio so logs + the rich startup banner
    # render on Windows consoles that default to cp1252.
    for _stream in (sys.stdout, sys.stderr):
        try:
            _stream.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
        except Exception:
            pass

    argv = sys.argv[1:]

    def flag(name: str, default: str) -> str:
        if name in argv:
            return argv[argv.index(name) + 1]
        return os.getenv(name.lstrip("-").upper(), default)

    host = flag("--host", "127.0.0.1")
    port = int(flag("--port", "8000"))
    reload = "--no-reload" not in argv

    # Inherited by the reload child process so its banner/logs are UTF-8 too.
    os.environ.setdefault("PYTHONUTF8", "1")
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")

    # Hand the bind address to the app process so the startup banner can print
    # the correct URLs (inherited by the reload child via the environment).
    os.environ["STRIKFIN_HOST"] = host
    os.environ["STRIKFIN_PORT"] = str(port)

    run_kwargs = dict(host=host, port=port, reload=reload, log_level="info")
    if reload:
        run_kwargs["reload_dirs"] = ["."]

    uvicorn.run("app.main:app", **run_kwargs)


if __name__ == "__main__":
    main()
