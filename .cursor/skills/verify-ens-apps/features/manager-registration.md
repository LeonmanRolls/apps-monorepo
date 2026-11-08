# Register a name on Manager

A signed-in visitor searches for a name, chooses a two-year price, pays with USDC, and sees the registration complete banner. The per-PR smoke suite covers this on the local Anvil fork, not on public Sepolia.

## Sub-features

- `manager-register-smoke` registers a fresh name through the Rhinestone path and shows the completion banner.
- `portal-register-smoke` registers a name on Explorer through the portal smoke project.

## How to get to it (user POV)

- Start the e2e stack from `e2e/README.md`, then open Manager at `http://localhost:3000`.
- Connect the headless wallet the fixture injects.
- Search for the `E2E_DOMAIN` name, choose 2 years, pay with USDC, and confirm.

## Driving it with Playwright

Preconditions:

- `docker` is on `PATH`.
- `pnpm e2e:infra:up` has started Anvil, Alto, the paymaster, and mockestrator.
- The apps are the ones the Playwright config starts or the URLs in `MANAGER_APP_URL` and `PORTAL_APP_URL`.
- This path spends a name on the local fork. Do not point it at public Sepolia.

- **Manager smoke.** Run `pnpm e2e:smoke:manager`. The `registration-rhinestone.spec.ts` project reaches the registration-complete banner. Playwright's HTML report and traces are under `e2e/playwright-report/` and `e2e/test-results/`.
- **Explorer smoke.** Run `pnpm e2e:smoke:portal`. The portal `registration.spec.ts` project registers a name and reaches its completion assertion.
- **Stop the stack.** Run `pnpm e2e:infra:down`.

## Gotchas

- Missing Docker is an unmet precondition. Report the feature unreachable and do not substitute the public-Sepolia availability check.
- `e2e/docs/smoke-suite.md` lists the rest of the tagged flows. A smoke failure is a failure of the flow the test names, not a signal to edit the test.
- The suite uses one worker because the fixtures share wallet state. Do not run a second smoke project against the same stack.
- `e2e/test-results/` and `e2e/playwright-report/` are gitignored. Copy any proof you need into the verify evidence directory before deleting them.
