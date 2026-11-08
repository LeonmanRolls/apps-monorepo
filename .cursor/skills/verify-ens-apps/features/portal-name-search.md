# Search a name on Explorer

A visitor searches from the Explorer home page, sees that a fresh `.eth` name is available to register, and opens the registration form for that name.

## Sub-features

- `portal-hero-available` shows an **Available to register** suggestion from the hero combobox and opens `/register?name=<name>`.
- `portal-dialog-available` repeats the search from the search dialog.
- `portal-name-page` opens `/<name>` directly and shows the available-name message.

## How to get to it (user POV)

- Open `http://127.0.0.1:3001`. The heading reads **Explore the source of truth for Ethereum Name Service**. The combobox is **Search for a name, wallet, or contract**.
- Activate the **Search** button in the compact header, or press `Mod+K`, to open the dialog named **Search**.

## Driving it with verify-ens-apps

Preconditions:

- `doctor portal` reports the heading and the port this run owns.
- Use the same label Manager checked when both apps are in the run. The helper stores it in the run state.

- **Hero suggestion.** Type the label into **Search for a name, wallet, or contract**. The helper runs `node .cursor/skills/verify-ens-apps/scripts/verify.mjs drive portal-name-search`. An option whose name contains `<label>.eth` and `Available to register` appears. `evidence/portal-name-search/result.png` shows it.
- **Open registration.** Activate that option. The URL is `/register?name=<label>.eth` and the page shows that name. It does not show `Could not check availability` or `<label>.eth is already registered`. `register.png` and `register.aria.txt` show that page.
- **Name overview.** Open `/<label>.eth` in the address bar. The heading is the name and the page says `This name is available to register.` The default drive does not open this URL. Choosing the suggestion goes to registration, not here.
- **Dialog entry.** Activate **Search**, type the label into the dialog's **Search...** field, and activate the same **Available to register** option. The default drive does not cover the dialog. Drive it for a dialog change.

## Gotchas

- The hero control is a combobox, not the dialog textbox. The dialog's placeholder is `Search...`.
- Availability text appears after the owner lookup returns. Wait for the option name, not for a fixed sleep.
- A suggestion without `Available to register` is not this feature's pass. Save the screenshot and fail.
- `Mod+K` while the combobox is focused types into the field on some platforms. Use the **Search** button when the shortcut does not open the dialog.
