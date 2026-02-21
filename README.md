# TFE - RISK-like MVP

## Stack
- Next.js (App Router)
- Socket.IO (lobby + game realtime)
- Prisma + PostgreSQL
- Auth session JWT (cookie)

## Prerequisites
- Node.js 20+
- PostgreSQL accessible from `DATABASE_URL`
- Env vars in `.env`:
  - `DATABASE_URL`
  - `SESSION_SECRET` (or `SECRET`)

## Database
1. Generate Prisma clients:
```bash
npx prisma generate
```
2. Apply migration (recommended in a clean dev DB):
```bash
npx prisma migrate dev --name risk_mvp
```
If your DB already exists and migrate reports drift, use a dedicated dev DB or baseline manually.

## Run
```bash
npm run dev
```
Server runs on `http://localhost:3000`.

## MVP flow
1. Open two browser sessions.
2. Join the same lobby URL: `/fr/lobby/<CODE>`.
3. Host clicks `Lancer la partie`.
4. Both clients are redirected to `/fr/game/<GAME_CODE>`.
5. Play with actions: reinforcement, attack, fortify, end turn.

## Realtime events
Client -> server:
- `join_lobby`
- `leave_lobby`
- `start_game`
- `join_game`
- `leave_game`
- `submit_action`

Server -> client:
- `lobby_state`
- `lobby_locked`
- `game_started`
- `joined_game`
- `game_state`
- `action_rejected`
- `game_finished`
