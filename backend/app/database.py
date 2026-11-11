from __future__ import annotations

import os
from pathlib import Path
from typing import Generator

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


BASE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_SQLITE_PATH = BASE_DIR / "tizpay.db"


def _get_database_url() -> str:
    configured_url = os.getenv("DATABASE_URL") or os.getenv("SQLALCHEMY_DATABASE_URL")
    if configured_url:
        return configured_url

    return f"sqlite:///{DEFAULT_SQLITE_PATH}"


DATABASE_URL = _get_database_url()


class Base(DeclarativeBase):
    pass


engine: Engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def create_database() -> None:
    Base.metadata.create_all(bind=engine)
    with engine.begin() as connection:
        wallet_columns = {
            column["name"] for column in inspect(connection).get_columns("wallets")
        }
        transaction_columns = {
            column["name"]
            for column in inspect(connection).get_columns("transactions")
        }
        if "user_id" not in wallet_columns:
            connection.execute(
                text(
                    "ALTER TABLE wallets ADD COLUMN user_id INTEGER "
                    "REFERENCES users(id) ON DELETE CASCADE"
                )
            )
        if "wallet_id" not in transaction_columns:
            connection.execute(
                text(
                    "ALTER TABLE transactions ADD COLUMN wallet_id INTEGER "
                    "REFERENCES wallets(id) ON DELETE CASCADE"
                )
            )
        connection.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_wallets_user_id "
                "ON wallets (user_id)"
            )
        )
        connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_transactions_wallet_id "
                "ON transactions (wallet_id)"
            )
        )
