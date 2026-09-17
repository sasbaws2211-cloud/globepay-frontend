# GlobePay Frontend

React 18 + TypeScript dashboard built with CRACO. Fully integrated with the FastAPI backend.

## Setup

```bash
cd frontend
npm install
cp .env.example .env.local   # already present with localhost:8000
npm start
```

Opens at http://localhost:3000.

## Scripts

- `npm start` – development server (CRACO)
- `npm run build` – production build
- `npm test` – run tests

## Features integrated

| Feature | Backend endpoints used |
|---------|------------------------|
| Auth | `POST /auth/register`, `POST /auth/login`, `GET /auth/me` |
| Dashboard | `GET /wallet/summary`, `GET /wallet/transfers`, `GET /vaults`, `GET /cards` |
| Transfers | `POST /wallet/transfers` (Idempotency-Key), `GET /wallet/transfers`, claim flows |
| Vaults | `POST /vaults`, `GET /vaults`, contribute, withdraw, cancel |
| Cards | `GET /cards`, `POST /cards`, fund, freeze, unfreeze |
| Cross-border | `GET /crossborder/transfers`, `POST /crossborder/transfers` |
| Split bills | `GET /splits`, `POST /splits` |

Bearer token is stored in `localStorage` under `globepay_token` and attached to every request.

CORS is already enabled on the backend for `http://localhost:3000`.
