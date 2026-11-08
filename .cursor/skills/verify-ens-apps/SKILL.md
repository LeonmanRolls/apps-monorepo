---
name: verify-ens-apps
description: "Drive ENS Manager, Explorer (the portal package), and the API worker on Sepolia, build them, and run the existing checks for search and health. Use after a change to apps/manager, apps/portal, or workers/api-worker, or when principle-prove-it-works needs a running app."
---

# Verify ENS apps

Manager, Explorer, and the API worker are the three deployables in this repo. This skill builds them, starts the local servers from the root README, and drives one user path on each. The helper is `node .cursor/skills/verify-ens-apps/scripts/verify.mjs`. Run it from the repository root.

Set a run id before the first command. Later commands in the same run read it.

```bash
export VERIFY_RUN_ID="verify-$(date +%s)"
```

Evidence for that id stays at `/tmp/verify-ens-apps/$VERIFY_RUN_ID/evidence` after cleanup. Two runs need two ids and two sets of ports. `VERIFY_MANAGER_PORT`, `VERIFY_PORTAL_PORT`, and `VERIFY_API_PORT` override the defaults `3000`, `3001`, and `2999`. Those defaults match `apps/manager/vite.config.ts`, `apps/portal/vite.config.ts`, and `workers/api-worker/vite.config.ts`. If a port already has a listener, the helper refuses to start.

The apps use the committed Sepolia settings in `apps/manager/.env` and `apps/portal/.env`. Search reads the public Sepolia RPC fallbacks in `packages/config/src/networks.ts`. Do not point this skill at mainnet. Do not register a name or submit a payment from this helper. Wallet, registration, and migration flows belong to the Playwright smoke suite, and that suite needs the Docker stack in `e2e/README.md`.

## Launch

Install dependencies when `node_modules` is missing.

```bash
pnpm install --ignore-scripts
./e2e/node_modules/.bin/playwright install --with-deps chromium
```

`pnpm install` without `--ignore-scripts` runs `lefthook install` and fails when git `core.hooksPath` is already set. Leave that git setting in place. `pnpm exec playwright` from `e2e/` runs that same prepare script, so call the Playwright binary above instead.

Build each deployable before trusting a drive. A green build does not prove the screen. The dev server started below is a different process from the build output.

```bash
node .cursor/skills/verify-ens-apps/scripts/verify.mjs build
```

That runs `pnpm --filter portal build`, `pnpm --filter manager build`, and `pnpm --filter api-worker build`, in that order. Logs land in the evidence directory as `build-<name>.log`. The manager build script already sets `NODE_OPTIONS=--max-old-space-size=8192`.

Start each app with Vite bound to `127.0.0.1`. The helper runs `pnpm --filter <app> exec vite dev --host 127.0.0.1 --port <port> --strictPort`. `pnpm dev` appends a bare `--` before those flags, and Vite then ignores them and listens on `::1` only, so `http://127.0.0.1` never connects. Launch blocks until the process answers HTTP 200, or for five minutes. The API worker's `pnpm dev` also starts a `tsc` watch. This helper starts Vite alone. `/health` does not need the watcher.

```bash
node .cursor/skills/verify-ens-apps/scripts/verify.mjs launch manager
node .cursor/skills/verify-ens-apps/scripts/verify.mjs launch portal
node .cursor/skills/verify-ens-apps/scripts/verify.mjs launch api-worker
```

Manager is ready when `http://127.0.0.1:$VERIFY_MANAGER_PORT` returns 200 and the heading **Find your** is on the page. Explorer is ready when `http://127.0.0.1:$VERIFY_PORTAL_PORT` returns 200 and the heading **Explore the source of truth** is on the page. The API worker is ready when `http://127.0.0.1:2999/health` returns `{"status":"ok","chain":"sepolia"}`.

The API worker has no `.dev.vars` in a fresh checkout. Launch writes `workers/api-worker/.dev.vars` only when that file is absent, marked `# verify-ens-apps scaffolding`, with a local Postgres URL and the public Sepolia RPC. `/health` does not open Postgres. Routes that read the database need `docker compose` in `workers/api-worker` and a migration, as the root README describes. Cleanup deletes the scaffolding file and leaves a file it did not create.

## Doctor

Run doctor before the first drive, and again after a drive fails.

```bash
node .cursor/skills/verify-ens-apps/scripts/verify.mjs doctor manager
node .cursor/skills/verify-ens-apps/scripts/verify.mjs doctor portal
node .cursor/skills/verify-ens-apps/scripts/verify.mjs doctor api-worker
```

Doctor checks four facts and writes `evidence/doctor-<app>.json`.

- The recorded pid is alive.
- `lsof` shows that port owned by that pid's process group.
- The ready request returns HTTP 200.
- Manager or Explorer shows its heading in Chromium. The API worker JSON has `status` `ok` and `chain` `sepolia`.

The report includes `git rev-parse HEAD` from launch. These read-only paths need no wallet. If doctor fails, stop. Do not drive a server this run did not start.

## Drive

`drive` runs doctor for the app, then the feature. One label of the form `pstack` plus 8 hex characters is stored in the run state and reused, so Manager and Explorer check the same unregistered name.

```bash
node .cursor/skills/verify-ens-apps/scripts/verify.mjs drive manager-check-availability
node .cursor/skills/verify-ens-apps/scripts/verify.mjs drive portal-name-search
node .cursor/skills/verify-ens-apps/scripts/verify.mjs drive api-worker-health
```

Read the matching file in `features/` before driving. The map lists entry points the default command does not cover. A proof that only hits the landing field is incomplete for a change to the header search.

Run the existing tests that cover the same behavior. This is the default set, not an app's full suite. For a change, also run the tests of the modules you touched, per the root `AGENTS.md`.

```bash
node .cursor/skills/verify-ens-apps/scripts/verify.mjs test
```

| App | File |
| --- | --- |
| Manager | `apps/manager/src/features/landing/check-availability/useCheckAvailability.test.ts` |
| Explorer | `apps/portal/src/features/dashboard/components/SearchModalContent.test.tsx` |
| API worker | `workers/api-worker/src/app/health.test.ts` |

Registration, renewal, migration, and records are exercised by the Playwright smoke suite when Docker is available.

```bash
pnpm e2e:infra:up
pnpm e2e:smoke:manager
pnpm e2e:smoke:portal
pnpm e2e:infra:down
```

If `docker` is missing, say so and do not report those flows as verified. The feature file `features/manager-registration.md` has the precondition.

## Evidence

The helper writes under `/tmp/verify-ens-apps/$VERIFY_RUN_ID/evidence`.

- `build-*.log` and `tests/*.log` hold the command output and the exit is printed by the helper.
- `doctor-*.json` holds pid, port, HTTP status, heading or health body, and the git commit.
- `manager-check-availability/result.png` is the available card. `register.png` and `register.aria.txt` are the registration quote after the click.
- `portal-name-search/result.png` is the suggestion. `register.png` and `register.aria.txt` are the registration form after the click. Choosing an available suggestion opens `/register?name=<name>`, not the name overview.
- `api-worker-health/health.json` is the response body.

Capture the action and the next page, not only the last screen. A card that says `Couldn't check this name` is a failed check. A `Registered` card for the generated label is a failed check, not a pass. Do not stub the RPC. The public Sepolia endpoints are the same ones the apps use outside this skill.

## Cleanup

Stop only the pids recorded in `/tmp/verify-ens-apps/$VERIFY_RUN_ID/state.json`.

```bash
node .cursor/skills/verify-ens-apps/scripts/verify.mjs cleanup
node .cursor/skills/verify-ens-apps/scripts/verify.mjs evidence
```

Cleanup sends `SIGTERM` to each process group, then `SIGKILL` if the group is still alive. It deletes the scaffolding `.dev.vars` when launch created it. It leaves the evidence directory. `evidence` exits 0 when that directory is still there. Run cleanup after a failed launch too, so the next attempt does not inherit the port.

## Helpers

The helper is executable.

```bash
node .cursor/skills/verify-ens-apps/scripts/verify.mjs
```

With no command it prints the command list and exits 1. Feature recipes are in `features/README.md`.
