import { state, connect, actAs, tick, toast, log, el, IDENTITIES, DEMO_RPC, connectWallet, apiBase, ensureIdentity } from './core.js';
import { renderMine } from './views/mine.js';
import { renderEdit } from './views/edit.js';
import { renderStake } from './views/stake.js';
import { renderReports } from './views/reports.js';
import { renderLedger } from './views/ledger.js';
import { renderBots } from './views/bots.js';
import { renderNew } from './views/new.js';

/* Routes (hash): #/mine · #/bots · #/t/<vault>/edit|stake|reports|ledger   (:id is the fund's vault address) */
const SCREENS = { edit: renderEdit, stake: renderStake, reports: renderReports, ledger: renderLedger };
const LABEL = { edit: 'Update', stake: 'Stake', reports: 'Reports', ledger: 'Rule ledger' };

export function parseRoute(hash = location.hash) {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 't' && /^0x[a-fA-F0-9]{40}$/.test(parts[1] ?? '') && SCREENS[parts[2] ?? 'edit']) return { name: 'thesis', id: parts[1].toLowerCase(), screen: parts[2] ?? 'edit' };
  if (parts[0] === 'bots') return { name: 'bots' };
  if (parts[0] === 'new') return { name: 'new' };
  return { name: 'mine' };
}

function renderNav(r) {
  for (const a of document.querySelectorAll('#tabs > a')) a.classList.toggle('active', a.dataset.r === r.name);
  const box = el('thesisNav');
  box.innerHTML = '';
  if (r.name !== 'thesis') return;
  for (const s of Object.keys(SCREENS)) {
    const a = document.createElement('a');
    a.href = `#/t/${r.id}/${s}`;
    a.textContent = LABEL[s];
    a.dataset.r = 'screen-' + s;
    if (s === r.screen) a.classList.add('active');
    box.appendChild(a);
  }
  const who = document.createElement('span');
  who.className = 'dim mono';
  who.style.marginLeft = '12px';
  who.textContent = `fund ${r.id.slice(0, 8)}…${r.id.slice(-4)}`;
  box.appendChild(who);
}

let current = '';
export async function render() {
  const r = parseRoute();
  renderNav(r);
  current = location.hash;
  el('main').innerHTML = '';
  try {
    if (r.name === 'mine') await renderMine(el('main'));
    else if (r.name === 'bots') await renderBots(el('main'));
    else if (r.name === 'new') await renderNew(el('main'));
    else await SCREENS[r.screen](el('main'), r.id);
  } catch (e) { el('main').innerHTML = `<div class="boot">this view failed to load:<br>${String(e.message).slice(0, 300)}</div>`; log('render: ' + e.message, 'err'); }
}

function fillIdentitySelect() {
  const sel = el('identity');
  sel.innerHTML = '';
  for (const [id, def] of Object.entries(IDENTITIES)) {
    const o = document.createElement('option');
    o.value = id; o.textContent = def.label;
    sel.appendChild(o);
  }
  sel.value = state.identity in IDENTITIES ? state.identity : 'authorOne';
  el('identityAddr').textContent = IDENTITIES[sel.value]?.address ?? '';
}

async function boot() {
  el('rpc').value = state.rpc;
  el('api').value = apiBase();
  fillIdentitySelect();
  try {
    await connect();
    await tick();
    await actAs(el('identity').value).catch(() => { });
    await render();
  } catch (e) {
    if (state.rpc !== DEMO_RPC) {
      state.rpc = DEMO_RPC; localStorage.setItem('rpc', DEMO_RPC); el('rpc').value = DEMO_RPC;
      try { await connect(); await tick(); await render(); return; } catch (e2) { e = e2; }
    }
    el('main').innerHTML = `<div class="boot">no chain at ${state.rpc}<br><span class="dim">${String(e.message).slice(0, 160)}</span><br><br>
      start the stack (<code>bash script/up.sh</code> in Speculatory-backend) or open this page with <code>?rpc=&lt;rpc url&gt;</code><br>
      <a class="btn sm" style="margin-top:14px" href="${location.origin}${location.pathname}?rpc=${DEMO_RPC}">use the shared demo chain</a></div>`;
  }
}

el('reconnect').addEventListener('click', async () => {
  state.rpc = el('rpc').value.trim();
  localStorage.setItem('rpc', state.rpc);
  try { await connect(); await tick(); await render(); toast('connected'); } catch (e) { toast('cannot reach ' + state.rpc, true); }
});
el('rpc').addEventListener('keydown', (e) => { if (e.key === 'Enter') el('reconnect').click(); });
el('identity').addEventListener('change', async () => {
  const id = el('identity').value;
  el('identityAddr').textContent = IDENTITIES[id]?.address ?? '';
  await actAs(id);
  toast('now acting as ' + (IDENTITIES[id]?.label ?? id));
  render();
});
el('api').addEventListener('keydown', (e) => { if (e.key === 'Enter') { localStorage.setItem('api', el('api').value.trim()); toast('API set'); render(); } });
el('wallet').addEventListener('click', async () => {
  try {
    const a = await connectWallet();
    fillIdentitySelect(); el('identity').value = 'wallet'; el('identityAddr').textContent = a;
    await actAs('wallet'); el('wallet').textContent = a.slice(0, 6) + '…' + a.slice(-4);
    toast('wallet connected — transactions now open your wallet to confirm'); render();
  } catch (e) { toast(String(e.message).slice(0, 160), true); }
});
el('logToggle').addEventListener('click', () => el('log').classList.toggle('hidden'));
window.addEventListener('hashchange', () => { if (location.hash !== current) render(); });
setInterval(() => { tick().catch(() => { }); }, 8000);
boot();
void ensureIdentity;
