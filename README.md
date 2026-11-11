# Tiz Pay

A full-stack wallet dashboard starter built with React, FastAPI, and PostgreSQL.

## Run with Docker

Requirements: Docker and Docker Compose.

From the repository root, generate a signing key once and save it in the
git-ignored `.env` file. Keep this value private and reuse it when restarting
the same environment:

```powershell
$env:JWT_SECRET_KEY = (python -c "import secrets; print(secrets.token_urlsafe(32))")
"JWT_SECRET_KEY=$env:JWT_SECRET_KEY" | Set-Content -Encoding ascii .env
```

```powershell
docker compose up --build
```

Open the dashboard at http://localhost:5173 and the API docs at http://localhost:8000/docs.
Create an account to get a private wallet. Password-reset emails require the
`SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, and `SMTP_FROM`
environment variables; `SMTP_USE_SSL=true` enables implicit TLS.

## Run locally

SQLite is used by default; add `DATABASE_URL` to the root `.env` file if you
want to use PostgreSQL instead.

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn --env-file ..\.env app.main:app --reload
```

In another terminal:

```powershell
cd frontend
npm install
npm run dev
```

The frontend reads `VITE_API_URL` (default `http://localhost:8000`).

## API

- `POST /api/auth/signup` creates an account and private, empty wallet.
- `POST /api/auth/login` returns a bearer access token.
- `GET /api/auth/me` returns the signed-in account.
- `POST /api/auth/password-reset` requests a one-time email link.
- `POST /api/auth/password-reset/confirm` consumes the link and changes the password.
- `GET /api/overview`, `GET /api/transactions`, and `POST /api/transfers`
  require `Authorization: Bearer <access_token>` and operate only on that
  account's wallet.
- `GET /health` is a lightweight liveness check.

This is a local development demo, not a production payment system. Although
accounts and API authentication are implemented, the app has no payment
processor, HTTPS deployment guidance, or production-grade financial controls.
Do not use it for real funds or sensitive data.