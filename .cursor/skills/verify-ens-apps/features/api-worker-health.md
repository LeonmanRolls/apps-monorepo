# API worker health

The Manager backend answers `GET /health` with its chain. A person does not open this URL. Manager's `/api` proxy targets it in local development.

## Sub-features

- `api-health` returns HTTP 200 and `{"status":"ok","chain":"sepolia"}` from the dev server.

## How to get to it (user POV)

- The dev server is `http://127.0.0.1:2999`. Request `/health`.
- There is no browser page for this check.

## Driving it with verify-ens-apps

Preconditions:

- `doctor api-worker` reports a live pid, port `2999`, and the Sepolia health body.
- Database routes are out of this feature. Postgres is not required for `/health`.

- **Health.** Run `node .cursor/skills/verify-ens-apps/scripts/verify.mjs drive api-worker-health`. The saved file `evidence/api-worker-health/health.json` is `{"status":"ok","chain":"sepolia"}`.
- **Unit check.** Run `node .cursor/skills/verify-ens-apps/scripts/verify.mjs test`. `workers/api-worker/src/app/health.test.ts` passes. That test calls the Hono app in process. It does not replace the HTTP check above.

## Gotchas

- The Vite config defaults to port `2999`. The helper passes `--port`, so `VERIFY_API_PORT` moves this run only.
- A health JSON of `ok` does not mean Postgres, queues, or notification routes are up.
- Launch creates `workers/api-worker/.dev.vars` only when the file is missing, and only with the scaffolding header. Cleanup removes that file. A developer's existing `.dev.vars` stays.
- If launch cannot bind the port, report the listener and stop. Do not curl a server this run did not start.
- With only the scaffolding `.dev.vars` present, Vitest warns that production secrets are missing. `health.test.ts` still exits 0. A non-zero exit is the failure.
