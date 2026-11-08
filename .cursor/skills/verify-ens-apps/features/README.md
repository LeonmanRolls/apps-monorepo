# ENS apps verification map

This directory is the source for the user-facing checks of Manager, Explorer, and the API worker. Read this index, then the feature file for the path you are proving.

## Baseline preconditions

- Export `VERIFY_RUN_ID` and run the helper from the repository root. The skill's Launch section has the commands.
- Manager and Explorer are Sepolia dev servers this run started. The default URLs are `http://127.0.0.1:3000` and `http://127.0.0.1:3001`.
- The API worker is `http://127.0.0.1:2999` when that feature is in scope.
- No wallet is connected. A connected wallet makes Manager leave the landing page for the dashboard.
- The helper picks one unregistered label, `pstack` plus 8 hex characters, and both web apps use it.
- `node .cursor/skills/verify-ens-apps/scripts/verify.mjs doctor <app>` has passed since that server last failed.
- Do not drive a server this run did not start.

## Driving conventions

- Start from the baseline unless the feature names another precondition.
- Prefer the accessible name in the feature file over a CSS selector.
- Treat the helper commands as literal.
- Browser drives go through `verify.mjs drive`. The registration flow goes through the Playwright project in its feature file.
- Keep the evidence directory. Cleanup stops servers and removes scaffolding only.

## Proof and skip reporting

- Record the feature id, the entry point, and the run id with the artifacts.
- A screenshot of a result card is not enough. Also open the page the card links to, and keep that screenshot and the ARIA snapshot.
- The API proof is the `/health` body, saved to a file.
- If Docker, a wallet, or Postgres is missing, report that feature as unreachable and quote the command that failed the precondition. Do not mark it verified through search or a unit test.

## Feature entry contract

Each feature file has an H1, one paragraph, and four H2 sections in order. `Sub-features`, `How to get to it (user POV)`, `Driving it with <harness>`, `Gotchas`.

## Features

- [Check a name on Manager](./manager-check-availability.md) covers the landing field, the header field, and the registration quote for an available name.
- [Search a name on Explorer](./portal-name-search.md) covers the hero combobox, the search dialog, and the available-name page.
- [Sort address names by expiry](./portal-address-expiry-sort.md) covers the address names table Expiry control with a mocked name list.
- [API worker health](./api-worker-health.md) covers `GET /health` on the local worker.
- [Register a name on Manager](./manager-registration.md) covers the smoke-suite registration. It needs the e2e Docker stack.
