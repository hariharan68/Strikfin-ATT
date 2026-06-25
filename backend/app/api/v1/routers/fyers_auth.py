"""
app/api/v1/routers/fyers_auth.py
---------------------------------
Fyers OAuth token generation flow.

Step 1: GET  /api/v1/auth/fyers/login
        → Returns the Fyers login URL
        → User opens it in browser and logs in

Step 2: GET  /api/v1/auth/fyers/callback?auth_code=xxx
        → Fyers redirects here after login
        → We exchange auth_code for access_token
        → Token saved to memory + .env

Step 3: GET  /api/v1/auth/fyers/status
        → Check if token is valid

Step 4: DELETE /api/v1/auth/fyers/token
        → Clear token (logout from Fyers)
"""
import hashlib
import html
import logging

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import HTMLResponse

from app.core.config import settings
from app.core.deps import CurrentUserId
from app.core.token_store import (
    clear_access_token,
    get_token_info,
    set_access_token,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth/fyers", tags=["fyers-auth"])


# ─────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────

def _get_app_id() -> str:
    return settings.FYERS_APP_ID


def _get_secret() -> str:
    return settings.FYERS_SECRET_ID


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


# ─────────────────────────────────────────────────────────────
# STEP 1 — Generate Login URL
# ─────────────────────────────────────────────────────────────

@router.get("/login")
async def fyers_login():
    """
    Returns the Fyers OAuth login URL.
    Open this URL in browser to authenticate.
    After login, Fyers redirects to /callback with auth_code.
    """
    if not settings.FYERS_APP_ID or not settings.FYERS_SECRET_ID:
        raise HTTPException(
            status_code=500,
            detail={
                "code":    "FYERS_NOT_CONFIGURED",
                "message": "FYERS_APP_ID and FYERS_SECRET_ID not set in .env",
            },
        )

    try:
        from fyers_apiv3 import fyersModel

        session = fyersModel.SessionModel(
            client_id=_get_app_id(),
            secret_key=_get_secret(),
            redirect_uri=settings.FYERS_REDIRECT_URI,
            response_type="code",
            grant_type="authorization_code",
        )

        login_url = session.generate_authcode()

        logger.info(f"Fyers login URL generated for app: {_get_app_id()}")

        return {
            "login_url":    login_url,
            "instructions": [
                "1. Open the login_url in your browser",
                "2. Login with your Fyers credentials",
                "3. After login, you will be redirected back automatically",
                "4. Check /api/v1/auth/fyers/status to confirm token",
            ],
            "app_id":       _get_app_id(),
            "redirect_uri": settings.FYERS_REDIRECT_URI,
        }

    except Exception as e:
        logger.error(f"Fyers login URL generation failed: {e}")
        raise HTTPException(
            status_code=500,
            detail={
                "code":    "FYERS_LOGIN_ERROR",
                "message": str(e),
            },
        )


# ─────────────────────────────────────────────────────────────
# STEP 2 — OAuth Callback (Fyers redirects here)
# ─────────────────────────────────────────────────────────────

@router.get("/callback", response_class=HTMLResponse)
async def fyers_callback(
    auth_code: str = Query(..., alias="auth_code"),
    state:     str = Query(default="", alias="s"),
):
    """
    Fyers redirects here after user logs in.
    Exchanges auth_code for access_token.
    Saves token and shows success page.
    """
    try:
        from fyers_apiv3 import fyersModel

        session = fyersModel.SessionModel(
            client_id=_get_app_id(),
            secret_key=_get_secret(),
            redirect_uri=settings.FYERS_REDIRECT_URI,
            response_type="code",
            grant_type="authorization_code",
        )

        session.set_token(auth_code)
        response = session.generate_token()

        if response.get("code") != 200 or "access_token" not in response:
            error_msg = response.get("message", "Token generation failed")
            logger.error(f"Fyers token error: {response}")
            return _error_page(error_msg)

        access_token = response["access_token"]
        set_access_token(access_token)

        logger.info("✓ Fyers access token generated and saved successfully")

        return _success_page()

    except Exception as e:
        logger.error(f"Fyers callback error: {e}")
        return _error_page(str(e))


# ─────────────────────────────────────────────────────────────
# STEP 3 — Status Check
# ─────────────────────────────────────────────────────────────

@router.get("/status")
async def fyers_status():
    """
    Check if Fyers token is set and valid.
    Also verifies by calling Fyers profile API.
    """
    info = get_token_info()

    if not info["has_token"]:
        return {
            "connected":  False,
            "message":    "No token set. Visit /api/v1/auth/fyers/login",
            **info,
        }

    # Verify token with a live API call
    try:
        from app.ingestion.providers.fyers_provider import is_connected
        live_check = is_connected()
    except Exception:
        live_check = False

    return {
        "connected":   live_check,
        "message":     "Token active — Fyers connected" if live_check
                       else "Token set but Fyers API check failed",
        **info,
    }


# ─────────────────────────────────────────────────────────────
# STEP 4 — Clear Token
# ─────────────────────────────────────────────────────────────

@router.delete("/token")
async def clear_fyers_token(_uid: CurrentUserId):
    """Clear the Fyers access token."""
    clear_access_token()
    return {"message": "Fyers token cleared successfully"}


# ─────────────────────────────────────────────────────────────
# DEBUG — raw Fyers option-chain response
# ─────────────────────────────────────────────────────────────

@router.get("/debug/chain/{instrument_id}")
async def debug_chain(instrument_id: int, _uid: CurrentUserId):
    """
    Returns the raw Fyers optionchain response for inspection.
    Uses the shared, correctly-authenticated client (raw access token).
    """
    from app.ingestion.providers.fyers_provider import _get_fyers

    symbol = "NSE:NIFTY50-INDEX" if instrument_id == 1 else "BSE:SENSEX-INDEX"
    try:
        fyers = _get_fyers()
        return fyers.optionchain({
            "symbol": symbol,
            "strikecount": 5,
            "timestamp": "",
        })
    except Exception as e:
        logger.error(f"debug_chain failed: {e}")
        raise HTTPException(
            status_code=500,
            detail={"code": "FYERS_DEBUG_ERROR", "message": str(e)},
        )


# ─────────────────────────────────────────────────────────────
# MANUAL TOKEN SET (convenience for daily paste-in)
# ─────────────────────────────────────────────────────────────

@router.post("/token")
async def set_fyers_token_manually(payload: dict, _uid: CurrentUserId):
    """
    Manually set a Fyers access token.
    Useful when you generate the token externally.

    Body: { "access_token": "your_token_here" }
    """
    token = payload.get("access_token", "").strip()
    if not token:
        raise HTTPException(
            status_code=400,
            detail={
                "code":    "MISSING_TOKEN",
                "message": "access_token is required in request body",
            },
        )

    set_access_token(token)
    logger.info("✓ Fyers token set manually")

    return {
        "message": "Token set successfully",
        "status":  "connected",
    }


# ─────────────────────────────────────────────────────────────
# HTML RESPONSE PAGES
# ─────────────────────────────────────────────────────────────

def _success_page() -> str:
    return """
    <!DOCTYPE html>
    <html>
    <head>
        <title>Alphalytic AI — Fyers Connected</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
                font-family: 'Segoe UI', sans-serif;
                background: #f0f4f8;
                display: flex;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
            }
            .card {
                background: #fff;
                border-radius: 16px;
                padding: 48px 40px;
                text-align: center;
                border: 1px solid #e8eaf0;
                max-width: 420px;
                width: 90%;
            }
            .icon { font-size: 56px; margin-bottom: 20px; }
            .title {
                font-size: 22px;
                font-weight: 800;
                color: #111;
                margin-bottom: 8px;
            }
            .sub {
                font-size: 14px;
                color: #888;
                margin-bottom: 28px;
                line-height: 1.6;
            }
            .badge {
                display: inline-block;
                background: #dcfce7;
                color: #15803d;
                font-size: 13px;
                font-weight: 700;
                padding: 8px 20px;
                border-radius: 8px;
                margin-bottom: 24px;
            }
            .btn {
                display: block;
                background: #2350e8;
                color: #fff;
                text-decoration: none;
                padding: 12px 24px;
                border-radius: 9px;
                font-weight: 700;
                font-size: 14px;
                margin-top: 8px;
            }
            .app { font-size: 12px; color: #2350e8;
                   font-weight: 700; letter-spacing: 1px;
                   margin-bottom: 16px; }
        </style>
    </head>
    <body>
        <div class="card">
            <div class="app">ALPHALYTIC AI</div>
            <div class="icon">⚡</div>
            <div class="title">Fyers Connected!</div>
            <div class="sub">
                Your Fyers account has been successfully linked.<br>
                Live NIFTY 50 & SENSEX data is now active.
            </div>
            <div class="badge">✓ Token Saved Successfully</div>
            <a class="btn" href="http://localhost:5173/dashboard">
                Go to Dashboard →
            </a>
        </div>
    </body>
    </html>
    """


def _error_page(error: str) -> str:
    # Escape the error message — it can contain content from upstream
    # (Fyers SDK exceptions) and must never be rendered as raw HTML.
    error = html.escape(error)
    return f"""
    <!DOCTYPE html>
    <html>
    <head>
        <title>Alphalytic AI — Connection Failed</title>
        <style>
            * {{ margin: 0; padding: 0; box-sizing: border-box; }}
            body {{
                font-family: 'Segoe UI', sans-serif;
                background: #f0f4f8;
                display: flex;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
            }}
            .card {{
                background: #fff;
                border-radius: 16px;
                padding: 48px 40px;
                text-align: center;
                border: 1px solid #e8eaf0;
                max-width: 420px;
                width: 90%;
            }}
            .icon {{ font-size: 56px; margin-bottom: 20px; }}
            .title {{
                font-size: 22px;
                font-weight: 800;
                color: #111;
                margin-bottom: 8px;
            }}
            .error {{
                font-size: 12px;
                color: #dc2626;
                background: #fee2e2;
                padding: 10px 16px;
                border-radius: 8px;
                margin: 16px 0 24px;
                word-break: break-all;
            }}
            .btn {{
                display: block;
                background: #2350e8;
                color: #fff;
                text-decoration: none;
                padding: 12px 24px;
                border-radius: 9px;
                font-weight: 700;
                font-size: 14px;
            }}
        </style>
    </head>
    <body>
        <div class="card">
            <div class="icon">❌</div>
            <div class="title">Connection Failed</div>
            <div class="error">{error}</div>
            <a class="btn" href="/api/v1/auth/fyers/login">
                Try Again →
            </a>
        </div>
    </body>
    </html>
    """