from __future__ import annotations

import hashlib
import logging
import os
import secrets
import smtplib
import ssl
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from typing import Annotated, Literal
from urllib.parse import urlencode

import jwt
from fastapi import APIRouter, Depends, HTTPException, status
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
dummy_password_hash = password_hash.hash("not-a-real-user-password")

JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "")
if len(JWT_SECRET_KEY) < 32:
    raise RuntimeError("JWT_SECRET_KEY must be at least 32 characters long")

ACCESS_TOKEN_MINUTES = 60
REMEMBERED_TOKEN_DAYS = 30
RESET_TOKEN_MINUTES = 30
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173").rstrip("/")


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
    expires_at = datetime.now(timezone.utc) + lifetime
    return jwt.encode(
        {"sub": str(user.id), "ver": user.auth_version, "exp": expires_at},
        JWT_SECRET_KEY,
        algorithm="HS256",
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
            credentials.credentials, JWT_SECRET_KEY, algorithms=["HS256"]
        )
        user_id = int(payload["sub"])
        auth_version = int(payload["ver"])
    except (jwt.InvalidTokenError, KeyError, TypeError, ValueError):
        raise unauthorized from None

    user = session.get(User, user_id)
    if user is None or user.auth_version != auth_version:
        raise unauthorized
    return user


@router.post("/signup", response_model=TokenResponse, status_code=201)
def signup(request: SignupRequest, session: Annotated[Session, Depends(get_db)]):
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

    return TokenResponse(access_token=_create_access_token(user), user=_user_response(user))


@router.post("/login", response_model=TokenResponse)
def login(request: LoginRequest, session: Annotated[Session, Depends(get_db)]):
    user = session.scalar(
        select(User).where(User.email == _normalized_email(request.email))
    )
    hashed_password = user.password_hash if user is not None else dummy_password_hash
    if not password_hash.verify(request.password, hashed_password) or user is None:
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
    request: PasswordResetRequest, session: Annotated[Session, Depends(get_db)]
):
    _smtp_settings()
    user = session.scalar(
        select(User).where(User.email == _normalized_email(request.email))
    )
    if user is not None:
        token = secrets.token_urlsafe(32)
        reset_record = PasswordResetToken(
            user_id=user.id,
            token_hash=_token_digest(token),
            expires_at=datetime.now(timezone.utc)
            + timedelta(minutes=RESET_TOKEN_MINUTES),
        )
        session.add(reset_record)
        session.flush()
        _send_password_reset_email(user.email, token)
        session.commit()

    return {
        "message": "If an account exists for that email, password reset instructions have been sent."
    }


@router.post("/password-reset/confirm")
def confirm_password_reset(
    request: PasswordResetConfirm, session: Annotated[Session, Depends(get_db)]
):
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
