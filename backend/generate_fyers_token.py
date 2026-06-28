"""
generate_fyers_token.py
-----------------------
Run this script every morning before market opens.
It opens the Fyers login page in your browser,
captures the auth code, and saves the token to .env
automatically.

Usage:
    cd backend
    python generate_fyers_token.py

Time: Run between 08:00 - 09:00 IST every trading day.
Token is valid for the full trading day.
"""
import hashlib
import sys
import webbrowser
from pathlib import Path
from urllib.parse import parse_qs, urlparse

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent))


def main():
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print("  Strikfin — Fyers Token Generator")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

    # ── Load settings ─────────────────────────────────────────
    try:
        from app.core.config import settings
    except Exception as e:
        print(f"\n✗ Could not load settings: {e}")
        print("  Make sure you are running from the backend/ folder")
        print("  and your .env file exists.")
        sys.exit(1)

    app_id       = settings.FYERS_APP_ID
    secret_id    = settings.FYERS_SECRET_ID
    redirect_uri = settings.FYERS_REDIRECT_URI

    if not app_id or not secret_id:
        print("\n✗ FYERS_APP_ID or FYERS_SECRET_ID not set in .env")
        print("  Please update your backend/.env file.")
        sys.exit(1)

    print(f"\n  App ID       : {app_id}")
    print(f"  Redirect URI : {redirect_uri}")
    print(f"  Client ID    : {settings.FYERS_CLIENT_ID}")

    # ── Generate login URL ────────────────────────────────────
    try:
        from fyers_apiv3 import fyersModel
    except ImportError:
        print("\n✗ fyers-apiv3 not installed.")
        print("  Run: pip install fyers-apiv3")
        sys.exit(1)

    print("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print("  Step 1 — Opening Fyers login page...")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

    try:
        session = fyersModel.SessionModel(
            client_id=app_id,
            secret_key=secret_id,
            redirect_uri=redirect_uri,
            response_type="code",
            grant_type="authorization_code",
        )
        login_url = session.generate_authcode()
    except Exception as e:
        print(f"\n✗ Failed to generate login URL: {e}")
        sys.exit(1)

    print(f"\n  Login URL:\n  {login_url}\n")

    # Open browser automatically
    try:
        webbrowser.open(login_url)
        print("  ✓ Browser opened automatically.")
        print("  If browser did not open, copy the URL above manually.\n")
    except Exception:
        print("  Could not open browser automatically.")
        print("  Please copy and open the URL above manually.\n")

    # ── Wait for auth code ────────────────────────────────────
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print("  Step 2 — After login, Fyers will redirect to:")
    print(f"  {redirect_uri}?auth_code=XXXXXX")
    print("")
    print("  Copy the FULL redirect URL from your browser")
    print("  and paste it below.")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

    while True:
        redirect_url = input("\n  Paste the full redirect URL here:\n  > ").strip()

        if not redirect_url:
            print("  ✗ Empty input. Please paste the URL.")
            continue

        # Extract auth_code from URL
        try:
            parsed    = urlparse(redirect_url)
            params    = parse_qs(parsed.query)
            auth_code = params.get("auth_code", [None])[0]

            if not auth_code:
                # Try 's' param or direct code
                auth_code = (
                    params.get("code", [None])[0] or
                    params.get("auth_code", [None])[0]
                )

            if not auth_code:
                print(f"\n  ✗ Could not find auth_code in URL.")
                print(f"  URL params found: {dict(params)}")
                print(f"  Please check the URL and try again.")
                continue

            print(f"\n  ✓ Auth code extracted: {auth_code[:20]}...")
            break

        except Exception as e:
            print(f"\n  ✗ Error parsing URL: {e}")
            print("  Please paste the complete redirect URL.")
            continue

    # ── Exchange auth code for access token ───────────────────
    print("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print("  Step 3 — Generating access token...")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

    try:
        session.set_token(auth_code)
        response = session.generate_token()

        if response.get("code") != 200:
            print(f"\n  ✗ Token generation failed:")
            print(f"  {response}")
            sys.exit(1)

        access_token = response.get("access_token", "")
        if not access_token:
            print(f"\n  ✗ No access_token in response: {response}")
            sys.exit(1)

        print(f"\n  ✓ Access token received!")
        print(f"  Token preview: {access_token[:30]}...")

    except Exception as e:
        print(f"\n  ✗ Token exchange failed: {e}")
        sys.exit(1)

    # ── Save token to .env ────────────────────────────────────
    print("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print("  Step 4 — Saving token to .env...")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

    try:
        _save_token_to_env(access_token)
        print("\n  ✓ Token saved to .env successfully!")
    except Exception as e:
        print(f"\n  ✗ Could not save to .env: {e}")
        print(f"\n  Please manually add this to your .env:")
        print(f"  FYERS_ACCESS_TOKEN={access_token}")

    # ── Verify connection ─────────────────────────────────────
    print("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print("  Step 5 — Verifying Fyers connection...")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

    try:
        full_token = f"{app_id}:{access_token}"
        fyers = fyersModel.FyersModel(
            client_id=app_id,
            token=full_token,
            log_path="",
            is_async=False,
        )
        profile = fyers.get_profile()

        if profile.get("code") == 200:
            name = profile.get("data", {}).get("name", "Unknown")
            fy_id = profile.get("data", {}).get("fy_id", "")
            print(f"\n  ✓ Connected as: {name} ({fy_id})")
        else:
            print(f"\n  ⚠ Token saved but profile check failed: {profile}")

    except Exception as e:
        print(f"\n  ⚠ Could not verify: {e}")
        print("  Token was saved. Try restarting the backend.")

    # ── Done ──────────────────────────────────────────────────
    print("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print("  ✓ Fyers setup complete!")
    print("")
    print("  Next steps:")
    print("  1. Restart the backend server")
    print("     uvicorn app.main:app --reload --port 8000")
    print("")
    print("  2. Update .env:")
    print("     MARKET_DATA_VENDOR=fyers")
    print("")
    print("  3. Open Strikfin")
    print("     http://localhost:5173")
    print("")
    print("  Live NIFTY 50 & SENSEX data will now flow!")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")


def _save_token_to_env(token: str) -> None:
    """Write FYERS_ACCESS_TOKEN to .env file."""
    import re
    env_path = Path(__file__).parent / ".env"

    if not env_path.exists():
        raise FileNotFoundError(f".env not found at {env_path}")

    content = env_path.read_text(encoding="utf-8")
    pattern = r"^FYERS_ACCESS_TOKEN=.*$"
    new_line = f"FYERS_ACCESS_TOKEN={token}"

    if re.search(pattern, content, flags=re.MULTILINE):
        content = re.sub(pattern, new_line, content, flags=re.MULTILINE)
    else:
        content = content.rstrip() + f"\n{new_line}\n"

    env_path.write_text(content, encoding="utf-8")


if __name__ == "__main__":
    main()