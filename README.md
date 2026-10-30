# Speculatory — author portal

The **author's** side of the demo — not the operator console. One login (a wallet,
or a demo cheat identity), and everything an author does is one screen away,
organized *per thesis*, not per role.

## Screens (v1)

| Route | Shows / does |
|---|---|
| `/#/mine` | my theses: draft / in review / **Live** / closed / falsified — NAV, burn, what fired lately |
| `/#/t/:id/edit` | **the update flow**: change weights / signals / falsifier wording → a new `ThesisSpec` → `publishFor` + `supersede(oldHash)` → sits in the review queue as *v2 of this thesis*; nothing silently changes while it waits |
| `/#/t/:id/stake` | conviction stake: post / top up / withdraw |
| `/#/t/:id/reports` | write a report — markdown **with images** (the asset pipeline from live issue #1), publish to the fund's Reports |
| `/#/t/:id/ledger` | my rule ledger: each registered rule, its last evaluation, and the executions it caused (live issue #4) |

## Stance

- The portal **updates**, the console **governs**. Approve/reject, params,
  timelocks stay Admin-side.
- Same stack and plumbing as the console: static files + viem, identities
  (wallet / impersonation), `src/data.js` GENERATED from
  `../Speculatory-contracts/out` + the deploy manifest — rerun the same
  `build-data.mjs` after any redeploy.
- Every action here is the same transaction the Author tab performs today; the
  portal is a better surface, not a new trust path.

## Layout

```
index.html            shell: wallet button, identity, per-thesis nav
src/core.js           reuse — or a thin fork — of the console's viem plumbing
src/data.js           GENERATED — same generator, same rule
src/views/*.js        the five screens above
scripts/              build-data.mjs, ui_check.mjs (headless, same pattern)
```
