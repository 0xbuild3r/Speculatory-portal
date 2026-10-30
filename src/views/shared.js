/**
 * What every screen needs to know about "my theses": which funds are mine, what state they are in,
 * and the registered document behind each. Reads only — the chain and the indexer are the truth.
 */
import { api, read, A, ADDR, state, IDENTITIES, h, short } from '../core.js';

export const me = () => String((IDENTITIES[state.identity] ?? IDENTITIES.authorOne).address).toLowerCase();

export const symbols = () => ({
  [ADDR.usdc]: 'USDC', [ADDR.nvda]: 'NVDA', [ADDR.tsm]: 'TSM', [ADDR.aCash]: 'aCash', [ADDR.susds]: 'sUSDS',
  ...(ADDR.perp ? { [ADDR.perp]: 'NVDA2X' } : {}), ...(ADDR.call ? { [ADDR.call]: 'NVDA150C' } : {}),
});
export const symOf = (addr) => Object.entries(symbols()).find(([a]) => a.toLowerCase() === String(addr).toLowerCase())?.[1] ?? short(addr);

export const ZERO32 = '0x' + '0'.repeat(64);
export const navOf = (f) => Number(f.navPerUnit ?? f.nav?.perUnit ?? 0) / 1e18;
export const when = (secs) => (secs ? new Date(Number(secs) * 1000).toLocaleString() : '—');

export function chip(text, cls = '') { return h('span', { class: `pill ${cls}` }, text); }
export const STATUS_CLASS = { Live: 'ok', 'in review': 'warn', approved: 'ok', rejected: 'bad', falsified: 'bad', closed: '', draft: '' };

/** One fund, everything the author needs on a card. */
export async function fundState(vault, ctx) {
  const [fund, stake, ledger, wound] = await Promise.all([
    api(`/v1/funds/${vault}`),
    api(`/v1/funds/${vault}/stake`).catch(() => ({ state: 'none' })),
    api(`/v1/funds/${vault}/ledger`).catch(() => ({ rules: [], log: [] })),
    read(vault, A.ThesisVault, 'woundDownAt').catch(() => 0n),
  ]);
  const target = ctx.targets.find((t) => t.vault.toLowerCase() === vault.toLowerCase());
  let status = 'Live';
  if (target?.falsified) status = 'falsified';
  else if (stake.state === 'closed' || Number(wound) > 0) status = 'closed';
  const spec = await api(`/v1/specs/${fund.specHash}`).catch(() => ({}));
  // a newer version waiting in the queue: this spec was superseded by a hash the review queue knows
  const next = spec.supersededBy ? ctx.review.find((r) => r.specHash.toLowerCase() === String(spec.supersededBy).toLowerCase()) : null;
  return { vault, fund, stake, ledger, status, spec, next };
}

export async function context() {
  const [targets, review] = await Promise.all([
    api('/v1/bots/targets').then((r) => r.targets).catch(() => []),
    api('/v1/review').catch(() => []),
  ]);
  return { targets, review };
}

/** A thesis for the per-thesis screens: fund, chain spec, registered document. */
export async function loadThesis(vault) {
  const fund = await api(`/v1/funds/${vault}`);
  const specHash = fund.specHash;
  const spec = await read(ADDR.specs, A.ThesisSpecRegistry, 'getSpec', [specHash]);
  const doc = await api(`/v1/specs/${specHash}`).catch(() => ({}));
  const slug = doc.slug ?? vault.slice(2, 10);
  return { vault, fund, specHash, spec, doc, slug, mine: String(spec.creator).toLowerCase() === me() };
}

/** Shown when the acting identity is not the thesis's author: reads work, writes would revert. */
export function ownerNote(t) {
  if (t.mine) return null;
  return h('div', { class: 'card' }, h('p', { class: 'warn' },
    `This fund belongs to ${short(t.spec.creator)}. You are acting as ${short(me())} — switch author in the header; sends from here would be refused by the chain.`));
}
