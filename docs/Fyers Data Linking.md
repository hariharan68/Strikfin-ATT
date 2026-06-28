# Fyers Data Linking

## Overview

Strikfin uses the **Fyers API v3** to fetch live market data for NIFTY 50, SENSEX, India VIX, and option chains. The backend authenticates via OAuth2 and stores the access token in the `.env` file.

---

## Why Live Data Stops Working

Fyers access tokens **expire every day**. When the token expires:
- The backend logs a warning and falls back to **mock/stale data**
- The dashboard shows old prices that no longer reflect the market
- The source field in the API response changes from `"fyers"` to `"mock_fallback"` or `"fyers_cached"`

This must be fixed each morning by regenerating a fresh token.

---

## How to Regenerate the Token (Daily)

### Step 1 — Start the Backend

Make sure the backend server is running at `http://localhost:8000`.

```bash
cd backend
uvicorn app.main:app --reload
```

### Step 2 — Get the Login URL

Open your browser or use any REST client and hit:

```
GET http://localhost:8000/api/v1/auth/fyers/login
```

This returns a JSON response like:

```json
{
  "login_url": "https://api-t1.fyers.in/api/v3/generate-authcode?client_id=9ZV5ECCREG-100&redirect_uri=http%3A%2F%2F127.0.0.1%3A8000%2Fapi%2Fv1%2Fauth%2Ffyers%2Fcallback&response_type=code&state=None",
  "instructions": [
    "1. Open the login_url in your browser",
    "2. Login with your Fyers credentials",
    "3. After login, you will be redirected back automatically",
    "4. Check /api/v1/auth/fyers/status to confirm token"
  ],
  "app_id": "9ZV5ECCREG-100",
  "redirect_uri": "http://127.0.0.1:8000/api/v1/auth/fyers/callback"
}
```

### Step 3 — Open the Login URL

Copy the `login_url` from the response and open it in your browser. Log in with your Fyers credentials.

### Step 4 — Automatic Callback

After successful login, Fyers redirects to:

```
http://127.0.0.1:8000/api/v1/auth/fyers/callback
```

The backend captures the auth code, exchanges it for an access token, and saves it automatically to `backend/.env` under `FYERS_ACCESS_TOKEN`.

### Step 5 — Confirm the Token

Check token status:

```
GET http://localhost:8000/api/v1/auth/fyers/status
```

Expected response when authenticated:

```json
{
  "has_token": true,
  "vendor": "fyers",
  "app_id": "9ZV5ECCREG-100"
}
```

### Step 6 — Refresh the Dashboard

Reload the Strikfin dashboard. Live data (NIFTY 50, SENSEX, VIX, option chain) will resume immediately.

---

## How the Token Is Stored

- **In memory**: Available immediately after login for all API requests
- **In `.env` file**: Persisted as `FYERS_ACCESS_TOKEN=<token>` so the app survives server restarts within the same day

File location: `backend/.env`

---

## Data Fetched from Fyers

| Data | Symbol | Cache TTL |
|------|--------|-----------|
| NIFTY 50 spot price | `NSE:NIFTY50-INDEX` | 35 seconds |
| SENSEX spot price | `BSE:SENSEX-INDEX` | 35 seconds |
| India VIX | `NSE:INDIAVIX-INDEX` | 120 seconds |
| NIFTY option chain | `NSE:NIFTY50-INDEX` | 95 seconds |
| SENSEX option chain | `BSE:SENSEX-INDEX` | 95 seconds |

---

## Fallback Behavior

If Fyers data fetch fails (expired token, network error, rate limit):

1. **Last known live value** is served with source `"fyers_cached"` if available
2. **Mock data** is served with source `"mock_fallback"` if no live value was ever cached

The dashboard may show stale or placeholder prices in this case.

---

## Fyers App Credentials

| Field | Value |
|-------|-------|
| App ID | `9ZV5ECCREG-100` |
| Client ID | `9ZV5ECCREG-100` |
| Redirect URI | `http://127.0.0.1:8000/api/v1/auth/fyers/callback` |

---

## Checklist for Each Trading Day

- [ ] Start the backend server
- [ ] Hit `GET /api/v1/auth/fyers/login`
- [ ] Open the `login_url` in browser and log in
- [ ] Confirm token via `GET /api/v1/auth/fyers/status`
- [ ] Refresh the dashboard and verify live prices
