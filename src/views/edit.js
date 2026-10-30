/**
 * Update a thesis: change the weights, the signals or the wording, and send it as v2.
 *
 * Nothing silently changes. The new ThesisSpec is published by the author, submitted to the review queue,
 * and the old spec is pointed at it with supersede(oldHash) — which moves no money and only affects new
 * entries. The fund that is Live keeps running exactly as it is until the Admin approves v2 in the console.
 * These are the transactions the console’s Author tab sends: publish, ThesisReview.submit, supersede.
 */
import { api, read, write, state, A, ADDR, h, section, field, run, toast, keccak, short } from '../core.js';
import { loadThesis, ownerNote, symOf, chip, ZERO32 } from './shared.js';

const FEEDS = ['NVDA', 'TSM', 'ETH', 'SPX'];
const lines = (s) => String(s ?? '').trim();

function checkEditor(initial) {
  const on = h('input', { type: 'checkbox' });
  const feed = h('select', {}, ...FEEDS.map((f) => h('option', { value: f }, f)));
  const op = h('select', {}, h('option', { value: 'lt' }, 'falls below'), h('option', { value: 'gt' }, 'rises above'));
  const pct = h('input', { type: 'number', step: '1', value: '-15', style: 'width:70px' });
  if (initial) { on.checked = true; feed.value = initial.feed; op.value = initial.op; pct.value = String(initial.movePct); }
  const box = h('span', { class: 'row', style: 'gap:6px' }, h('label', { class: 'dim' }, on, ' machine check'), feed, op, pct, h('span', { class: 'dim' }, '% since the watch began'));
  const sync = () => { for (const x of [feed, op, pct]) x.disabled = !on.checked; };
  on.addEventListener('change', sync); sync();
  return { node: box, value: () => (on.checked ? { feed: feed.value, op: op.value, movePct: Number(pct.value) } : undefined), onChange: (f) => [on, feed, op, pct].forEach((x) => x.addEventListener('input', f)) };
}

export async function renderEdit(root, vault) {
  const t = await loadThesis(vault);
  const draftKey = 'portal-draft:' + vault;
  let draft = null;
  try { draft = JSON.parse(localStorage.getItem(draftKey) || 'null'); } catch { /* none */ }
  const d = t.doc ?? {};

  const note = ownerNote(t);
  if (note) root.appendChild(note);

  const next = t.doc.supersededBy;
  root.appendChild(section(`Update — ${t.fund.name}`,
    h('div', { class: 'row' }, chip('v1 · Live', 'ok'), h('span', { class: 'dim mono' }, 'spec ' + short(t.specHash)),
      next ? chip('a newer version is already submitted', 'warn') : null),
    h('p', { class: 'hint' }, 'Edit below. “Send v2 for review” publishes a new ThesisSpec, puts it in the review queue and points this spec at it. This fund keeps running unchanged until the Admin approves v2.')));

  // ---- the words ----
  const claim = h('textarea', { rows: '3', style: 'width:100%' }); claim.value = draft?.claim ?? d.claim ?? '';
  const falsifier = h('textarea', { rows: '2', style: 'width:100%' }); falsifier.value = draft?.falsifier ?? d.falsifier ?? '';
  const exit = h('input', { value: draft?.exit ?? d.exitRule ?? '', size: 60 });
  const summary = h('textarea', { rows: '3', style: 'width:100%' }); summary.value = draft?.summary ?? d.summary ?? d.thesis ?? '';
  const falsCheck = checkEditor(draft?.falsCheck ?? d.watch?.falsifier);

  // ---- signals ----
  const sigBox = h('div', {});
  const sigRows = [];
  const addSignal = (s = { text: '', check: undefined }) => {
    const text = h('input', { value: s.text ?? '', size: 70, placeholder: 'when this is true, the Author’s rule fires' });
    const ck = checkEditor(s.check);
    const row = h('div', { class: 'signal-row', style: 'margin:6px 0' }, text, ck.node, h('button', { class: 'sm', onclick: (e) => { e.preventDefault(); sigRows.splice(sigRows.indexOf(rec), 1); row.remove(); changed(); } }, 'remove'));
    const rec = { text, ck };
    sigRows.push(rec); sigBox.appendChild(row);
    text.addEventListener('input', changed); ck.onChange(changed);
  };
  for (const s of (draft?.signals ?? d.signals ?? [])) addSignal(s);

  // ---- weights ----
  const weightRows = t.spec.exposureAssets.map((a, i) => {
    const mn = h('input', { type: 'number', step: '0.5', size: 5, value: String((draft?.weights?.[i]?.min ?? Number(t.spec.hardMinWeightBps[i]) / 100)), style: 'width:80px' });
    const mx = h('input', { type: 'number', step: '0.5', size: 5, value: String((draft?.weights?.[i]?.max ?? Number(t.spec.hardMaxWeightBps[i]) / 100)), style: 'width:80px' });
    mn.addEventListener('input', changed); mx.addEventListener('input', changed);
    return { asset: a, sym: symOf(a), mn, mx, was: [Number(t.spec.hardMinWeightBps[i]) / 100, Number(t.spec.hardMaxWeightBps[i]) / 100] };
  });
  const weightTable = h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'asset'), h('th', {}, 'min %'), h('th', {}, 'max %'), h('th', {}, 'now'))),
    h('tbody', {}, ...weightRows.map((w) => h('tr', { 'data-asset': w.sym }, h('td', { class: 'mono' }, w.sym), h('td', {}, w.mn), h('td', {}, w.mx), h('td', { class: 'dim mono' }, `${w.was[0]}–${w.was[1]}`)))));

  const diff = h('div', { id: 'diff' });
  const hashOut = h('div', { class: 'mono dim', id: 'newHash' }, 'new spec hash …');
  const steps = h('div', { id: 'steps' });

  const draftOut = () => ({
    claim: claim.value, falsifier: falsifier.value, exit: exit.value, summary: summary.value, falsCheck: falsCheck.value(),
    signals: sigRows.map((r) => ({ text: r.text.value, check: r.ck.value() })),
    weights: weightRows.map((w) => ({ min: w.mn.value, max: w.mx.value })),
  });

  const changesOf = () => {
    const out = [];
    if (lines(claim.value) !== lines(d.claim)) out.push('claim wording');
    if (lines(falsifier.value) !== lines(d.falsifier)) out.push('falsifier wording');
    if (JSON.stringify(falsCheck.value() ?? null) !== JSON.stringify(d.watch?.falsifier ?? null)) out.push('falsifier machine check');
    if (lines(exit.value) !== lines(d.exitRule)) out.push('exit rule');
    if (lines(summary.value) !== lines(d.summary ?? d.thesis)) out.push('summary');
    const was = JSON.stringify((d.signals ?? []).map((s) => [lines(s.text), s.check ?? null]));
    const now = JSON.stringify(sigRows.filter((r) => lines(r.text.value)).map((r) => [lines(r.text.value), r.ck.value() ?? null]));
    if (was !== now) out.push('signals');
    for (const w of weightRows) if (Number(w.mn.value) !== w.was[0] || Number(w.mx.value) !== w.was[1]) out.push(`${w.sym} weight band`);
    return out;
  };

  // The new spec: everything of the old one that must not move (term, fees, dates, cash), with the
  // hashes of what changed. Unchanged words keep the hash the chain already has for them.
  const newSpec = () => {
    const o = t.spec;
    const wordsSame = (a, b) => lines(a) === lines(b);
    const now = BigInt(state.latestTime || Math.floor(Date.now() / 1000));
    return {
      specHash: ZERO32, creator: o.creator, benchmarkId: o.benchmarkId,
      claimHash: wordsSame(claim.value, d.claim) ? o.claimHash : keccak(lines(claim.value)),
      falsifierHash: wordsSame(falsifier.value, d.falsifier) ? o.falsifierHash : keccak(lines(falsifier.value)),
      exitRuleHash: wordsSame(exit.value, d.exitRule) ? o.exitRuleHash : keccak(lines(exit.value) || 'term end or falsifier'),
      publishedAt: now, entryUntil: o.entryUntil, termEnd: o.termEnd,
      perfFeeBps: o.perfFeeBps, subFeeBps: o.subFeeBps, redeemFeeBps: o.redeemFeeBps,
      exposureAssets: [...o.exposureAssets],
      hardMinWeightBps: weightRows.map((w) => Math.round(Number(w.mn.value) * 100)),
      hardMaxWeightBps: weightRows.map((w) => Math.round(Number(w.mx.value) * 100)),
      allowedCashAssets: [...o.allowedCashAssets], transferPolicy: o.transferPolicy, lockupEnd: o.lockupEnd,
      minFormation: o.minFormation, capacity: o.capacity, creatorCommit: o.creatorCommit, stakeS: o.stakeS,
      evaluationDate: o.evaluationDate, policyBoundsHash: o.policyBoundsHash,
    };
  };

  async function refresh() {
    const ch = changesOf();
    diff.replaceChildren(ch.length
      ? h('div', {}, h('b', {}, 'What changes in v2: '), ch.join(' · '))
      : h('div', { class: 'dim' }, 'No changes yet — v2 has to differ from what is running.'));
    try { hashOut.textContent = 'new spec hash ' + await read(ADDR.specs, A.ThesisSpecRegistry, 'hashOf', [newSpec()]); } catch (e) { hashOut.textContent = 'cannot hash yet: ' + String(e.message).slice(0, 100); }
  }
  function changed() {
    try { localStorage.setItem(draftKey, JSON.stringify(draftOut())); } catch { /* private mode */ }
    refresh();
  }
  for (const x of [claim, falsifier, exit, summary]) x.addEventListener('input', changed);
  falsCheck.onChange(changed);

  const note2 = (k, text, cls = '') => { let el = steps.querySelector(`[data-step="${k}"]`); if (!el) { el = h('div', { 'data-step': k }); steps.appendChild(el); } el.className = 'step ' + cls; el.textContent = text; };

  async function sendV2() {
    if (!t.mine) throw new Error(`only ${short(t.spec.creator)} can update this thesis — switch author`);
    const ch = changesOf();
    if (!ch.length) throw new Error('nothing changed — v2 has to differ from what is running');
    if (!lines(claim.value) || !lines(falsifier.value)) throw new Error('claim and falsifier are both required');
    steps.replaceChildren();
    const baseSlug = String(t.slug).replace(/-v\d+$/, '');
    const nth = Number((String(t.slug).match(/-v(\d+)$/) || [])[1] ?? 1) + 1;
    const exposure = weightRows.filter((w) => w.sym !== 'USDC').map((w) => ({
      symbol: w.sym, minBps: Math.round(Number(w.mn.value) * 100), softMaxBps: Math.round(Number(w.mx.value) * 100), maxBps: Math.round(Number(w.mx.value) * 100),
      minWeightBps: Math.round(Number(w.mn.value) * 100), maxWeightBps: Math.round(Number(w.mx.value) * 100),
    }));
    const doc = {
      ...d, claim: lines(claim.value), falsifier: lines(falsifier.value), exitRule: lines(exit.value), summary: lines(summary.value),
      signals: sigRows.filter((r) => lines(r.text.value)).map((r) => ({ text: lines(r.text.value), ...(r.ck.value() ? { check: r.ck.value() } : {}) })),
      exposure, publishedAt: new Date().toISOString().slice(0, 10), supersedes: t.specHash, version: nth,
    };
    delete doc.supersededBy; delete doc.specHash; delete doc.uri;
    const fc = falsCheck.value();
    doc.watch = { ...(d.watch ?? {}) }; if (fc) doc.watch.falsifier = fc; else delete doc.watch.falsifier;

    // 1. the words (content, write-once): a new version gets a new slug
    let slug = null;
    for (let n = nth; n < nth + 6 && !slug; n++) {
      const tryslug = `${baseSlug}-v${n}`;
      try { await api('/v1/docs', { slug: tryslug, doc: { ...doc, slug: tryslug, version: n } }); slug = tryslug; }
      catch (e) { if (!/already published/.test(e.message)) throw e; }
    }
    if (!slug) throw new Error('could not find a free version slug');
    note2('doc', `1/4 words saved as ${slug}`, 'ok');

    // 2. the spec — the author's own publish; the hash is what the chain will pin
    const spec = newSpec();
    const uri = `ipfs://demo/${slug}`;
    const newHash = await read(ADDR.specs, A.ThesisSpecRegistry, 'hashOf', [spec]);
    if (!(await read(ADDR.specs, A.ThesisSpecRegistry, 'exists', [newHash]))) await write(state.identity, ADDR.specs, A.ThesisSpecRegistry, 'publish', [spec, uri, '0x']);
    note2('publish', `2/4 published v2 ${short(newHash)}`, 'ok');

    // 3. the review queue
    if (Number(await read(ADDR.review, A.ThesisReview, 'statusOf', [newHash])) === 0) await write(state.identity, ADDR.review, A.ThesisReview, 'submit', [newHash]);
    note2('submit', '3/4 submitted to the review queue', 'ok');

    // 4. the old spec points at the new one (moves no money; only affects new entries)
    const meta = await read(ADDR.specs, A.ThesisSpecRegistry, 'getSpecMeta', [t.specHash]);
    if (String(meta[3]) === ZERO32) await write(state.identity, ADDR.specs, A.ThesisSpecRegistry, 'supersede', [t.specHash, newHash]);
    note2('supersede', '4/4 this spec now points at v2 — it keeps running until v2 is approved', 'ok');

    try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
    api('/v1/review').then((q) => {
      const r = q.find((x) => x.specHash.toLowerCase() === String(newHash).toLowerCase());
      steps.appendChild(h('p', { class: 'ok', id: 'sent' }, `v2 ${short(newHash)} is ${r ? r.status : 'on its way to the queue'}. v1 is still Live.`));
    }).catch(() => { });
    toast('v2 sent for review — v1 keeps running');
    return newHash;
  }

  root.appendChild(section('The words',
    field('claim', claim), field('what would change my mind (falsifier)', falsifier), falsCheck.node, field('exit rule', exit), field('summary', summary)));
  root.appendChild(section('Signals — conditions that fire a rule (the bots watch any with a machine check)',
    sigBox, h('div', { class: 'row' }, h('button', { id: 'addSignal', onclick: (e) => { e.preventDefault(); addSignal(); changed(); } }, '+ signal'))));
  root.appendChild(section('Weights — the hard band each asset may hold', weightTable,
    h('p', { class: 'hint' }, 'Term, fees and dates stay as published. The band is re-checked on-chain when v2 is approved.')));
  root.appendChild(section('Send',
    diff, hashOut,
    h('div', { class: 'row', style: 'margin-top:10px' },
      h('button', { class: 'primary', id: 'sendV2', onclick: (e) => { e.preventDefault(); run('send v2', sendV2); } }, 'Send v2 for review'),
      h('button', { onclick: (e) => { e.preventDefault(); try { localStorage.removeItem(draftKey); } catch { } renderEdit(root.replaceChildren() || root, vault); } }, 'discard draft'),
      h('span', { class: 'dim' }, 'autosaved in this browser as a draft')),
    steps));
  refresh();
}
