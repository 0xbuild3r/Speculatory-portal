/* Rebalance — the author dials the fund's target weights. This is the author's allocator move:
   the same setTargetWeights transaction the Author tab sends, run from the author's own home page.
   Nothing here trades: the dial lands on the vault, and the rebalancer executes it within the
   policy bands. Only the fund's author can do it — setTargetWeights reverts for anyone else. */
import { api, read, write, state, A, ADDR, h, section, run, toast, short } from '../core.js';
import { loadThesis, ownerNote, loadAssets, assetOptions } from './shared.js';

const ZERO = '0x0000000000000000000000000000000000000000';

export async function renderRebalance(root, vault) {
  const t = await loadThesis(vault);
  const note = ownerNote(t);
  if (note) root.appendChild(note);

  // what the chain says the fund may hold, and where it is actually sitting
  const s = t.spec;
  const assets = s.exposureAssets.map((a) => String(a));
  const hardMin = s.hardMinWeightBps.map(Number);
  const hardMax = s.hardMaxWeightBps.map(Number);
  const known = await api('/v1/assets').then((r) => r.assets ?? []).catch(() => []);
  const sym = (addr) => (known.find((k) => String(k.address).toLowerCase() === addr.toLowerCase()) || {}).symbol
    ?? (addr.toLowerCase() === String(s.exposureAssets[0]).toLowerCase() ? 'cash' : short(addr));
  const fundDoc = await api(`/v1/funds/${vault}`).catch(() => ({}));
  const held = {};
  for (const hh of (fundDoc.book?.holdings ?? [])) held[String(hh.asset).toLowerCase()] = Number(hh.weight);
  const heldCash = Number(fundDoc.book?.cashWeight ?? 0);

  // the current dial — targetAssets / targetWeightBps live on the vault
  const dialed = new Map();
  for (let i = 0; i < 32; i++) {
    try {
      const a = await read(vault, A.ThesisVault, 'targetAssets', [BigInt(i)]);
      dialed.set(String(a).toLowerCase(), Number(await read(vault, A.ThesisVault, 'targetWeightBps', [a])));
    } catch { break; }
  }

  const cashTarget = Number(await read(vault, A.ThesisVault, 'targetCashWeightBps').catch(() => 0));
  const rows = assets.map((addr, i) => ({
    addr, i, sym: sym(addr),
    lo: hardMin[i] / 100, hi: hardMax[i] / 100,
    held: held[addr.toLowerCase()] ?? (i === 0 ? heldCash : 0),
    target: dialed.get(addr.toLowerCase()) ?? (i === 0 ? cashTarget : 0),
  }));

  // Names the thesis never listed. The spec is a promise and does not move; a name joins the book through the
  // timeline (SwapJournal), which caps how heavy a new name may walk in and allows one swap a month. The weight
  // the journal recorded is that name's ceiling here, and the vault checks it on the same setTargetWeights.
  await loadAssets();
  const specSet = new Set(assets.map((a) => a.toLowerCase()));
  const journalWeight = async (addr) => Number(await read(ADDR.journal, A.SwapJournal, 'weight', [vault, addr]).catch(() => 0));
  const candidates = assetOptions().filter((o) => !specSet.has(o.addr.toLowerCase()) && o.addr.toLowerCase() !== String(ADDR.usdc).toLowerCase());
  for (const o of candidates) {
    const jw = await journalWeight(o.addr);
    if (jw > 0 || dialed.has(o.addr.toLowerCase())) {
      rows.push({ addr: o.addr, i: rows.length, sym: o.sym, lo: 0, hi: jw / 100, held: held[o.addr.toLowerCase()] ?? 0,
        target: dialed.get(o.addr.toLowerCase()) ?? 0, added: true });
    }
  }
  const addable = candidates.filter((o) => !rows.some((r) => r.addr.toLowerCase() === o.addr.toLowerCase() && r.added));
  const total = () => rows.reduce((x, r) => x + Number(r.input.value || 0), 0);
  const sumEl = h('b', { class: 'mono', id: 'rbTotal' }, '—');
  const cashEl = h('span', { class: 'mono', id: 'rbCash' });
  const msg = h('span', { id: 'rbMsg', class: 'hint' });

  const table = h('table', {},
    h('tr', {}, h('th', {}, 'asset'), h('th', {}, 'holds now'), h('th', {}, 'the band that binds'), h('th', {}, 'target weight %')));
  for (const r of rows) {
    r.input = h('input', { id: `rb-in-${r.i}`, type: 'number', step: '0.5', min: 0, max: 100, class: 'mono', value: String(r.target / 100) });
    r.input.addEventListener('input', refresh);
    table.appendChild(h('tr', {},
      h('td', {}, h('b', {}, r.sym)),
      h('td', { class: 'mono' }, `${r.held.toFixed(2)} %`),
      h('td', { class: 'mono', id: `rb-band-${r.i}` }, `${r.lo.toFixed(1)} % – ${r.hi.toFixed(1)} %${r.added ? ' (added later)' : ''}`),
      h('td', {}, r.input)));
  }

  function refresh() {
    const pct = total();
    sumEl.textContent = `${pct.toFixed(2)} %`;
    cashEl.textContent = `cash ${Math.max(0, 100 - pct).toFixed(2)} %`;
    const bad = rows.filter((r) => {
      const v = Number(r.input.value || 0) * 100;
      return r.sym !== 'cash' && v > 0 && (v < r.lo || v > r.hi);
    });
    msg.textContent = bad.length ? `outside the band: ${bad.map((r) => r.sym).join(', ')} — the vault would refuse this` : '';
    return bad.length === 0 && pct <= 100;
  }
  refresh();

  const apply = () => {
    const list = rows.filter((r) => Number(r.input.value || 0) > 0);
    if (!list.length) { toast('every weight is zero — send it to cash instead if that is the intent', true); return; }
    run('dial the book', async () => {
      await write(state.identity, vault, A.ThesisVault, 'setTargetWeights',
        [list.map((r) => r.addr), list.map((r) => Math.round(Number(r.input.value) * 100))]);
      await reload();
    });
  };
  const allCash = () => {
    run('send it to cash', async () => {
      await write(state.identity, vault, A.ThesisVault, 'setTargetWeights', [[], []]);
      toast('zero targets — the whole book goes to cash on the next pass');
      await reload();
    });
  };
  async function reload() {
    root.innerHTML = '';
    await renderRebalance(root, vault);
  }

  root.appendChild(section('Rebalance (you are the allocator here — the policy bands bind)',
    h('p', { class: 'hint' }, 'Nothing trades here. You set where the book should sit; the rebalancer executes it through the venue on its next pass, inside the bands your approved thesis drew. Targets above zero are dialled on-chain as your transaction.'),
    table,
    h('div', { class: 'row' }, h('span', {}, 'total'), sumEl, cashEl, msg),
    h('div', { class: 'row' },
      h('button', { class: 'primary', id: 'rbSet', onclick: (e) => { e.preventDefault(); if (refresh()) apply(); else toast('fix the weights first', 'err'); } }, 'set weights'),
      h('button', { id: 'rbCash', onclick: (e) => { e.preventDefault(); allCash(); } }, 'send it to cash'),
      h('span', { class: 'dim' }, fundDoc.window?.state === 'idle' ? 'the fund is not open for money yet — dialling still works; the batch mechanics do the rest.' : ''))));

  // ---- add a name the thesis never listed (e.g. TSM to a book that began as NVDA alone) ----
  const pick = h('select', { id: 'addName' }, ...addable.map((o) => h('option', { value: o.addr }, o.sym)));
  const addWeight = h('input', { id: 'addWeight', type: 'number', step: '0.5', min: 0.5, max: 100, value: '10', class: 'mono', style: 'width:90px' });
  const addMsg = h('span', { id: 'addMsg', class: 'hint' });
  const addName = () => {
    const pct = Number(addWeight.value);
    if (!pick.value) { toast('every name on this chain is already in the book'); return; }
    if (!(pct > 0 && pct <= 100)) { toast('a weight between 0 and 100 %', true); return; }
    run('add the name to the book', async () => {
      // the timeline first (it checks you are the allocator, the cap on a new name, and the monthly cadence) ...
      await write(state.identity, ADDR.journal, A.SwapJournal, 'swapLeg', [vault, ZERO, pick.value, Math.round(pct * 100)]);
      // ... then the dial itself, with the name beside what the book already holds
      const keep = rows.filter((r) => Number(r.input.value || 0) > 0);
      await write(state.identity, vault, A.ThesisVault, 'setTargetWeights',
        [[...keep.map((r) => r.addr), pick.value], [...keep.map((r) => Math.round(Number(r.input.value) * 100)), Math.round(pct * 100)]]);
      await reload();
    });
  };
  root.appendChild(section('Add a name (the thesis keeps its claim and its falsifier)',
    h('p', { class: 'hint' }, 'A name the thesis never listed can join the book through the timeline: the weight you give it here is recorded there, becomes its ceiling, and counts as this month’s one swap. Existing names keep the bands the thesis published. Make room first — the other weights plus this one must leave the policy’s minimum cash.'),
    h('div', { class: 'row' }, pick, h('span', {}, 'weight %'), addWeight,
      h('button', { class: 'primary', id: 'addNameBtn', onclick: (e) => { e.preventDefault(); addName(); } }, 'add to the book'), addMsg)));

  const heldLine = h('p', { class: 'hint' }, 'held today: ' + rows.map((r) => `${r.sym} ${r.held.toFixed(1)}%`).join(' · ') + ' — the gap between held and dialled is what the bot trades.');
  root.appendChild(heldLine);
}
