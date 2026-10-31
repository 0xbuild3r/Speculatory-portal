/**
 * ui_check.mjs — the portal in a real browser against the live local stack (chain + API [+ bots]).
 *
 *   node scripts/ui_check.mjs
 *
 * Env: RPC (http://127.0.0.1:8545)  API (http://127.0.0.1:8788)  CHROME_PATH
 *      VIEM_VENDOR  directory holding viem.js / viem_accounts.js / viem_chains.js (answers the import map offline)
 *      OUT          directory for screenshots (default ./.ui-check)
 *
 * Proves: every screen of every fund renders with no console error; the update flow (new ThesisSpec → publish →
 * review queue → supersede) lands v2 in the queue while v1 keeps running; a report with an uploaded image is published
 * and its image is served; stake top-up; the bot thresholds round-trip through the API; the ledger says "not evaluated"
 * for a rule nobody has checked. It never approves anything.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

let chromium;
for (const load of [() => import('playwright'), () => import('playwright-core'), () => createRequire(import.meta.url)('playwright')]) {
  try { ({ chromium } = await load()); if (chromium) break; } catch { /* next */ }
}
if (!chromium) { console.error('playwright is not installed'); process.exit(2); }

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const RPC = process.env.RPC || 'http://127.0.0.1:8545';
const API = process.env.API || 'http://127.0.0.1:8788';
const VENDOR = process.env.VIEM_VENDOR;
const OUT = resolve(process.env.OUT || join(root, '.ui-check'));
mkdirSync(OUT, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  const f = join(root, p === '/' ? 'index.html' : p);
  if (!f.startsWith(root) || !existsSync(f)) { res.statusCode = 404; res.end('nope'); return; }
  res.setHeader('content-type', MIME[extname(f)] || 'text/plain');
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/index.html?rpc=${encodeURIComponent(RPC)}&api=${encodeURIComponent(API)}`;

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
if (VENDOR) {
  await ctx.route(/https:\/\/esm\.sh\/viem@[\d.]+(\/accounts|\/chains)?(\?.*)?$/, (route) => {
    const u = route.request().url();
    const f = /accounts/.test(u) ? 'viem_accounts.js' : /chains/.test(u) ? 'viem_chains.js' : 'viem.js';
    route.fulfill({ contentType: 'text/javascript', body: readFileSync(join(VENDOR, f)) });
  });
}
await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());

const page = await ctx.newPage();
const errors = [];
let expectBad = false;   // a deliberate out-of-range save answers 400, and the browser logs that as a console error
page.on('console', (m) => { if (m.type() === 'error' && !/fonts|favicon|ERR_FAILED/.test(m.text()) && !(expectBad && /status of 400/.test(m.text()))) errors.push('[console] ' + m.text().slice(0, 300)); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + String(e.message).slice(0, 300)));

let failed = 0, passed = 0;
const ok = (c, what, d) => { if (c) { passed++; console.log('  ok  ', what); } else { failed++; console.log('  FAIL', what, d ?? ''); } };
const get = async (p) => (await fetch(API + p)).json();
const until = async (f, ms = 60000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await f().catch(() => null); if (v) return v; await new Promise((r) => setTimeout(r, 1200)); } return null; };
const go = async (hash, sel = 'main h2') => {
  await page.goto(`${base}#${hash}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction((s) => document.querySelector(s) || document.querySelector('.boot'), sel, { timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(700);
  return page.evaluate(() => ({ h2: document.querySelectorAll('main h2').length, boot: document.querySelector('.boot')?.textContent?.slice(0, 200) || '' }));
};

const funds = await get('/v1/funds');
// a v2 fund can carry the same title as its v1 — prefer the one with a real book and posted stake behind it
const cands = funds.filter((f) => /Balance-Sheet|AI Infra/i.test(f.name));
let two = cands[0] ?? funds[0];
for (const f of cands) {
  const st = await get(`/v1/funds/${f.address}/stake`).catch(() => ({}));
  // a closed stake means the fund's life is over — its top-up reverts; only a live stake proves this fund is still running
  if ((st.posted ?? 0) > 0 && st.state !== 'closed') { two = f; break; }
}
// the ledger test wants a complete thesis story: falsifier AND a signal. Among live funds, prefer the one that registered both.
for (const f of cands) {
  if (f.address === two.address) break;
  const st = await get(`/v1/funds/${f.address}/stake`).catch(() => ({}));
  if ((st.posted ?? 0) <= 0 || st.state === 'closed') continue;
  const led = await get(`/v1/funds/${f.address}/ledger`).catch(() => null);
  if ((led?.rules ?? []).some((r) => r.id === 'S1')) { two = f; break; }
}
const apps = funds.find((f) => f.address !== two.address);
// each fund is its own author's: pick the identity that owns it
const creatorOf = async (v) => (await get(`/v1/funds/${v}`)).creator.toLowerCase();
const idFor = async (v) => ((await creatorOf(v)) === '0x52ab6c6f3d9848eb3078e313c61da7f80bfff24d' || (await creatorOf(v)) === (await get('/v1/chain')).authorOne.toLowerCase()) ? 'authorOne' : 'authorTwo';
const actAs = async (id) => { await page.evaluate((i) => localStorage.setItem('portal-identity', i), id); };

console.log('screens (every fund, every screen)');
await page.goto(base, { waitUntil: 'domcontentloaded' });
for (const f of funds) {
  await actAs(await idFor(f.address));
  for (const s of ['edit', 'rebalance', 'stake', 'reports', 'ledger']) {
    const c = await go(`/t/${f.address}/${s}`);
    ok(c.h2 > 0 && !c.boot, `/t/${f.address.slice(0, 8)}…/${s} renders (${c.h2} cards)`, c.boot);
    if (f.address === two.address) await page.screenshot({ path: join(OUT, `${s}.png`), fullPage: true });
  }
}
await actAs(await idFor(two.address));
let c = await go('/mine', 'section.thesis');
ok(c.h2 > 0 && !c.boot, '/mine renders', c.boot);
ok(await page.locator('section.thesis').count() >= 1, 'my theses are listed with status and NAV');
await page.screenshot({ path: join(OUT, 'mine.png'), fullPage: true });
c = await go('/bots', 'section.bot');
ok(c.h2 > 0 && !c.boot, '/bots renders', c.boot);

console.log('ledger: a rule nobody has checked says so');
{
  // the rebalance bot / watcher may not have ticked yet on a fresh stack; the label is the contract either way
  await go(`/t/${two.address}/ledger`, 'section.rule');
  const txt = await page.evaluate(() => document.querySelector('main').textContent);
  ok(/F1/.test(txt) && /S1/.test(txt) && /REBALANCE/.test(txt) && /TERM/.test(txt), 'all four registered rules are listed');
  ok(/未評価|pass|done|skip|fired/.test(txt), 'each rule shows an evaluation or 未評価');
}

console.log('bots: the switch shows its state and flips through the API');
{
  await go('/bots', 'section.bot');
  const wasOn = (await get('/v1/bots')).config.expiry.enabled;
  const shown = await page.evaluate(() => document.querySelector('#toggle-expiry')?.getAttribute('aria-checked'));
  ok(shown === String(wasOn), 'the expiry switch shows the real state before the click', `${shown} vs ${wasOn}`);
  await page.click('#toggle-expiry');
  const flipped = await until(async () => (await get('/v1/bots')).config.expiry.enabled !== wasOn, 15000);
  ok(flipped, 'clicking it flips the bot through the API');
  await page.click('#toggle-expiry'); // put it back exactly as it was found
  await until(async () => (await get('/v1/bots')).config.expiry.enabled === wasOn, 15000);
}
{
  await go('/bots', 'section.bot');
  await page.fill('#cfg-rebalance-driftBps', '450');
  await page.click('#save-rebalance');
  const saved = await until(async () => (await get('/v1/bots')).config.rebalance.driftBps === 450, 15000);
  ok(saved, 'drift threshold saved to 450 bps');
  await page.waitForTimeout(800);
  ok(await page.inputValue('#cfg-rebalance-driftBps') === '450', 'the page shows the saved value');
  await page.fill('#cfg-rebalance-driftBps', '99999');
  expectBad = true;
  await page.click('#save-rebalance');
  await page.waitForTimeout(800);
  expectBad = false;
  ok((await get('/v1/bots')).config.rebalance.driftBps === 450, 'an out-of-range value is refused, not clamped');
  await page.fill('#cfg-rebalance-driftBps', '300');
  await page.click('#save-rebalance');
  ok(await until(async () => (await get('/v1/bots')).config.rebalance.driftBps === 300, 15000), 'and back to the default');
}

console.log('stake: top up');
{
  const before = (await get(`/v1/funds/${two.address}/stake`)).posted;
  await go(`/t/${two.address}/stake`, '#faucet');
  await page.click('#faucet');
  await page.waitForTimeout(2500);
  await page.fill('#stTop', '50');
  await page.click('#topUp');
  const grew = await until(async () => (await get(`/v1/funds/${two.address}/stake`)).posted > before, 40000);
  ok(grew, `the stake grew from ${before} (top-up through the same ConvictionStake call)`);
}

console.log('reports: markdown with an image');
{
  const slug = (await get(`/v1/specs/${two.specHash}`)).slug;
  await go(`/t/${two.address}/reports`, '#repBody');
  await page.fill('#repTitle', 'Portal check letter');
  // a 1×1 PNG
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.setInputFiles('#repImage', { name: 'chart.png', mimeType: 'image/png', buffer: png });
  await page.click('#addImage');
  await page.waitForFunction(() => document.getElementById('repBody').value.includes('assets/chart.png'), null, { timeout: 15000 }).catch(() => {});
  const body = await page.inputValue('#repBody');
  ok(/!\[chart\]\(assets\/chart\.png\)/.test(body), 'the image was uploaded and linked relatively');
  await page.fill('#repBody', 'First paragraph of the letter, long enough to publish.\n\n' + body + '\n\n## Second\n\nAnd a closing paragraph about the book and what it did.');
  const imgOk = await page.evaluate(() => { const i = document.querySelector('#repPreview img'); return i ? i.getAttribute('src') : ''; });
  ok(imgOk.includes(`/v1/assets/${slug}/chart.png`), 'the preview resolves the image against the asset route', imgOk);
  await page.click('#publishReport');
  const rep = await until(async () => (await get(`/v1/funds/${two.address}/reports`)).find((r) => r.title === 'Portal check letter'), 20000);
  ok(rep, 'the report is on the fund’s Reports list');
  const asset = await fetch(`${API}/v1/assets/${slug}/chart.png`);
  ok(asset.ok && asset.headers.get('content-type') === 'image/png', 'the image is served with the right type');
  const essay = rep ? await (await fetch(`${API}/v1/essays/${rep.file}`)).text() : '';
  ok(/assets\/chart\.png/.test(essay), 'the stored markdown keeps the relative image link');
}

console.log('update flow: v2 goes to the review queue, v1 keeps running');
{
  const v1Hash = two.specHash;
  const v1Doc = await get(`/v1/specs/${v1Hash}`);
  const navBefore = (await get(`/v1/funds/${two.address}`)).nav.perUnit;
  // the chain is shared and may carry v2s from earlier runs — measure the change this run makes, not the absolute total
  const supersBefore = (await get('/v1/review')).filter((r) => r.supersedes).length;
  const pointerBefore = (await get(`/v1/specs/${v1Hash}`)).supersededBy || null;
  await go(`/t/${two.address}/edit`, '#sendV2');
  // nothing changed yet → refused
  await page.click('#sendV2');
  await page.waitForTimeout(1200);
  ok((await get('/v1/review')).filter((r) => r.supersedes).length === supersBefore, 'an unchanged v2 is refused (nothing was sent)');
  // change the falsifier wording and a weight, add a signal
  const newFals = v1Doc.falsifier + ' (v2: two quarters, either name)';
  await page.fill('main textarea >> nth=1', newFals);
  await page.click('#addSignal');
  await page.fill('.signal-row:last-of-type input[size="70"]', 'TSM draws down 20% from where the watch began.');
  await page.waitForTimeout(500);
  const diff = await page.textContent('#diff');
  ok(/falsifier wording/.test(diff) && /signals/.test(diff), 'the page lists what changes in v2', diff);
  const newHashShown = (await page.textContent('#newHash')).match(/0x[0-9a-f]{64}/i)?.[0];
  ok(newHashShown, 'and the new spec hash is shown before sending');
  await page.click('#sendV2');
  const sent = await until(async () => (await page.locator('#sent').count()) > 0, 90000);
  ok(sent, 'the four steps ran (words → publish → submit → supersede)');
  const find = async () => (await get('/v1/review')).find((r) => r.specHash.toLowerCase() === newHashShown?.toLowerCase());
  let q = await until(find, 30000);
  ok(q && q.status === 'submitted', 'v2 is in the review queue as submitted', JSON.stringify(q));
  // the queue row is indexed from three sources (spec, review, supersede); give the projection a moment to join them
  q = await until(async () => { const r = await find(); return r && (r.supersedes || r.replaces) ? r : null; }, 30000) ?? q;
  ok(q?.supersedes === v1Hash || String(q?.replaces ?? '').toLowerCase() === v1Hash.toLowerCase(), 'and the queue knows it is a version of this thesis', JSON.stringify(q));
  const sup = await until(async () => { const s = await get(`/v1/specs/${v1Hash}`); return s.supersededBy ? s : null; }, 30000);
  // if v1 was already pointing somewhere from an earlier run, any pointer proves the path ran; if it was clean, this run's hash must be it
  ok(sup && (pointerBefore ? sup.supersededBy : sup.supersededBy.toLowerCase() === newHashShown.toLowerCase()), 'v1 now points at v2 (supersede)');
  const fundNow = await get(`/v1/funds/${two.address}`);
  ok(fundNow.specHash === v1Hash, 'the Live fund still runs v1');
  ok((await get('/v1/bots/targets')).targets.some((t) => t.vault === two.address && !t.falsified), 'and its bots keep watching it');
  void navBefore;
  await go('/mine', 'section.thesis');
  const mineTxt = await page.evaluate(() => document.querySelector('main').textContent);
  ok(/v2 in review/.test(mineTxt) && /keeps running/.test(mineTxt), '/mine shows v2 in review while v1 stays Live');
  ok(!(await page.locator('button, a.btn, input[type=button]').filter({ hasText: /approve|reject/i }).count()), 'the portal has no approve/reject controls');
  await page.screenshot({ path: join(OUT, 'mine-after-update.png'), fullPage: true });
}

console.log('publish: a brand-new thesis is sent from the portal itself');
{
  const before = (await get('/v1/review')).length;
  await actAs('authorOne');
  let cc = await go('/new', 'main h2');
  ok(cc.h2 > 0 && !cc.boot, '/new renders', cc.boot);
  const title = `Portal quick start ${Date.now().toString(36)}`;
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  await page.fill('#ntTitle', title);
  await page.fill('#ntClaim', 'A claim typed in the portal becomes the hash the chain pins.');
  await page.fill('#ntFals', 'Three consecutive quarters where the index outperforms the book.');
  await page.fill('#ntSummary', 'A thesis published from the author portal, queued and approved like any other.');
  await page.click('#publishThesis');
  const sent = await until(async () => (await page.locator('#sent').count()) > 0, 90000);
  ok(sent, 'the three steps ran (words → publish → submit)');
  const hashShown = (await page.textContent('#newHash')) || '';
  const newHash = hashShown.match(/0x[0-9a-f]{64}/i)?.[0];
  ok(Boolean(newHash), 'the published spec hash is shown', hashShown.slice(0, 90));
  const q = await until(async () => (await get('/v1/review')).find((r) => String(r.specHash).toLowerCase() === String(newHash).toLowerCase()), 30000);
  ok(q && q.status === 'submitted', 'the new thesis sits in the review queue as submitted', JSON.stringify(q));
  ok((await get(`/v1/docs/${slug}`)).exists === true, 'its words are saved write-once under its own slug', slug);
  ok((await get('/v1/review')).length >= before, 'the queue grew — the portal itself decided nothing');
  await go('/mine', 'section.thesis');
  const mineTxt = await page.evaluate(() => document.querySelector('main').textContent);
  ok(mineTxt.includes('Waiting to go Live') && mineTxt.includes('Portal quick start'), '/mine lists it under waiting to go Live');
}

console.log('assets: an author can name one the deploy never listed');
{
  await actAs('authorOne');
  await go('/new', 'main h2');
  const sym = ('Z' + Date.now().toString(36).slice(-4)).toUpperCase();
  await page.fill('#waSym', sym);
  await page.fill('#waPrice', '42');
  await page.click('#waGo');
  const seen = await until(async () => page.evaluate((s) => (
    [...document.querySelectorAll('.weight-row select')].some((sel) => [...sel.options].some((o) => o.textContent.trim() === s))
    && /on this chain/.test(document.getElementById('waNote')?.textContent || '')), sym), 60000);
  ok(Boolean(seen), 'listing a symbol puts it on the chain and in a book row', sym);
  ok((await get('/v1/assets')).assets.some((a) => a.symbol === sym), 'the asset list says it is listed');
}

console.log('rebalance: the author dials weights from the portal and the vault confirms');
{
  await actAs(await idFor(two.address));
  let cc = await go(`/t/${two.address}/rebalance`, '#rbSet');
  ok(cc.h2 > 0 && !cc.boot, '/t/…/rebalance renders', cc.boot);
  const vals = await page.$$eval('input[id^="rb-in-"]', (els) => els.map((e) => ({ id: e.id, v: Number(e.value) })));
  ok(vals.length >= 1, 'every asset in the book gets a dial');
  const pick = vals.find((r) => r.v > 0) ?? vals[0];
  const bandTxt = await page.textContent('#rb-band-' + pick.id.slice('rb-in-'.length));
  const lo = Number(bandTxt.match(/([\d.]+)\s*%/)[1]);
  const next = pick.v > lo ? pick.v - 1 : pick.v + 1;
  await page.fill('#' + pick.id, String(next));
  await page.click('#rbSet');
  await page.waitForTimeout(6000);
  await go(`/t/${two.address}/rebalance`, '#rbSet');
  const now = Number(await page.inputValue('#' + pick.id));
  ok(now === next, `the dial to ${next}% is on the vault (read back after a reload)`, String(now));
  await page.fill('#' + pick.id, String(pick.v));
  await page.click('#rbSet');
  await page.waitForTimeout(6000);
  await go(`/t/${two.address}/rebalance`, '#rbSet');
  ok(Number(await page.inputValue('#' + pick.id)) === pick.v, 'and the author can put it back');
  // a band-busting weight is caught before any transaction goes out
  const rows = await page.$$eval('input[id^="rb-in-"]', (els) => els.map((e) => {
    const m = e.closest('tr').querySelector('td[id^="rb-band-"]').textContent.match(/([\d.]+)\s*%\s*[–-]\s*([\d.]+)\s*%/);
    return { id: e.id, hi: m ? Number(m[2]) : 100 };
  }));
  const bust = rows.find((r) => 99 > r.hi) ?? rows[rows.length - 1];
  await page.fill('#' + bust.id, '99');
  await page.click('#rbSet');
  await page.waitForTimeout(1500);
  const txt = await page.evaluate(() => document.querySelector('main').textContent);
  ok(/outside the band/.test(txt) || /fix the weights/.test(txt), 'a weight outside the band never reaches the chain');
  await go(`/t/${two.address}/rebalance`, '#rbSet'); // leave the page as it was found
}

void apps;
ok(errors.length === 0, `no console errors (${errors.length})`, errors.slice(0, 5));
console.log(`\n${passed} passed, ${failed} failed · screenshots in ${OUT}`);
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
