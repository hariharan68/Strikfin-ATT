"""
core/exceptions.py
------------------
All domain exceptions defined here.
Mapped cleanly to HTTP responses in main.py.
Never let raw DB or library errors reach the client.
"""
from fastapi import HTTPException, status


# ── Base ──────────────────────────────────────────────────────
class AppError(Exception):
    def __init__(self, message: str, code: str = "APP_ERROR"):
        self.message = message
        self.code = code
        super().__init__(message)


# ── Domain Errors ─────────────────────────────────────────────
class NotFoundError(AppError):
    def __init__(self, resource: str):
        super().__init__(f"{resource} not found", "NOT_FOUND")


class AuthenticationError(AppError):
    def __init__(self, message: str = "Authentication failed"):
        super().__init__(message, "AUTHENTICATION_ERROR")


class ConflictError(AppError):
    def __init__(self, message: str):
        super().__init__(message, "CONFLICT")


class ValidationError(AppError):
    def __init__(self, message: str):
        super().__init__(message, "VALIDATION_ERROR")


# ── HTTP Mapping ──────────────────────────────────────────────
def to_http_exception(exc: AppError) -> HTTPException:
    mapping = {
        "NOT_FOUND":            status.HTTP_404_NOT_FOUND,
        "AUTHENTICATION_ERROR": status.HTTP_401_UNAUTHORIZED,
        "CONFLICT":             status.HTTP_409_CONFLICT,
        "VALIDATION_ERROR":     status.HTTP_422_UNPROCESSABLE_ENTITY,
    }
    status_code = mapping.get(exc.code, status.HTTP_500_INTERNAL_SERVER_ERROR)
    return HTTPException(
        status_code=status_code,
        detail={
            "code":    exc.code,
            "message": exc.message,
        },
    )