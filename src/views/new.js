/**
 * Publish a thesis — the words that become hashes, then the review queue.
 *
 * The same three steps the console's Author tab sends, from the author's own side of the table:
 * the document is written (write-once content), the author publishes the ThesisSpec with their own
 * signature, and submits it to ThesisReview. Approval and opening the vault stay with the Admin
 * console — nothing here can decide its own fate.
 */
import { api, read, write, state, A, ADDR, h, keccak, section, field, run, toast, short, IDENTITIES } from '../core.js';
import { me, symbols, symOf, ZERO32, loadAssets, assetOptions, wireAsset } from './shared.js';
import { checkEditor } from './edit.js';

const pct = (s) => Math.round(parseFloat(s || '0') * 100);
const slugOf = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
const toBase64 = (buf) => { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); };

export async function renderNew(root) {
  const KEY = '***';
  await loadAssets(); // names listed after the deploy are selectable too
  let draft = null;
  try { draft = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { /* none */ }

  // ---- the words ----
  const title = h('input', { id: 'ntTitle', value: draft?.title ?? '', size: 64, placeholder: 'a thesis worth putting your own money behind' });
  const claim = h('textarea', { id: 'ntClaim', rows: 3, style: 'width:100%' }); claim.value = draft?.claim ?? '';
  const falsifier = h('textarea', { id: 'ntFals', rows: 2, style: 'width:100%' }); falsifier.value = draft?.falsifier ?? '';
  const falsCheck = checkEditor(draft?.falsCheck);
  const exit = h('input', { id: 'ntExit', value: draft?.exit ?? 'term end or falsifier', size: 60 });
  const summary = h('textarea', { id: 'ntSummary', rows: 3, style: 'width:100%' }); summary.value = draft?.summary ?? '';

  // ---- the essay (optional, images welcome) ----
  const essay = h('textarea', { id: 'ntEssay', rows: 8, placeholder: 'optional long version — paragraphs, ## heads, ![alt](assets/chart.png)', style: 'width:100%;font-family:ui-monospace,monospace;font-size:12px;line-height:1.55;padding:10px' }); essay.value = draft?.essay ?? '';
  const imgFile = h('input', { type: 'file', id: 'ntImage', accept: 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml' });
  const imgNote = h('span', { class: 'dim' }, 'uploads to the essay’s slug before the document is written');
  const uploaded = new Map(); // name → bytes, re-saved under the final slug if it shifts
  async function addImage() {
    const slug = slugOf(title.value) || 'untitled';
    const f = imgFile.files[0];
    if (!f) throw new Error('choose an image first');
    const bytes = new Uint8Array(await f.arrayBuffer());
    const r = await api(`/v1/assets/${slug}`, { name: f.name, data: toBase64(bytes) });
    uploaded.set(f.name, bytes);
    essay.value += `\n\n${r.markdown}\n`;
    imgNote.textContent = `${f.name} → assets/${r.name}`;
    changed();
  }

  // ---- the signals ----
  const sigBox = h('div', {});
  const sigRows = [];
  const addSignal = (s = { text: '', check: undefined }) => {
    const text = h('input', { value: s.text ?? '', size: 70, placeholder: 'when this is true, the bots act on a rule' });
    const ck = checkEditor(s.check);
    const row = h('div', { class: 'signal-row', style: 'margin:6px 0' }, text, ck.node, h('button', { onclick: (e) => { e.preventDefault(); sigRows.splice(sigRows.indexOf(rec), 1); row.remove(); changed(); } }, 'remove'));
    const rec = { text, ck };
    sigRows.push(rec); sigBox.appendChild(row);
    text.addEventListener('input', changed); ck.onChange(changed);
  };
  for (const s of (draft?.signals ?? [])) addSignal(s);

  // ---- the terms ----
  const bench = h('input', { id: 'ntBench', value: draft?.bench ?? 'SPX', size: 8 });
  const termDays = h('input', { id: 'ntTerm', value: draft?.termDays ?? '1095', size: 6 });
  const entryDays = h('input', { id: 'ntEntry', value: draft?.entryDays ?? '365', size: 6 });
  const perf = h('input', { id: 'ntPerf', value: draft?.perf ?? '1000', size: 5 });
  const sub = h('input', { id: 'ntSub', value: draft?.sub ?? '50', size: 5 });
  const redeem = h('input', { id: 'ntRedeem', value: draft?.redeem ?? '10', size: 5 });
  const minForm = h('input', { id: 'ntMin', value: draft?.minForm ?? '1000', size: 10 });
  const capacity = h('input', { id: 'ntCap', value: draft?.cap ?? '10000000', size: 10 });

  // ---- the book: assets with hard bands, and a way to name one the world has not listed yet ----
  const assetList = h('div', {});
  const refreshOpts = () => { for (const r of assetList.querySelectorAll('.weight-row select')) syncOpts(r); };
  const syncOpts = (sel) => {
    const want = assetOptions(); const had = sel.value;
    sel.replaceChildren(...want.map((o) => h('option', { value: o.addr }, o.sym)));
    if ([...sel.options].some((o) => o.value.toLowerCase() === had.toLowerCase())) sel.value = had;
  };
  const assetRow = (sym, min, max) => {
    const sel = h('select', {}, ...assetOptions().map((o) => h('option', { value: o.addr, selected: o.sym === sym }, o.sym)));
    sel.addEventListener('change', changed);
    const mn = h('input', { type: 'number', step: '0.5', size: 5, value: min, style: 'width:80px' });
    const mx = h('input', { type: 'number', step: '0.5', size: 5, value: max, style: 'width:80px' });
    for (const x of [mn, mx]) x.addEventListener('input', changed);
    const row = h('div', { class: 'weight-row', style: 'margin:4px 0' }, sel, mn, h('span', { class: 'dim' }, '% min  '), mx, h('span', { class: 'dim' }, '% max'));
    row.dataset.kind = 'asset';
    return row;
  };
  const wireSym = h('input', { id: 'waSym', size: 6, placeholder: 'SYM', style: 'text-transform:uppercase' });
  const wirePrice = h('input', { id: 'waPrice', type: 'number', step: '0.01', size: 8, placeholder: 'price $' });
  const wireBtn = h('button', { id: 'waGo', onclick: (e) => { e.preventDefault(); wireIt(); } }, 'list it');
  const wireNote = h('span', { id: 'waNote', class: 'dim' }, 'a name outside the demo set: the marketplace lists it — token, price feed, market — then it joins the rows above');
  const wireRow = h('div', { class: 'row', style: 'margin-top:8px' }, h('span', { class: 'dim' }, '+ a new asset:'), wireSym, wirePrice, wireBtn, wireNote);
  async function wireIt() {
    const sym = wireSym.value.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9]{1,5}$/.test(sym)) { toast('a symbol is 2-6 characters, letters and digits, starting with a letter'); return; }
    try {
      const out = await wireAsset(sym, wirePrice.value || 100);
      refreshOpts();
      assetList.appendChild(assetRow(out.symbol, 0, 25));
      wireSym.value = ''; wirePrice.value = '';
      wireNote.textContent = `${out.symbol} is on this chain${out.existed ? ' — it was already listed' : ''}, in a book row at 0–25%; set the band you want.`;
      changed();
    } catch (err) { toast('could not list it: ' + err.message); }
  }
  for (const w of (draft?.weights ?? [{ sym: 'USDC', min: 0, max: 100 }, { sym: 'NVDA', min: 50, max: 90 }])) assetList.appendChild(assetRow(w.sym, w.min, w.max));
  const bookRows = () => [...assetList.querySelectorAll('.weight-row')].map((r) => ({
    addr: r.querySelector('select').value, sym: symOf(r.querySelector('select').value),
    min: r.querySelectorAll('input')[0].value, max: r.querySelectorAll('input')[1].value,
  }));

  const hashOut = h('div', { class: 'mono dim', id: 'newHash' }, 'spec hash …');
  const steps = h('div', { id: 'steps' });

  function values() {
    const now = BigInt(state.latestTime || Math.floor(Date.now() / 1000));
    const DAY = 86400n;
    const assets = bookRows();
    const term = BigInt(Number(termDays.value) || 1095) * DAY;
    return {
      specHash: ZERO32, creator: me(),
      benchmarkId: keccak(bench.value.trim() || 'SPX'), claimHash: keccak(claim.value.trim()),
      falsifierHash: keccak(falsifier.value.trim()), exitRuleHash: keccak(exit.value.trim() || 'term end or falsifier'),
      publishedAt: now, entryUntil: now + BigInt(Number(entryDays.value) || 365) * DAY, termEnd: now + term,
      perfFeeBps: Number(perf.value) || 0, serviceFeeBps: Number(sub.value) || 0, redeemFeeBps: Number(redeem.value) || 0,
      exposureAssets: assets.map((a) => a.addr),
      hardMinWeightBps: assets.map((a) => pct(a.min)), hardMaxWeightBps: assets.map((a) => pct(a.max)),
      allowedCashAssets: [ADDR.usdc], transferPolicy: 1, lockupEnd: now + 90n * DAY,
      minFormation: BigInt(Math.round(parseFloat(minForm.value || '0') * 1e6)),
      capacity: BigInt(Math.round(parseFloat(capacity.value || '0') * 1e6)),
      creatorCommit: 0, stakeS: 0, evaluationDate: now + term, policyBoundsHash: ZERO32,
    };
  }

  async function refresh() {
    try { hashOut.textContent = 'spec hash ' + await read(ADDR.specs, A.ThesisSpecRegistry, 'hashOf', [values()]); }
    catch (e) { hashOut.textContent = 'cannot hash yet: ' + String(e.message).slice(0, 100); }
  }
  function changed() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        title: title.value, claim: claim.value, falsifier: falsifier.value, falsCheck: falsCheck.value(), exit: exit.value,
        summary: summary.value, essay: essay.value, bench: bench.value, termDays: termDays.value, entryDays: entryDays.value,
        perf: perf.value, sub: sub.value, redeem: redeem.value, minForm: minForm.value, cap: capacity.value,
        signals: sigRows.map((r) => ({ text: r.text.value, check: r.ck.value() })),
        weights: bookRows().map((a) => ({ sym: a.sym, min: a.min, max: a.max })),
      }));
    } catch { /* private mode */ }
    refresh();
  }
  for (const x of [title, claim, falsifier, exit, summary, essay, bench, termDays, entryDays, perf, sub, redeem, minForm, capacity]) x.addEventListener('input', changed);
  falsCheck.onChange(changed);

  const note2 = (k, text, cls = '') => { let e2 = steps.querySelector(`[data-step="${k}"]`); if (!e2) { e2 = h('div', { 'data-step': k }); steps.appendChild(e2); } e2.className = 'step ' + cls; e2.textContent = text; };

  async function publishIt() {
    const t = title.value.trim();
    if (t.length < 3) throw new Error('a title first — three characters at least');
    if (!claim.value.trim() || !falsifier.value.trim()) throw new Error('claim and falsifier are both required — a thesis without a way to lose is not a thesis');
    const fc = falsCheck.value();
    if (!fc && bookRows().every((a) => a.sym === 'USDC')) throw new Error('the book is all cash — put something in it, or write why this is a cash thesis into the claim');
    steps.replaceChildren();

    // 1. the words (content, write-once): a title collision gets a suffix, the file is never overwritten
    const base = slugOf(t);
    let slug = null;
    for (let n = 0; n < 30 && !slug; n++) {
      const tryslug = n ? `${base}-${n + 1}` : base;
      if ((await api(`/v1/docs/${tryslug}`)).exists) continue;
      const doc = {
        slug: tryslug, title: t, author: IDENTITIES[state.identity]?.label ?? 'the author',
        publishedAt: new Date().toISOString().slice(0, 10), horizonDays: Number(termDays.value) || 1095,
        benchmark: bench.value.trim() || 'SPX', summary: summary.value.trim(), claim: claim.value.trim(),
        falsifier: falsifier.value.trim(), exitRule: exit.value.trim() || 'term end, or the falsifier firing.',
        fees: { performanceBps: Number(perf.value) || 0, serviceBps: Number(sub.value) || 0, redemptionBps: Number(redeem.value) || 0, currency: 'USD' },
        exposure: bookRows().filter((a) => a.sym !== 'USDC').map((a) => ({
          symbol: a.sym, minBps: pct(a.min), softMaxBps: pct(a.max), maxBps: pct(a.max), minWeightBps: pct(a.min), maxWeightBps: pct(a.max),
        })),
        signals: sigRows.filter((r) => r.text.value.trim()).map((r) => ({ text: r.text.value.trim(), ...(r.ck.value() ? { check: r.ck.value() } : {}) })),
        ...(fc ? { watch: { falsifier: fc } } : {}), version: 1,
      };
      const essayText = essay.value.trim();
      await api('/v1/docs', { slug: tryslug, doc, ...(essayText ? { essay: essayText } : {}) });
      slug = tryslug;
    }
    if (!slug) throw new Error('too many titles like this already — pick a different one');
    if (slug !== (slugOf(t) || 'untitled')) for (const [name, bytes] of uploaded) await api(`/v1/assets/${slug}`, { name, data: toBase64(bytes) });
    note2('doc', `1/3 words saved as ${slug}`, 'ok');

    // 2. the spec — the author's own publish; the hash is what the chain pins
    const spec = values();
    const uri = `ipfs://demo/${slug}`;
    const hash = await read(ADDR.specs, A.ThesisSpecRegistry, 'hashOf', [spec]);
    if (!(await read(ADDR.specs, A.ThesisSpecRegistry, 'exists', [hash]))) await write(state.identity, ADDR.specs, A.ThesisSpecRegistry, 'publish', [spec, uri, '0x']);
    hashOut.textContent = 'spec hash ' + hash;
    note2('publish', `2/3 published ${short(hash)} — waiting in the review queue`, 'ok');

    // 3. the queue: the author submits; only the Admin decides
    if (Number(await read(ADDR.review, A.ThesisReview, 'statusOf', [hash])) === 0) await write(state.identity, ADDR.review, A.ThesisReview, 'submit', [hash]);
    note2('submit', '3/3 submitted to the review queue', 'ok');

    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    api('/v1/review').then((q) => {
      const r = q.find((x) => x.specHash.toLowerCase() === String(hash).toLowerCase());
      steps.appendChild(h('p', { class: 'ok', id: 'sent' }, `${short(hash)} is ${r ? r.status : 'on its way to the queue'}. When the Admin approves it and opens a vault, it appears under My theses.`));
    }).catch(() => { });
    toast('published — waiting for the review queue');
    return hash;
  }

  root.appendChild(section('Publish a thesis',
    h('p', { class: 'hint' }, 'The words below become hashes in a ThesisSpec that you publish yourself, then land in the review queue. Nothing goes Live before the Admin approves it in the console — the same transactions the console’s Author tab sends, from your side.')));
  root.appendChild(section('The words',
    field('title (becomes the document slug)', title), field('claim', claim), field('what would change my mind (falsifier)', falsifier), falsCheck.node,
    field('exit rule', exit), field('summary — the sentence under the title', summary)));
  root.appendChild(section('The essay — optional, read on the Live page',
    essay, h('div', { class: 'row' }, field('image', imgFile), h('button', { id: 'addImage', onclick: (e) => { e.preventDefault(); run('upload image', addImage); } }, 'upload + insert'), imgNote)));
  root.appendChild(section('Signals — conditions the bots watch',
    sigBox, h('div', { class: 'row' }, h('button', { id: 'addSignal', onclick: (e) => { e.preventDefault(); addSignal(); changed(); } }, '+ signal'))));
  root.appendChild(section('The terms',
    h('div', { class: 'row' }, field('benchmark', bench), field('term days', termDays), field('entry window days', entryDays), field('perf fee bps', perf), field('service fee bps / year (no entry fee)', sub), field('redeem fee bps', redeem)),
    h('div', { class: 'row' }, field('min formation $', minForm), field('capacity $', capacity)),
    h('label', {}, 'the book — the hard band each asset may hold'), assetList,
    h('div', { class: 'row' }, h('button', { onclick: (e) => { e.preventDefault(); assetList.appendChild(assetRow((assetOptions().find((o) => o.sym !== 'USDC') ?? assetOptions()[0]).sym, '10', '40')); changed(); } }, '+ asset')),
    wireRow));
  root.appendChild(section('Send',
    hashOut,
    h('div', { class: 'row', style: 'margin-top:10px' },
      h('button', { class: 'primary', id: 'publishThesis', onclick: (e) => { e.preventDefault(); run('publish', publishIt); } }, 'publish & submit'),
      h('button', { onclick: (e) => { e.preventDefault(); try { localStorage.removeItem(KEY); } catch { } location.hash = '#/mine'; } }, 'discard draft'),
      h('span', { class: 'dim' }, 'autosaved in this browser')),
    steps));
  refresh();
}
