# Sort address names by expiry

A visitor opens an address names table and sorts it by Expiry. Dated names come soonest-first, then names with no expiry. The next click lists the latest date first and still leaves names with no expiry last.

## Sub-features

- `portal-expiry-soonest` is the first **Expiry** click. `soon.eth`, then `parent.eth` and `sub.parent.eth` on the shared parent date, then `later.eth`, then `dns.com`, then `sub.never.eth`.
- `portal-expiry-latest` is the second click. The dated names reverse. `dns.com` and `sub.never.eth` stay last.

## How to get to it (user POV)

- Open `http://127.0.0.1:3001/addr/0x1111111111111111111111111111111111111111/names`.
- The heading contains **Names (6)**. The table lists the six fixture names.

## Driving it with verify-ens-apps

Preconditions:

- `doctor portal` reports the heading and the port this run owns.
- The drive replaces responses from `https://sepolia.api.bigname.sh` for this page. The six names are not live Sepolia or mainnet records.

- **Soonest.** The helper runs `node .cursor/skills/verify-ens-apps/scripts/verify.mjs drive portal-address-expiry-sort`. It clicks **Expiry** once. `evidence/portal-address-expiry-sort/soonest.png` shows that order.
- **Latest.** The same run clicks **Expiry** again. `latest.png` shows the reversed dates with the two undated names still last. `proof.json` records both orders.

## Gotchas

- The list is mocked. A pass does not prove the production address `0x225f137127d9067788314bc7fcc1f36746a3c3B5`.
- `sub.parent.eth` has no expiry of its own. `parent.eth` is in the same list, and the row shows that parent's date.
- `sub.never.eth` is an ENSv1 subname whose parent lookup returns no date. `dns.com` is a DNS name with no expiry. Both render after every dated name.
- The loaded list is already soonest-first. The bug appears after the click, so the proof is the order after **Expiry**, not the order on arrival.
