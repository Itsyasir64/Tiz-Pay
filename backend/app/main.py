from contextlib import asynccontextmanager
from datetime import date, datetime, time, timedelta, timezone
import os
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.auth import get_current_user, router as auth_router
from app.database import create_database, get_db
from app.models import Transaction, User, Wallet


def initialize_database() -> None:
    create_database()


@asynccontextmanager
async def lifespan(_: FastAPI):
    initialize_database()
    yield


app = FastAPI(title="Tiz Pay API", version="0.1.0", lifespan=lifespan)
app.include_router(auth_router)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv(
        "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


class TransferRequest(BaseModel):
    recipient: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=2, max_length=100)
    ]
    amount_cents: int = Field(gt=0, le=10_000_000)


def transaction_data(transaction: Transaction) -> dict[str, int | str | datetime]:
    return {
        "id": transaction.id,
        "title": transaction.title,
        "category": transaction.category,
        "amount_cents": transaction.amount_cents,
        "direction": transaction.direction,
        "status": transaction.status,
        "created_at": transaction.created_at,
    }


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/overview")
def overview(
    user: Annotated[User, Depends(get_current_user)],
    session: Session = Depends(get_db),
):
    wallet = session.scalar(select(Wallet).where(Wallet.user_id == user.id))
    if wallet is None:
        raise HTTPException(status_code=404, detail="Wallet was not found")
    transactions = session.scalars(
        select(Transaction)
        .where(Transaction.wallet_id == wallet.id)
        .order_by(Transaction.created_at.desc())
        .limit(8)
    ).all()
    totals = session.execute(
        select(
            func.coalesce(
                func.sum(
                    case(
                        (Transaction.direction == "in", Transaction.amount_cents),
                        else_=0,
                    )
                ),
                0,
            ).label("income_cents"),
            func.coalesce(
                func.sum(
                    case(
                        (Transaction.direction == "out", Transaction.amount_cents),
                        else_=0,
                    )
                ),
                0,
            ).label("spending_cents"),
        )
        .where(Transaction.wallet_id == wallet.id)
    ).one()
    return {
        "owner_name": wallet.owner_name,
        "email": user.email,
        "balance_cents": wallet.balance_cents,
        "currency": wallet.currency,
        "income_cents": totals.income_cents,
        "spending_cents": totals.spending_cents,
        "transactions": [transaction_data(item) for item in transactions],
    }


@app.get("/api/transactions")
def transactions(
    user: Annotated[User, Depends(get_current_user)],
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    session: Session = Depends(get_db),
):
    if (start_date is None) != (end_date is None):
        raise HTTPException(
            status_code=422, detail="Provide both start_date and end_date"
        )
    if start_date is not None and end_date is not None and start_date > end_date:
        raise HTTPException(
            status_code=422, detail="start_date must be on or before end_date"
        )

    wallet = session.scalar(select(Wallet).where(Wallet.user_id == user.id))
    if wallet is None:
        raise HTTPException(status_code=404, detail="Wallet was not found")

    statement = (
        select(Transaction)
        .where(Transaction.wallet_id == wallet.id)
        .order_by(Transaction.created_at.desc())
    )
    if start_date is not None and end_date is not None:
        range_start = datetime.combine(start_date, time.min, tzinfo=timezone.utc)
        range_end = datetime.combine(
            end_date + timedelta(days=1), time.min, tzinfo=timezone.utc
        )
        statement = statement.where(
            Transaction.created_at >= range_start,
            Transaction.created_at < range_end,
        )
    else:
        statement = statement.limit(50)

    items = session.scalars(statement).all()
    return [transaction_data(item) for item in items]


@app.post("/api/transfers", status_code=201)
def create_transfer(
    request: TransferRequest,
    user: Annotated[User, Depends(get_current_user)],
    session: Session = Depends(get_db),
):
    wallet = session.scalar(
        select(Wallet).where(Wallet.user_id == user.id).with_for_update()
    )
    if wallet is None:
        raise HTTPException(status_code=404, detail="Wallet was not found")
    if request.amount_cents > wallet.balance_cents:
        raise HTTPException(status_code=400, detail="Insufficient wallet balance")

    wallet.balance_cents -= request.amount_cents
    transaction = Transaction(
        wallet_id=wallet.id,
        title=request.recipient.strip(),
        category="Transfer",
        amount_cents=request.amount_cents,
        direction="out",
        created_at=datetime.now(timezone.utc),
    )
    session.add(transaction)
    session.commit()
    session.refresh(transaction)
    return transaction_data(transaction)