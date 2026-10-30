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

## Run it

```bash
cd ../Speculatory-backend && bash script/up.sh     # chain :8545, API :8788, bots (this repo's sibling) running
node scripts/build-data.mjs                         # regenerate src/data.js from ../Speculatory-contracts/out + the manifest
python3 -m http.server 8792                         # open http://127.0.0.1:8792/#/mine
```

Identities are the console's demo Authors (the node signs for them); "Connect wallet" signs with a browser wallet instead.
The API address is the second box in the header (`?api=` / localStorage), same rule as the console.

## What each screen sends

| Screen | Calls (all the same as a human's button) |
|---|---|
| `#/mine` | reads only: `/v1/funds`, `/v1/review`, `/v1/bots/targets`, `…/stake`, `…/ledger` |
| `#/t/:id/edit` | `POST /v1/docs` (the words, write-once, new slug per version) → `ThesisSpecRegistry.publish` (the Author's own transaction; `publishFor` is the Admin's curated-listing variant and needs the Admin key, so the portal does not use it) → `ThesisReview.submit` → `ThesisSpecRegistry.supersede(oldHash, newHash)`. v1 keeps running untouched until the Admin approves v2 in the console. A draft autosaves in the browser. |
| `#/t/:id/stake` | `MockUSDC.approve`, `ConvictionStake.post / topUp / withdraw / tick` (+ the demo faucet) |
| `#/t/:id/reports` | `POST /v1/assets/<slug>` (image) and `POST /v1/actions/report` (markdown; images linked as `assets/x.png`) |
| `#/t/:id/ledger` | `GET /v1/funds/:a/ledger` — “未評価” when nothing has checked a rule yet |
| `#/bots` | `GET /v1/bots`, `POST /v1/bots/config` (out-of-range numbers are refused, not clamped) |

There is no approve / reject anywhere in this repo.

## Check it

`node scripts/ui_check.mjs` — headless Chromium against the live local stack: every screen of every fund renders with no
console error, the bot thresholds round-trip, a stake top-up lands, a report with an uploaded image is published and its image
is served, and the update flow puts v2 in the review queue while v1 stays Live. (`VIEM_VENDOR=<dir>` answers the import map
offline; `CHROME_PATH` picks the browser.)

## Layout

```
index.html            shell: wallet button, identity, per-thesis nav
src/core.js           a thin fork of the console's viem plumbing (author identities only)
src/data.js           GENERATED — same generator, same rule
src/main.js           hash router: #/mine, #/bots, #/t/<vault>/edit|stake|reports|ledger
src/views/*.js        mine · edit · stake · reports · ledger · bots (+ shared.js)
scripts/              build-data.mjs, ui_check.mjs (headless, same pattern)
```
