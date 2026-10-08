# Tiz Pay

A full-stack wallet dashboard starter built with React, FastAPI, and PostgreSQL.

## Run with Docker

Requirements: Docker and Docker Compose.

```bash
docker compose up --build
```

Open the dashboard at http://localhost:5173 and the API docs at http://localhost:8000/docs.
The database is initialized with a demo wallet and sample activity on first startup.

## Run locally

Start PostgreSQL and set `DATABASE_URL` to a PostgreSQL SQLAlchemy URL, then run the API:

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

In another terminal:

```bash
cd frontend
npm install
npm run dev
```

The frontend reads `VITE_API_URL` (default `http://localhost:8000`).

## API

- `GET /api/overview` returns the wallet balance and recent activity.
- `GET /api/transactions` lists wallet transactions.
- `POST /api/transfers` sends money. Pass `recipient` and `amount_cents` in the JSON body.
- `GET /health` is a lightweight liveness check.

This is a local development demo, not a production payment system. It has no authentication, payment processor, or production-grade financial controls; do not use it for real funds or sensitive data.