from datetime import datetime

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Wallet(Base):
    __tablename__ = "wallets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_name: Mapped[str] = mapped_column(String(100), default="Yasir Ali")
    balance_cents: Mapped[int] = mapped_column(Integer, default=2_458_075)
    currency: Mapped[str] = mapped_column(String(3), default="USD")


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(120))
    category: Mapped[str] = mapped_column(String(40))
    amount_cents: Mapped[int] = mapped_column(Integer)
    direction: Mapped[str] = mapped_column(String(10))
    status: Mapped[str] = mapped_column(String(20), default="Completed")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)