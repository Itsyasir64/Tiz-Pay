from contextlib import asynccontextmanager
from datetime import date, datetime, time, timedelta, timezone
import os

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import Base, SessionLocal, engine
from app.models import Transaction, Wallet


def initialize_database() -> None:
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as session:
        if session.scalar(select(Wallet.id).limit(1)) is not None:
            return

        session.add(Wallet())
        now = datetime.now(timezone.utc)
        examples = [
            ("Whole Foods Market", "Shopping", 8425, "out", 1),
            ("Salary deposit", "Income", 420000, "in", 2),
            ("Spotify Premium", "Subscriptions", 1099, "out", 3),
            ("Jordan Lee", "Transfer", 12500, "out", 5),
            ("Blue Bottle Coffee", "Food & drink", 675, "out", 6),
        ]
        session.add_all(
            [
                Transaction(
                    title=title,
                    category=category,
                    amount_cents=amount,
                    direction=direction,
                    created_at=now - timedelta(days=days_ago),
                )
                for title, category, amount, direction, days_ago in examples
            ]
        )
        session.commit()


@asynccontextmanager
async def lifespan(_: FastAPI):
    initialize_database()
    yield


app = FastAPI(title="Tiz Pay API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv(
        "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


def get_session():
    with SessionLocal() as session:
        yield session


class TransferRequest(BaseModel):
    recipient: str = Field(min_length=2, max_length=100)
    amount_cents: int = Field(gt=0, le=10_000_000)


def transaction_data(transaction: Transaction) -> dict:
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
def health():
    return {"status": "ok"}


@app.get("/api/overview")
def overview(session: Session = Depends(get_session)):
    wallet = session.scalar(select(Wallet).limit(1))
    if wallet is None:
        raise HTTPException(status_code=503, detail="Wallet is not initialized")
    transactions = session.scalars(
        select(Transaction).order_by(Transaction.created_at.desc()).limit(8)
    ).all()
    return {
        "owner_name": wallet.owner_name,
        "balance_cents": wallet.balance_cents,
        "currency": wallet.currency,
        "income_cents": 420000,
        "spending_cents": 184500,
        "transactions": [transaction_data(item) for item in transactions],
    }


@app.get("/api/transactions")
def transactions(
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    session: Session = Depends(get_session),
):
    if (start_date is None) != (end_date is None):
        raise HTTPException(
            status_code=422, detail="Provide both start_date and end_date"
        )
    if start_date is not None and end_date is not None and start_date > end_date:
        raise HTTPException(
            status_code=422, detail="start_date must be on or before end_date"
        )

    statement = select(Transaction).order_by(Transaction.created_at.desc())
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
    request: TransferRequest, session: Session = Depends(get_session)
):
    wallet = session.scalar(select(Wallet).limit(1).with_for_update())
    if wallet is None:
        raise HTTPException(status_code=503, detail="Wallet is not initialized")
    if request.amount_cents > wallet.balance_cents:
        raise HTTPException(status_code=400, detail="Insufficient wallet balance")

    wallet.balance_cents -= request.amount_cents
    transaction = Transaction(
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