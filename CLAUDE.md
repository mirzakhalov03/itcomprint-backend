# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

The API for **Roadshow Badge Printing** — an internal kiosk tool for IT Community of Uzbekistan events. Express 5 + Mongoose 9 + Zod 4 on Node/TypeScript (CommonJS output (no "type": "module"), module: NodeNext). The frontend (`../frontend`) no longer parses spreadsheets — events are created by picking a tab from the fixed Main Sheet, and this backend syncs that tab's rows server-side (`sheetSync.services.ts`) plus persists events/attendees and tracks print status. See `../CLAUDE.md` for the whole-project picture.

## Commands

- `npm run dev` — `tsx watch src/server.ts` (port 4000). **Requires a running MongoDB** at `MONGODB_URI`.
- `npm run build` — `tsc` → `dist/`; `npm start` — `node dist/server.js`.
- `npm run verify` — the project's test harness (`scripts/verify.ts`). Spins up an in-memory MongoDB (`mongodb-memory-server`), boots the app via `createApp()` on port 4055, and asserts every endpoint + error path. **Run this after any backend change.** There are no unit tests and, per project preference, none should be added.
- `npm run smoke` — builds, then boots the **compiled** `dist/server.js` in `NODE_ENV=production` against a throwaway Mongo and checks security headers, DB-aware health, and graceful SIGTERM shutdown. Run before deploying — `verify` never exercises the real `server.ts` entrypoint.

Env (`.env`, Zod-validated at startup — see `.env.example`): `NODE_ENV`, `PORT`, `MONGODB_URI`, `CORS_ORIGIN` (comma-separated origin list), `GOOGLE_CLIENT_ID` (Google OAuth 2.0 Web client ID), `JWT_SECRET` (≥16 chars; signs session cookies), `GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_SERVICE_ACCOUNT_KEY` (service account that reads the Main Sheet), `MAIN_SHEET_ID` (the one fixed Main Sheet spreadsheet ID new events are created from), `COOKIE_DOMAIN` (optional; cross-subdomain sessions). Invalid/missing config logs the bad fields and exits before boot.

## API surface

All routes are mounted under `/api` (`app.ts`):

| Method | Path                     | Purpose                                                                                                                                                        |
| ------ | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/health`                | readiness — 200 `{ ok: true, db: 'up' }` only when Mongo is connected, else 503                                                                                |
| POST   | `/auth/google`           | verify Google ID token, upsert user, set session cookie                                                                                                        |
| GET    | `/auth/me`               | return current user (requires session)                                                                                                                         |
| PATCH  | `/auth/me`               | update `displayName`, set `onboardedAt` on first call (requires session)                                                                                       |
| POST   | `/auth/logout`           | clear session cookie (requires session)                                                                                                                        |
| POST   | `/events`                | create an event **with its attendees** in one shot (requires session; stamps author)                                                                           |
| GET    | `/events`                | list events, each with `attendeeCount` (requires session)                                                                                                      |
| GET    | `/events/sheet-tabs`     | list the Main Sheet's tabs with `available`/`linked`/`trashed` status (requires session)                                                                       |
| POST   | `/events/sheet`          | create an event from a Main Sheet tab; body `{ name, date, tabGid }` — 409 if the tab is reserved by a live or trashed event (requires session; stamps author) |
| GET    | `/events/trash`          | list trashed events, each with `purgeAt` (requires session)                                                                                                    |
| GET    | `/events/:id`            | one event (requires session)                                                                                                                                   |
| PATCH  | `/events/:id`            | update `name`/`date` and/or `templateId` (requires session)                                                                                                    |
| DELETE | `/events/:id`            | soft delete — move to trash (requires session)                                                                                                                 |
| POST   | `/events/:id/restore`    | restore a trashed event (requires session)                                                                                                                     |
| DELETE | `/events/:id/permanent`  | hard delete — also frees its Main Sheet tab for relinking (requires session)                                                                                   |
| GET    | `/events/:id/attendees`  | list attendees (requires session)                                                                                                                              |
| POST   | `/events/:id/sync-sheet` | re-sync a tab-linked event's roster from the Main Sheet, returns `lastSyncedAt` (requires session; not logged)                                                 |
| POST   | `/attendees/:id/print`   | mark printed — also the reprint endpoint (requires session)                                                                                                    |
| DELETE | `/attendees/:id/print`   | undo a print — resets `printStatus`/`printCount`/`lastPrintedAt` (requires session)                                                                            |
| GET    | `/templates`             | list badge templates (requires session)                                                                                                                        |
| GET    | `/templates/field-keys`  | distinct `extra` keys across all attendees, for the editor's field picker (requires session)                                                                   |
| POST   | `/templates`             | create a template (requires session)                                                                                                                           |
| GET    | `/templates/:id`         | one template (requires session)                                                                                                                                |
| PUT    | `/templates/:id`         | update a template (requires session)                                                                                                                           |
| DELETE | `/templates/:id`         | delete a template — 400 for the default (requires session)                                                                                                     |
| GET    | `/activity`              | page activity log 50 at a time by `_id` cursor, `?eventId&before` (requires session)                                                                           |
| POST   | `/activity/printer`      | log a WebUSB printer connect/disconnect from the browser (requires session)                                                                                    |

`/events`, `/attendees`, `/templates`, and `/activity` are guarded by `requireAuth` (`middlewares/requireAuth.middleware.ts`), which reads the `session` httpOnly cookie, verifies the JWT, and attaches `req.user`. Auth routes are public.

## Layering & conventions

Strict MVC: **`routes → controllers → services → models`**, plus `validators/` (Zod), `middlewares/`, `config/`, `utils/`. Controllers stay thin (parse req, call service, shape response); all DB/business logic lives in services.

- **Route shape**: attach `validate(schema, part)` middleware, then the handler directly — e.g. `router.post('/', validate(schema), controller.create)`. **No `asyncHandler` wrapper**: Express 5 forwards rejected promises from async handlers/middleware to the error middleware automatically, so it was removed as redundant. Don't reintroduce it.
- **`validate` + Express 5 gotcha** (`middlewares/validate.middleware.ts`): `req.query` is getter-only in Express 5, so the middleware writes parsed values back with `Object.defineProperty`, not assignment. Don't "simplify" it to `req.query = parsed` — it throws at runtime.
- **Fail-fast config** (`config/env.ts`): `process.env` is parsed through a Zod schema at import time. Missing/invalid config crashes on boot, not mid-request. Add new env vars here.
- **Errors** (`middlewares/error.middleware.ts`): maps `AppError` (see `utils/AppError.ts`) → its declared status, `ZodError` → 400 (with flattened details), Mongoose `CastError`/`ValidationError` → 400, any error carrying an HTTP `status`/`statusCode` (e.g. body-parser's malformed-JSON 400 / payload-too-large 413) → that status, and everything else → 500. The `error` field is a stable code derived from the status (`NotFound`, `Unauthorized`, …). **500 messages are hidden in production** (`isProd`) and only the full error is logged — don't echo `err.message` to clients. **For expected failures, throw `new AppError(status, message)` from services** (e.g. `throw new AppError(404, 'Event not found')`) rather than returning `null` and formatting a status in the controller — controllers stay thin and the not-found path lives with the lookup.
- **`notFound`** (`middlewares/notFound.middleware.ts`) runs after the router so unmatched routes return JSON 404, not Express's HTML page. Order in `app.ts` matters: router → `notFound` → `errorHandler`.
- **`createApp()`** is separated from `server.ts` (which connects DB + listens + registers shutdown) specifically so `verify.ts` can boot the app against a throwaway DB without the production lifecycle. `app.ts` wires `helmet`, `compression`, request logging (`morgan`, skipped when `NODE_ENV=test`), `trust proxy`, and a CORS allowlist from `corsOrigins`.
- **Graceful shutdown** lives in `server.ts`: SIGTERM/SIGINT stop accepting connections, close the HTTP server, then `disconnectDb()`, with a 10s force-exit fallback. Don't move DB connect/listen into `app.ts`.
- **IDs are validated as ObjectIds** at the edge via the shared `utils/objectId.ts` Zod helper, so a malformed `:id` is a 400 before it reaches Mongoose. The `CastError` handler is defense-in-depth for any path that skips it.

## Data model & domain rules

Two collections (`models/`):

- **Event**: `name`, `date`, `createdAt`, `sheetId`, `tabGid` (Main Sheet tab gid; `null` for legacy URL-linked events). `attendeeCount` is _not_ stored — `listEvents` derives it via an `$group` aggregation over attendees. A partial unique index `one_event_per_tab` on `{ sheetId, tabGid }` (excluding null `tabGid`) reserves a tab to one event while it's live or trashed — only a hard delete frees it for relinking.
- **Attendee**: `eventId`, `fullName`, `extra` (free-form `Record<string,string>` from spreadsheet columns), `printStatus`, `printCount`, `lastPrintedAt`.

Domain rules baked into the services:

- **Events are created with their attendees** (`createEventWithAttendees` → `insertMany`), or from a Main Sheet tab (`createEventFromSheet`). There is intentionally no per-attendee create/update/delete endpoint.
- **Print and reprint are one endpoint**: `markPrinted` does `$inc: { printCount: 1 }` + sets `printStatus: 'printed'` and `lastPrintedAt`. The frontend renders "Print" vs "Reprint" off `printStatus`.
- **Trash**: `purgeExpiredTrash()` runs hourly from `server.ts`; `GET /events/trash` hides expired items and returns `purgeAt`.
- **`POST /events/:id/sync-sheet` returns `lastSyncedAt`.**

## Deployment (Railway)

Deployed to **Railway** from this repo (`mirzakhalov03/itcomprint-backend` — separate from `frontend/`, no monorepo). Config is declarative in `railway.json` (Dockerfile builder + `/api/health` healthcheck + restart policy), with paths relative to this repo's root.

- **Build**: multi-stage `Dockerfile` (build → prod-deps-only runtime, non-root `node`). `mongodb-memory-server` is a devDep, so `npm ci --omit=dev` keeps it (and its mongod download) out of the runtime image.
- **Port**: Railway injects `PORT` at runtime; `env.PORT` reads it (the 4000 default and `EXPOSE` are dev-only). Don't hardcode a port.
- **Required env vars** (Railway → Variables): `NODE_ENV=production`, `MONGODB_URI`, `CORS_ORIGIN` = the deployed frontend origin(s), `GOOGLE_CLIENT_ID`, `JWT_SECRET`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_KEY`, `MAIN_SHEET_ID`. For Mongo, add a Railway MongoDB service and reference its connection string, e.g. `MONGODB_URI=${{MongoDB.MONGO_URL}}`.
- `trust proxy: 1` and SIGTERM graceful shutdown already match Railway's edge proxy and redeploy/stop signals. Node `>=22` pinned via `engines` + `.nvmrc`.
- Run `npm run smoke` locally before pushing — it boots the compiled server exactly as the container will.

## Git note

This is its own git repo (`mirzakhalov03/itcomprint-backend`), separate from `frontend/` — no monorepo, no root package manager. Secrets are safe to ignore: `.gitignore` excludes `.env`/`.env.*` (keeps `.env.example`), `node_modules`, `dist`, and logs.
