from __future__ import annotations

import hashlib
import logging
import os
import secrets
import smtplib
import ssl
import threading
import time
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from typing import Annotated, Literal
from urllib.parse import urlencode

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, EmailStr, StringConstraints
from pwdlib import PasswordHash
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import PasswordResetToken, User, Wallet


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auth", tags=["authentication"])
bearer_scheme = HTTPBearer(auto_error=False)
password_hash = PasswordHash.recommended()


def _resolve_jwt_secret_key() -> str:
    secret = os.getenv("JWT_SECRET_KEY", "").strip()
    if len(secret) < 32:
        if os.getenv("APP_ENV", "").lower() == "production":
            raise RuntimeError(
                "JWT_SECRET_KEY must be set to at least 32 characters in production"
            )
        secret = secrets.token_urlsafe(32)
        os.environ["JWT_SECRET_KEY"] = secret
        logger.warning(
            "JWT_SECRET_KEY was missing or too short; generated a temporary secret for this process. "
            "Set a stable value in the environment to keep existing tokens valid across restarts."
        )
    return secret


JWT_SECRET_KEY = _resolve_jwt_secret_key()
JWT_ALGORITHM = "HS256"
JWT_ISSUER = "tizpay-api"
JWT_AUDIENCE = "tizpay-web"

ACCESS_TOKEN_MINUTES = 60
REMEMBERED_TOKEN_DAYS = 30
RESET_TOKEN_MINUTES = 30
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173").rstrip("/")


class InMemoryRateLimiter:
    def __init__(self) -> None:
        self._attempts: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def is_limited(self, key: str, limit: int, window_seconds: int) -> bool:
        now = time.monotonic()
        cutoff = now - window_seconds
        with self._lock:
            recent = [attempt for attempt in self._attempts.get(key, []) if attempt > cutoff]
            if len(recent) >= limit:
                self._attempts[key] = recent
                return True
            recent.append(now)
            self._attempts[key] = recent
            return False


rate_limiter = InMemoryRateLimiter()


def _client_key(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",", 1)[0].strip()
    return request.client.host if request.client else "unknown"


def _validate_password(password: str) -> None:
    if len(password) < 8:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must be at least 8 characters.",
        )
    if not any(character.islower() for character in password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must contain at least one lowercase letter.",
        )
    if not any(character.isupper() for character in password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must contain at least one uppercase letter.",
        )
    if not any(character.isdigit() for character in password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must contain at least one number.",
        )


class SignupRequest(BaseModel):
    email: EmailStr
    full_name: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=2, max_length=100)
    ]
    password: Annotated[str, StringConstraints(min_length=8, max_length=128)]


class LoginRequest(BaseModel):
    email: EmailStr
    password: Annotated[str, StringConstraints(max_length=128)]
    remember_me: bool = False


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetConfirm(BaseModel):
    token: Annotated[str, StringConstraints(min_length=32, max_length=128)]
    new_password: Annotated[str, StringConstraints(min_length=8, max_length=128)]


class UserResponse(BaseModel):
    id: int
    email: str
    full_name: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    user: UserResponse


class SignupResponse(BaseModel):
    message: str


def _normalized_email(email: EmailStr) -> str:
    return str(email).strip().lower()


def _user_response(user: User) -> UserResponse:
    return UserResponse(id=user.id, email=user.email, full_name=user.full_name)


def _create_access_token(user: User, remember_me: bool = False) -> str:
    lifetime = (
        timedelta(days=REMEMBERED_TOKEN_DAYS)
        if remember_me
        else timedelta(minutes=ACCESS_TOKEN_MINUTES)
    )
    now = datetime.now(timezone.utc)
    expires_at = now + lifetime
    return jwt.encode(
        {
            "sub": str(user.id),
            "ver": user.auth_version,
            "iss": JWT_ISSUER,
            "aud": JWT_AUDIENCE,
            "iat": int(now.timestamp()),
            "exp": int(expires_at.timestamp()),
        },
        JWT_SECRET_KEY,
        algorithm=JWT_ALGORITHM,
    )


def _token_digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _smtp_settings() -> tuple[str, str, int, bool]:
    host = os.getenv("SMTP_HOST", "").strip()
    sender = os.getenv("SMTP_FROM", "").strip()
    use_ssl = os.getenv("SMTP_USE_SSL", "").lower() in {"1", "true", "yes"}
    try:
        port = int(os.getenv("SMTP_PORT", "465" if use_ssl else "587"))
    except ValueError:
        port = 0
    if not host or not sender or not 1 <= port <= 65535:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Password reset email is not configured correctly. Contact the administrator.",
        )
    return host, sender, port, use_ssl


def _send_password_reset_email(email: str, token: str) -> None:
    host, sender, port, use_ssl = _smtp_settings()
    message = EmailMessage()
    message["Subject"] = "Reset your TizPay password"
    message["From"] = sender
    message["To"] = email
    reset_url = f"{FRONTEND_URL}/?{urlencode({'reset_token': token})}"
    message.set_content(
        "We received a request to reset your TizPay password.\n\n"
        f"Use this one-time link within {RESET_TOKEN_MINUTES} minutes:\n{reset_url}\n\n"
        "If you did not request this, you can ignore this email."
    )

    username = os.getenv("SMTP_USERNAME")
    smtp_password = os.getenv("SMTP_PASSWORD")
    try:
        smtp_class = smtplib.SMTP_SSL if use_ssl else smtplib.SMTP
        with smtp_class(host, port, timeout=10) as server:
            if not use_ssl:
                server.starttls(context=ssl.create_default_context())
            if username or smtp_password:
                if not username or not smtp_password:
                    raise ValueError("Both SMTP_USERNAME and SMTP_PASSWORD are required")
                server.login(username, smtp_password)
            server.send_message(message)
    except (OSError, smtplib.SMTPException, ValueError) as exc:
        logger.exception("Could not send password-reset email")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="The password reset email could not be sent. Please try again later.",
        ) from exc


def get_current_user(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None, Depends(bearer_scheme)
    ],
    session: Annotated[Session, Depends(get_db)],
) -> User:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication required",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if credentials is None:
        raise unauthorized

    try:
        payload = jwt.decode(
            credentials.credentials,
            JWT_SECRET_KEY,
            algorithms=[JWT_ALGORITHM],
            issuer=JWT_ISSUER,
            audience=JWT_AUDIENCE,
            options={"require": ["sub", "ver", "exp"]},
        )
        user_id = int(payload["sub"])
        auth_version = int(payload["ver"])
    except (jwt.InvalidTokenError, KeyError, TypeError, ValueError):
        raise unauthorized from None

    user = session.get(User, user_id)
    if user is None or user.auth_version != auth_version:
        raise unauthorized
    return user


@router.post("/signup", response_model=SignupResponse, status_code=201)
def signup(
    request: SignupRequest,
    http_request: Request,
    session: Annotated[Session, Depends(get_db)],
):
    if rate_limiter.is_limited(f"signup:{_client_key(http_request)}", 10, 3600):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many signup attempts. Please try again later.",
        )
    _validate_password(request.password)
    user = User(
        email=_normalized_email(request.email),
        full_name=request.full_name,
        password_hash=password_hash.hash(request.password),
    )
    session.add(user)
    try:
        session.flush()
        session.add(Wallet(user_id=user.id, owner_name=user.full_name, balance_cents=0))
        session.commit()
        session.refresh(user)
    except IntegrityError:
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists.",
        ) from None

    return SignupResponse(
        message="Account created successfully. Please sign in."
    )


@router.post("/login", response_model=TokenResponse)
def login(
    request: LoginRequest,
    http_request: Request,
    session: Annotated[Session, Depends(get_db)],
):
    client_key = _client_key(http_request)
    email_key = _normalized_email(request.email)
    if rate_limiter.is_limited(f"login-ip:{client_key}", 20, 900) or rate_limiter.is_limited(
        f"login-email:{email_key}", 10, 900
    ):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many login attempts. Please try again later.",
        )

    user = session.scalar(
        select(User).where(User.email == email_key)
    )
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not password_hash.verify(request.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return TokenResponse(
        access_token=_create_access_token(user, request.remember_me),
        user=_user_response(user),
    )


@router.get("/me", response_model=UserResponse)
def current_account(user: Annotated[User, Depends(get_current_user)]):
    return _user_response(user)


@router.post("/password-reset", status_code=202)
def request_password_reset(
    request: PasswordResetRequest,
    http_request: Request,
    session: Annotated[Session, Depends(get_db)],
):
    if rate_limiter.is_limited(
        f"reset-ip:{_client_key(http_request)}", 5, 3600
    ) or rate_limiter.is_limited(
        f"reset-email:{_normalized_email(request.email)}", 3, 3600
    ):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many password reset requests. Please try again later.",
        )
    _smtp_settings()
    user = session.scalar(
        select(User).where(User.email == _normalized_email(request.email))
    )
    if user is not None:
        expired_tokens = session.scalars(
            select(PasswordResetToken).where(
                PasswordResetToken.user_id == user.id,
                PasswordResetToken.used_at.is_(None),
                PasswordResetToken.expires_at > datetime.now(timezone.utc),
            )
        ).all()
        for reset_record in expired_tokens:
            reset_record.used_at = datetime.now(timezone.utc)

        token = secrets.token_urlsafe(32)
        reset_record = PasswordResetToken(
            user_id=user.id,
            token_hash=_token_digest(token),
            expires_at=datetime.now(timezone.utc)
            + timedelta(minutes=RESET_TOKEN_MINUTES),
        )
        session.add(reset_record)
        try:
            session.flush()
            _send_password_reset_email(user.email, token)
            session.commit()
        except HTTPException:
            session.rollback()
            raise
        except Exception:
            session.rollback()
            raise

    return {
        "message": "If an account exists for that email, password reset instructions have been sent."
    }


@router.post("/password-reset/confirm")
def confirm_password_reset(
    request: PasswordResetConfirm, session: Annotated[Session, Depends(get_db)]
):
    _validate_password(request.new_password)
    reset_record = session.scalar(
        select(PasswordResetToken).where(
            PasswordResetToken.token_hash == _token_digest(request.token),
            PasswordResetToken.used_at.is_(None),
            PasswordResetToken.expires_at > datetime.now(timezone.utc),
        ).with_for_update()
    )
    if reset_record is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This password reset link is invalid or has expired.",
        )

    user = session.get(User, reset_record.user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This password reset link is invalid or has expired.",
        )

    user.password_hash = password_hash.hash(request.new_password)
    user.auth_version += 1
    reset_record.used_at = datetime.now(timezone.utc)
    session.commit()
    return {"message": "Your password has been reset. Sign in with your new password."}
