/**
 * Portal core — the console's viem plumbing (a thin fork: identities, wallet, impersonation, tx, formatting, api()).
 *
 * The identities are EOAs with no keys (that is what makes them safe to hand to a demo).
 * The console signs by asking the local node to impersonate them — the same cheat seed.ts uses.
 * A few demo accounts (alice/solver/…) are the standard local mnemonic accounts; the mnemonic is
 * the one every local node prints on startup, public knowledge, not a credential.
 */
import { createPublicClient, createWalletClient, custom, http, keccak256, toBytes, decodeEventLog, formatEther, formatUnits, parseUnits } from 'viem';
import { privateKeyToAccount, mnemonicToAccount, toAccount } from 'viem/accounts';
import { ABI, ADDRESS } from './data.js';

export const DEMO_MNEMONIC = 'test test test test test test test test test test test junk';

/* The shared demo chain: the quick tunnel carries RPC and the /v1 API on one origin (rpcproxy).
   A visitor on a laptop far from this node gets the same chain the demo is indexed on; a developer
   at the node overrides with ?rpc=http://127.0.0.1:8789 (which carries both, or 8545 for RPC only). */
export const DEMO_RPC = 'https://lent-dripping-disrupt.ngrok-free.dev';

export const state = {
  rpc: new URLSearchParams(location.search).get('rpc') || localStorage.getItem('rpc') || DEMO_RPC,
  identity: localStorage.getItem('portal-identity') || 'authorOne',
  chainId: null, block: 0n, latestTime: 0,
};
if (state.rpc !== (localStorage.getItem('rpc') || '')) localStorage.setItem('rpc', state.rpc);

/** id → { address, keys? }  keys: derive from the standard local mnemonic at index } */
export const IDENTITIES = {
  authorOne:{ address: ADDRESS.authorOne, label: 'Author One' },
  authorTwo:{ address: ADDRESS.authorTwo, label: 'Author Two' },
};

const impersonated = new Set();
let publicClient = null, walletClient = null;

/* ---- a real wallet (EIP-1193) -------------------------------------------------------------
   'wallet' is one more identity in the select. When it is the one acting, transactions go to the
   injected wallet (MetaMask, Rabby …) and the human confirms them — the UX of the real product.
   Everything else is the demo cheat: the node signs for the address, no prompt. */
export const wallet = { address: localStorage.getItem('wallet-address') || null };
export function hasInjected() { return typeof window !== 'undefined' && !!window.ethereum; }
export async function connectWallet() {
  if (!hasInjected()) throw new Error('no wallet found in this browser — install MetaMask or Rabby');
  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
  const chainId = state.chainId ?? 31337;
  const hex = '0x' + chainId.toString(16);
  try {
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] });
  } catch (e) {
    if (e?.code === 4902 || /unrecognized|not been added/i.test(String(e?.message))) {
      await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{
        chainId: hex, chainName: 'Speculatory demo chain', rpcUrls: [state.rpc],
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 } }] });
    } else throw e;
  }
  wallet.address = accounts[0];
  localStorage.setItem('wallet-address', wallet.address);
  IDENTITIES.wallet = { address: wallet.address, label: 'My wallet (' + wallet.address.slice(0, 6) + '…' + wallet.address.slice(-4) + ')', wallet: true };
  return wallet.address;
}
/** the client that will carry this account's transactions */
function clientFor(account) {
  if (account && account.wallet) return createWalletClient({ chain: chainSpec(), transport: custom(window.ethereum) });
  return walletClient;
}
const signerOf = (account) => (account && account.wallet ? account.address : account);

/* ---- the API (indexer + simulator + keeper) --------------------------------------------------
   ?api= wins, then localStorage, then the local backend when the RPC is a local node, then the RPC's own origin. */
export function apiBase() {
  const q = new URLSearchParams(location.search).get('api');
  if (q) { localStorage.setItem('api', q); return q.replace(/\/+$/, ''); }
  const saved = localStorage.getItem('api');
  if (saved) return saved.replace(/\/+$/, '');
  const r = (state.rpc || '').replace(/\/+$/, '');
  if (/^https?:\/\/(127\.0\.0\.1|localhost):8545$/.test(r)) return 'http://127.0.0.1:8788';
  return r;
}
/* free tunnels show a browser-warning interstitial to plain GETs — ask to skip it where relevant */
const ngrokSkipWarn = (u) => (/ngrok|trycloudflare/.test(u || '') ? { 'ngrok-skip-browser-warning': 'demo' } : {});
export async function api(path, body) {
  const opts = body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  const attempt = async (base) => {
    const r = await fetch(base + path, { ...opts, headers: { ...(opts.headers || {}), ...ngrokSkipWarn(base) } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(String(j.error || r.status).slice(0, 200));
    return j;
  };
  const base = apiBase();
  try { return await attempt(base); } catch (e) {
    // the configured API may be stale (localStorage) or simply down; the RPC shares it (rpcproxy)
    const alt = (state.rpc || '').replace(/\/+$/, '');
    if (alt && alt !== base) return attempt(alt);
    throw e;
  }
}

export function chainSpec() {
  return { id: state.chainId ?? 31337, name: 'Anvil', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [state.rpc] } } };
}

export async function connect() {
  publicClient = createPublicClient({ transport: http(state.rpc, { fetchOptions: { headers: ngrokSkipWarn(state.rpc) } }) });
  walletClient = createWalletClient({ transport: http(state.rpc, { fetchOptions: { headers: ngrokSkipWarn(state.rpc) } }) });
  state.chainId = await publicClient.getChainId();
  return publicClient;
}
export function public_() { return publicClient; }
export const A = ABI;
export const ADDR = ADDRESS;

// ---- identity ---------------------------------------------------------------

export async function ensureIdentity(id) {
  const def = IDENTITIES[id] ?? { address: id };  // raw address passes through
  const address = def.address;
  if (def.wallet) return { address, wallet: true, type: 'json-rpc' };
  if (def.keys !== undefined) return mnemonicToAccount(DEMO_MNEMONIC, { accountIndex: 0, addressIndex: def.keys });
  if (!impersonated.has(address)) {
    await publicClient.request({ method: 'anvil_impersonateAccount', params: [address] });
    impersonated.add(address);
  }
  const bal = await publicClient.getBalance({ address });
  if (bal === 0n) {
    // a demo identity must be able to pay gas; fund it once from the deployer's account
    const funder = mnemonicToAccount(DEMO_MNEMONIC, { accountIndex: 0, addressIndex: 0 });
    const hash = await walletClient.sendTransaction({ account: funder, chain: chainSpec(), to: address, value: 1_500_000_000_000_000_000n });
    await publicClient.waitForTransactionReceipt({ hash });
  }
  return toAccount(address);
}

/** impersonate any address as one-off actor (returns a viem account) */
export async function accountFor(address) {
  if (!impersonated.has(address)) {
    await publicClient.request({ method: 'anvil_impersonateAccount', params: [address] });
    impersonated.add(address);
  }
  const bal = await publicClient.getBalance({ address });
  if (bal === 0n) {
    const funder = mnemonicToAccount(DEMO_MNEMONIC, { accountIndex: 0, addressIndex: 0 });
    const hash = await walletClient.sendTransaction({ account: funder, chain: chainSpec(), to: address, value: 1_500_000_000_000_000_000n });
    await publicClient.waitForTransactionReceipt({ hash });
  }
  return toAccount(address);
}

/** low-level write with an explicit account */
export function walletClientFor() {
  return createWalletClient({ transport: http(state.rpc, { fetchOptions: { headers: ngrokSkipWarn(state.rpc) } }), chain: chainSpec() });
}

export async function writeAs(account, to, abi, fn, args = []) {
  const hash = await clientFor(account).writeContract({ account: signerOf(account), chain: chainSpec(), address: to, abi, functionName: fn, args });
  const rcpt = await publicClient.waitForTransactionReceipt({ hash });
  if (rcpt.status !== 'success') throw new Error(`${fn} reverted (${hash.slice(0, 14)}…)`);
  const events = await decodeLogs(rcpt);
  log(`${fn} → ${short(to)} ok`, 'ok');
  return { hash, rcpt, events };
}

export async function sendAs(account, to, valueEth) {
  const hash = await clientFor(account).sendTransaction({ account: signerOf(account), chain: chainSpec(), to, value: parseUnitsSafe(valueEth) });
  const rcpt = await publicClient.waitForTransactionReceipt({ hash });
  if (rcpt.status !== 'success') throw new Error('transfer reverted');
  return rcpt;
}
export function parseUnitsSafe(s) { return BigInt(Math.round(parseFloat(String(s)) * 1e18)); }

/** canonical Quote tuple encoding — the blinded commitment is keccak of exactly this */
import { encodeAbiParameters } from 'viem';
export const QUOTE_ABI = [{ type: 'tuple', components: [
  { name: 'batchId', type: 'uint256' }, { name: 'solver', type: 'address' },
  { name: 'clearingNav', type: 'uint256' }, { name: 'maxDeposit', type: 'uint256' },
  { name: 'maxRedeem', type: 'uint256' }, { name: 'expiry', type: 'uint64' },
  { name: 'salt', type: 'bytes32' }, { name: 'surplus', type: 'int256' },
] }];
export const encodeQuote = (q) => keccak256(encodeAbiParameters(QUOTE_ABI, [q]));

export async function actAs(id) {
  state.identity = id;
  localStorage.setItem('portal-identity', id);
  return ensureIdentity(id);
}

/** a named identity for a one-off write without switching the console identity */
export const asKey = (index) => mnemonicToAccount(DEMO_MNEMONIC, { accountIndex: 0, addressIndex: index });

// ---- transactions ------------------------------------------------------------

export async function write(id, to, abi, fn, args = []) {
  const account = await (id in IDENTITIES ? ensureIdentity(id) : id.startsWith('0x') ? ensureIdentity(id) : actAs(id));
  const hash = await clientFor(account).writeContract({
    account: signerOf(account), chain: chainSpec(), address: to, abi: abi ?? [], functionName: fn, args: args ?? [],
  });
  const rcpt = await publicClient.waitForTransactionReceipt({ hash });
  if (rcpt.status !== 'success') throw new Error(`${fn} reverted\n${await explainRevert(hash)}`);
  const events = await decodeLogs(rcpt);
  log(`${fn} → ${short(to)} · ${hash.slice(0, 14)}… ok`, 'ok');
  return { hash, rcpt, events };
}

function addrOf(id) { return IDENTITIES[id]?.address ?? id; }

async function explainRevert(hash) {
  try {
    const tx = await publicClient.getTransaction({ hash });
    const data = await publicClient.call({ ...tx, to: tx.from === tx.to ? tx.to : tx.to });
    return 'call reverted';
  } catch { return ''; }
}

export async function read(to, abi, fn, args = []) {
  return publicClient.readContract({ address: to, abi: abi ?? [], functionName: fn, args });
}

export async function readMany(calls) {
  const out = [];
  for (const c of calls) {
    try { out.push(await read(c.to, c.abi, c.fn, c.args)); } catch { out.push(undefined); }
  }
  return out;
}

// ---- time & chain cheats -------------------------------------------------------

export async function advanceTime(seconds, mine = true) {
  await publicClient.request({ method: 'evm_increaseTime', params: [Number(seconds)] });
  if (mine) await publicClient.request({ method: 'evm_mine' });
  await tick();
  log(`time advanced by ${humanDuration(seconds)}`, 'info');
}

export async function mine(n = 1) {
  for (let i = 0; i < n; i++) await publicClient.request({ method: 'evm_mine' });
  await tick();
}

export async function tick() {
  state.block = await publicClient.getBlockNumber();
  const blk = await publicClient.getBlock('latest');
  state.latestTime = Number(blk.timestamp);
  const badge = document.getElementById('chainBadge');
  if (badge) badge.textContent = `chain ${state.chainId}`;
  const info = document.getElementById('blockInfo');
  if (info) info.textContent = `block ${state.block} · ${new Date(state.latestTime * 1000).toLocaleString()}`;
  return state.block;
}

// ---- events --------------------------------------------------------------------

const ABIS = Object.values(ABI);
export async function decodeLogs(rcpt) {
  const out = [];
  for (const log of rcpt.logs) {
    for (const abi of ABIS) {
      try {
        const d = decodeEventLog({ abi, data: log.data, topics: log.topics });
        if (d.eventName) { out.push({ address: log.address, name: d.eventName, args: d.args }); break; }
      } catch { /* not this abi */ }
    }
  }
  return out;
}

export async function logsSince(address, fromBlock, abi) {
  const logs = await publicClient.getLogs({ address, fromBlock: fromBlock ?? 0n, toBlock: 'latest' });
  const out = [];
  for (const log of logs) {
    try { const d = decodeEventLog({ abi, data: log.data, topics: log.topics }); if (d.eventName) out.push({ name: d.eventName, args: d.args, block: log.blockNumber }); } catch { }
  }
  return out;
}

// ---- formatting ---------------------------------------------------------------

export const usd = (e6) => `$${(Number(e6) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
export const eth = (v) => `${formatUnits(v, 18)} ETH`;
export const pct = (bps) => `${(Number(bps) / 100).toFixed(bps % 100 ? 2 : 0)}%`;
export const short = (a) => `${String(a).slice(0, 6)}…${String(a).slice(-4)}`;
export const full = (a) => String(a);
export const ago = (t) => humanDuration(Math.max(0, state.latestTime - Number(t))) + ' ago';
export function humanDuration(s) {
  s = Math.floor(s);
  if (s < 90) return `${s}s`;
  if (s < 82800) return `${Math.floor(s / 3600)}h ${Math.floor(s % 3600 / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor(s % 86400 / 3600)}h`;
}

export function parseUsd(str) {
  const n = parseFloat(str);
  if (!Number.isFinite(n) || n < 0) throw new Error('not an amount');
  return BigInt(Math.round(n * 1e6));
}

// ---- log panel & toast -----------------------------------------------------------

export function log(msg, kind = 'info') {
  const box = document.getElementById('log');
  if (!box) return;
  const line = document.createElement('div');
  line.className = `line t-${kind === 'ok' ? 'ok' : kind === 'err' ? 'err' : 'info'}`;
  line.textContent = `${new Date().toLocaleTimeString()}  ${msg}`;
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
  while (box.childElementCount > 300) box.removeChild(box.firstChild);
}

let toastTimer = null;
export function toast(msg, bad = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast${bad ? ' bad' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), bad ? 7000 : 3500);
  log(msg, bad ? 'err' : 'info');
}

/** run an action with error surfacing — every view button goes through this */
export async function run(label, fn) {
  try { await fn(); toast(label + ' done'); }
  catch (e) {
    const m = String(e?.message || e).split('\n')[0].slice(0, 180);
    toast(`${label}: ${m}`, true);
    log(`${label} FAILED ${String(e?.message || e).slice(0, 400)}`, 'err');
  }
}

// ---- small DOM helpers -------------------------------------------------------------

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (typeof v === 'boolean') { if (v) el[k] = true; } // setAttribute('selected','false') would make EVERY option selected — the browser would then show the last one. Booleans go on the property, and only when true.
    else if (v !== undefined && v !== null) el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid === undefined || kid === null || kid === false) continue;
    el.appendChild(typeof kid === 'string' || typeof kid === 'number' ? document.createTextNode(String(kid)) : kid);
  }
  return el;
}
export const el = (id) => document.getElementById(id);
export function input(type, id, value = '', extra = {}) {
  return h('input', { type, id, value, ...extra });
}
export function field(label, ...els) { return h('div', { class: 'field' }, h('label', {}, label), ...els); }
export function section(title, ...body) { return h('section', { class: 'card' }, h('h2', {}, title), ...body); }
export function kv(rows) { return h('div', { class: 'kv' }, ...rows.flatMap(([k, v]) => [h('b', {}, k), h('span', {}, v)])); }
export function table(headers, rows) {
  return h('table', {},
    h('thead', {}, h('tr', {}, ...headers.map((x) => h('th', { class: x.cls || '' }, x.t ?? x)))),
    h('tbody', {}, ...rows.map((r) => h('tr', {}, ...r.map((c) => h('td', { class: c.cls || '', onclick: c.onclick, style: c.style }, c.t ?? c))))));
}
export const EMPTY = (text) => h('div', { class: 'empty' }, text);

export const keccak = (s) => keccak256(toBytes(s));
export { privateKeyToAccount };
