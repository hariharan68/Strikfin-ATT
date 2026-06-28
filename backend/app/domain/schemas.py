"""
domain/schemas.py
-----------------
All Pydantic request/response schemas for Strikfin.
No DB access here — pure data shapes only.
"""
from datetime import datetime
from enum import IntEnum
from typing import Optional

from pydantic import BaseModel, EmailStr, field_validator


# ─────────────────────────────────────────────────────────────
# ENUMS
# ─────────────────────────────────────────────────────────────

class InstrumentId(IntEnum):
    NIFTY50 = 1
    SENSEX  = 2


class RegimeState(IntEnum):
    TREND_UP   = 1
    TREND_DOWN = 2
    SIDEWAYS   = 3
    BREAKOUT   = 4
    REVERSAL   = 5
    HIGH_VOL   = 6
    LOW_VOL    = 7


class Bias(IntEnum):
    BEARISH = -1
    NEUTRAL =  0
    BULLISH =  1


# ─────────────────────────────────────────────────────────────
# AUTH
# ─────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    email:        EmailStr
    password:     str
    display_name: Optional[str] = None

    @field_validator("password")
    @classmethod
    def password_min_length(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


class LoginRequest(BaseModel):
    email:    EmailStr
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class LogoutRequest(BaseModel):
    refresh_token: str


class TokenResponse(BaseModel):
    access_token:  str
    refresh_token: str
    token_type:    str = "bearer"
    expires_in:    int  # seconds


class UserOut(BaseModel):
    user_id:       int
    email:         str
    display_name:  Optional[str]
    is_active:     bool
    created_at:    datetime
    last_login_at: Optional[datetime]

    model_config = {"from_attributes": True}


# ─────────────────────────────────────────────────────────────
# MARKET DATA
# ─────────────────────────────────────────────────────────────

class IndexSnapshot(BaseModel):
    instrument_id: int
    symbol:        str
    last_price:    float
    open_price:    Optional[float]
    high_price:    Optional[float]
    low_price:     Optional[float]
    prev_close:    Optional[float]
    change_pct:    Optional[float]
    india_vix:     Optional[float]
    snap_ts:       datetime


class IndexLevels(BaseModel):
    instrument_id:   int
    symbol:          str
    spot:            float
    atm_strike:      float
    support_zone:    Optional[float]
    resistance_zone: Optional[float]
    as_of:           datetime


# ─────────────────────────────────────────────────────────────
# OPTIONS
# ─────────────────────────────────────────────────────────────

class OptionsMetrics(BaseModel):
    instrument_id:    int
    snap_ts:          datetime
    spot:             float
    atm_strike:       float
    pcr_oi:           float
    pcr_volume:       float
    max_pain_strike:  float
    support_strike:   Optional[float]
    resistance_strike:Optional[float]
    total_call_oi:    int
    total_put_oi:     int
    writing_posture:  str
    atm_iv:               Optional[float] = None
    iv_percentile:        Optional[float] = None
    iv_percentile_label:  Optional[str]   = None
    net_gex:              Optional[float] = None
    gamma_flip:           Optional[float] = None
    gex_label:            Optional[str]   = None


# ─────────────────────────────────────────────────────────────
# SMART MONEY
# ─────────────────────────────────────────────────────────────

class SmartMoneyRead(BaseModel):
    instrument_id:            int
    as_of:                    datetime
    spot:                     float
    aggregate_bias:           int
    aggregate_bias_label:     str
    aggregate_confidence:     float
    top_signals:              list[dict]
    total_signals_found:      int
    summary:                  str


# ─────────────────────────────────────────────────────────────
# INSTITUTIONAL
# ─────────────────────────────────────────────────────────────

class InstitutionalRead(BaseModel):
    trade_date:          str
    fii_cash_net_cr:     Optional[float]
    dii_cash_net_cr:     Optional[float]
    fii_idx_fut_net_cr:  Optional[float]
    rolling_5d_fii_net:  Optional[float]
    rolling_20d_fii_net: Optional[float]
    interpretation:      str
    is_provisional:      bool
    as_of:               datetime


# ─────────────────────────────────────────────────────────────
# SENTIMENT
# ─────────────────────────────────────────────────────────────

class SentimentRead(BaseModel):
    instrument_id:    int
    as_of:            datetime
    aggregate_score:  float
    label:            str
    confidence:       float
    headline_count:   int
    top_drivers:      list[str]


# ─────────────────────────────────────────────────────────────
# AI SIGNAL
# ─────────────────────────────────────────────────────────────

class AISignalOut(BaseModel):
    instrument_id:   int
    as_of:           datetime
    bias:            int
    bias_label:      str
    entry_ref:       Optional[float]
    stop_ref:        Optional[float]
    target_ref:      Optional[float]
    risk_reward:     Optional[float]
    confidence:      float
    reasoning:       str
    disclosure_mode: str
    model_version:   str
    disclaimer:      str = (
        "AI-generated intelligence only. NOT investment advice. "
        "AI usage disclosed per SEBI guidelines. "
        "Consult a SEBI-registered adviser before trading."
    )


# ─────────────────────────────────────────────────────────────
# DASHBOARD
# ─────────────────────────────────────────────────────────────

class DashboardSnapshot(BaseModel):
    as_of:          datetime
    market_hours:   bool
    nifty:          Optional[dict]
    sensex:         Optional[dict]
    nifty_signal:   Optional[AISignalOut]
    sensex_signal:  Optional[AISignalOut]
    institutional:  Optional[InstitutionalRead]
    ai_summary:     str
    disclaimer:     str


# ─────────────────────────────────────────────────────────────
# COPILOT
# ─────────────────────────────────────────────────────────────

class CopilotRequest(BaseModel):
    question:      str
    instrument_id: Optional[int] = None

    @field_validator("question")
    @classmethod
    def question_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Question cannot be empty")
        if len(v) > 500:
            raise ValueError("Max 500 characters")
        return v.strip()


class CopilotResponse(BaseModel):
    answer:     str
    sources:    list[str]
    confidence: float
    disclaimer: str = (
        "AI copilot answers are grounded in platform data only. "
        "NOT investment advice."
    )