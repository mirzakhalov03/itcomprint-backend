# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

The API for **Roadshow Badge Printing** — an internal kiosk tool for IT Community of Uzbekistan events. Express 5 + Mongoose 9 + Zod 4 on Node/TypeScript (ESM, `module: NodeNext`). The frontend (`../frontend`) does spreadsheet parsing and printing client-side; this backend only persists events/attendees and tracks print status. See `../CLAUDE.md` for the whole-project picture.

## Commands

- `npm run dev` — `tsx watch src/server.ts` (port 4000). **Requires a running MongoDB** at `MONGODB_URI`.
- `npm run build` — `tsc` → `dist/`; `npm start` — `node dist/server.js`.
- `npm run verify` — the project's test harness (`scripts/verify.ts`). Spins up an in-memory MongoDB (`mongodb-memory-server`), boots the app via `createApp()` on port 4055, and asserts every endpoint + error path. **Run this after any backend change.** There are no unit tests and, per project preference, none should be added.
- `npm run smoke` — builds, then boots the **compiled** `dist/server.js` in `NODE_ENV=production` against a throwaway Mongo and checks security headers, DB-aware health, and graceful SIGTERM shutdown. Run before deploying — `verify` never exercises the real `server.ts` entrypoint.

Env (`.env`, Zod-validated at startup — see `.env.example`): `NODE_ENV`, `PORT`, `MONGODB_URI`, `CORS_ORIGIN` (comma-separated origin list), `GOOGLE_CLIENT_ID` (Google OAuth 2.0 Web client ID), `JWT_SECRET` (≥16 chars; signs session cookies), `COOKIE_DOMAIN` (optional; cross-subdomain sessions). Invalid/missing config logs the bad fields and exits before boot.

## API surface

All routes are mounted under `/api` (`app.ts`):

| Method | Path | Purpose |
|--------|------|---------|
| GET  | `/health` | readiness — 200 `{ ok: true, db: 'up' }` only when Mongo is connected, else 503 |
| POST | `/auth/google` | verify Google ID token, upsert user, set session cookie |
| GET  | `/auth/me` | return current user (requires session) |
| PATCH | `/auth/me` | update `displayName`, set `onboardedAt` on first call (requires session) |
| POST | `/auth/logout` | clear session cookie (requires session) |
| POST | `/events` | create an event **with its attendees** in one shot (requires session; stamps author) |
| GET  | `/events` | list events, each with `attendeeCount` (requires session) |
| GET  | `/events/:id` | one event (requires session) |
| GET  | `/events/:id/attendees` | list attendees; `?search=` & `?status=printed\|not_printed` (requires session) |
| POST | `/attendees/:id/print` | mark printed — also the reprint endpoint (requires session) |

`/events` and `/attendees` are guarded by `requireAuth` (`middlewares/requireAuth.middleware.ts`), which reads the `session` httpOnly cookie, verifies the JWT, and attaches `req.user`. Auth routes are public.

## Layering & conventions

Strict MVC: **`routes → controllers → services → models`**, plus `validators/` (Zod), `middlewares/`, `config/`, `utils/`. Controllers stay thin (parse req, call service, shape response); all DB/business logic lives in services.

- **Route shape**: attach `validate(schema, part)` middleware, then wrap the handler in `asyncHandler` so async throws reach the error middleware. Follow this exactly when adding routes.
- **`validate` + Express 5 gotcha** (`middlewares/validate.middleware.ts`): `req.query` is getter-only in Express 5, so the middleware writes parsed values back with `Object.defineProperty`, not assignment. Don't "simplify" it to `req.query = parsed` — it throws at runtime.
- **Fail-fast config** (`config/env.ts`): `process.env` is parsed through a Zod schema at import time. Missing/invalid config crashes on boot, not mid-request. Add new env vars here.
- **Errors** (`middlewares/error.middleware.ts`): maps `ZodError` → 400 (with flattened details), Mongoose `CastError`/`ValidationError` → 400, any error carrying an HTTP `status`/`statusCode` (e.g. body-parser's malformed-JSON 400 / payload-too-large 413) → that status, and everything else → 500. **500 messages are hidden in production** (`isProd`) and only the full error is logged — don't echo `err.message` to clients. Throw real errors from services and let this middleware format them.
- **`notFound`** (`middlewares/notFound.middleware.ts`) runs after the router so unmatched routes return JSON 404, not Express's HTML page. Order in `app.ts` matters: router → `notFound` → `errorHandler`.
- **`createApp()`** is separated from `server.ts` (which connects DB + listens + registers shutdown) specifically so `verify.ts` can boot the app against a throwaway DB without the production lifecycle. `app.ts` wires `helmet`, `compression`, request logging (`morgan`, skipped when `NODE_ENV=test`), `trust proxy`, and a CORS allowlist from `corsOrigins`.
- **Graceful shutdown** lives in `server.ts`: SIGTERM/SIGINT stop accepting connections, close the HTTP server, then `disconnectDb()`, with a 10s force-exit fallback. Don't move DB connect/listen into `app.ts`.
- **IDs are validated as ObjectIds** at the edge via the shared `utils/objectId.ts` Zod helper, so a malformed `:id` is a 400 before it reaches Mongoose. The `CastError` handler is defense-in-depth for any path that skips it.

## Data model & domain rules

Two collections (`models/`):

- **Event**: `name`, `date`, `createdAt`. `attendeeCount` is *not* stored — `listEvents` derives it via an `$group` aggregation over attendees.
- **Attendee**: `eventId`, `fullName`, `extra` (free-form `Record<string,string>` from spreadsheet columns), `searchText`, `printStatus`, `printCount`, `lastPrintedAt`.

Domain rules baked into the services:

- **Events are created with their attendees** (`createEventWithAttendees` → `insertMany`). There is intentionally no per-attendee create/update/delete endpoint.
- **`searchText` is denormalized at write time**: `fullName + all extra values`, lowercased (`buildSearchText`). Live search regex-matches this single field (compound index `{ eventId: 1, searchText: 1 }`), so a query hits company/role/etc., not just the name. Search input is regex-escaped and lowercased before matching. **If you change what's searchable, update `buildSearchText` — existing docs won't re-index themselves.**
- **Print and reprint are one endpoint**: `markPrinted` does `$inc: { printCount: 1 }` + sets `printStatus: 'printed'` and `lastPrintedAt`. The frontend renders "Print" vs "Reprint" off `printStatus`.

## Deployment (Railway)

Deployed to **Railway** from this monorepo. Config is declarative in `railway.json` (Dockerfile builder + `/api/health` healthcheck + restart policy).

- **Service Root Directory must be `backend`** (Railway dashboard → service Settings). The repo root has both `frontend/` and `backend/`; paths in `railway.json` (`Dockerfile`, `/api/health`) are relative to that root dir.
- **Build**: multi-stage `Dockerfile` (build → prod-deps-only runtime, non-root `node`). `mongodb-memory-server` is a devDep, so `npm ci --omit=dev` keeps it (and its mongod download) out of the runtime image.
- **Port**: Railway injects `PORT` at runtime; `env.PORT` reads it (the 4000 default and `EXPOSE` are dev-only). Don't hardcode a port.
- **Required env vars** (Railway → Variables): `NODE_ENV=production`, `MONGODB_URI`, `CORS_ORIGIN` = the deployed frontend origin(s). For Mongo, add a Railway MongoDB service and reference its connection string, e.g. `MONGODB_URI=${{MongoDB.MONGO_URL}}`.
- `trust proxy: 1` and SIGTERM graceful shutdown already match Railway's edge proxy and redeploy/stop signals. Node `>=22` pinned via `engines` + `.nvmrc`.
- Run `npm run smoke` locally before pushing — it boots the compiled server exactly as the container will.

## Git note

`backend/` is currently untracked in the repo. Secrets are safe to ignore: `.gitignore` excludes `.env`/`.env.*` (keeps `.env.example`), `node_modules`, `dist`, and logs.
