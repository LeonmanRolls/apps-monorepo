# Check a name on Manager

A visitor types a label on the Manager landing page, sees whether that `.eth` name is available, and opens the registration quote for an available name.

## Sub-features

- `manager-landing-available` shows an available card for a fresh label and opens `/register/<name>`.
- `manager-header-available` repeats that check from the header field on an interior page.
- `manager-clear` empties the landing field with **Clear search** and removes the card.

## How to get to it (user POV)

- Open `http://127.0.0.1:3000`. The heading reads **Find your name**. The field placeholder is `.eth`.
- On an interior page, use the header field **Search for a name or address**.

## Driving it with verify-ens-apps

Preconditions:

- `doctor manager` reports the heading and the port this run owns.
- The generated label is not already registered. The helper treats a **Registered** card as a failure.
- No wallet is connected.

- **Landing result.** Type the label into the `.eth` field. The helper runs `node .cursor/skills/verify-ens-apps/scripts/verify.mjs drive manager-check-availability`. A link whose name contains `<label>.eth` and `available` appears. `evidence/manager-check-availability/result.png` shows that card.
- **Open the quote.** Activate that link. The URL is `/register/<label>.eth` and the level-1 heading is the full name. `register.png` and `register.aria.txt` show that page.
- **Header entry.** Open `/legal/terms-of-use`, type the same label into **Search for a name or address**, and follow the available result to the same `/register/<label>.eth` heading. The default drive does not cover this entry. Drive it for a header change.
- **Clear.** On the landing page, type the label, then activate **Clear search**. The `.eth` field is empty and the available link is gone.

## Gotchas

- The landing page sends a connected wallet to the dashboard, so the `.eth` field is absent. Use a fresh browser context.
- The landing field is a controlled input. Setting its DOM value does not update React, and React clears it. Type the label with keystrokes.
- Wait until the page is idle, then dismiss **No thanks** on the usage-data dialog before typing. The dialog mounts late. Typing before it mounts loses the label when the page settles.
- The field debounces for 500ms and then reads Sepolia. Wait for the link, not for a fixed sleep.
- `Couldn't check this name` means the RPC check failed. Keep the screenshot and fail the run.
- The available pill text is the lowercase word `available`.
- Typing a dotted name does not append `.eth`. The default drive types the bare label.
