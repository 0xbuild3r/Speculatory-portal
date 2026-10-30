/**
 * My rule ledger: each rule registered for the thesis (its falsifier, signals, the rebalance policy and the term end),
 * when it was last evaluated, and what executing it did. A rule nobody has evaluated yet says so.
 * Read-only — GET /v1/funds/:a/ledger. The bots (or the console’s manual buttons) write it.
 */
import { api, h, section, short } from '../core.js';
import { loadThesis, chip, when } from './shared.js';

export const NOT_EVALUATED = '未評価 (not evaluated yet)';

const KIND = { falsifier: 'falsifier', signal: 'signal', policy: 'rebalance policy', term: 'term end' };

export async function renderLedger(root, vault) {
  const t = await loadThesis(vault);
  const l = await api(`/v1/funds/${vault}/ledger`);
  root.appendChild(section(`Rule ledger — ${t.fund.name}`,
    h('p', { class: 'hint' }, 'Every rule registered for this thesis, the last time it was checked, and what it caused on-chain. “Not evaluated” means nothing has checked it yet — not that it passed.')));
  for (const r of l.rules) {
    const ev = r.evaluation;
    const state = !r.evaluated ? chip(NOT_EVALUATED, 'warn') : r.fired ? chip('FIRED', 'bad') : chip(ev?.result ?? 'evaluated', ev?.result === 'error' ? 'bad' : 'ok');
    root.appendChild(h('section', { class: 'card rule', 'data-rule': r.id },
      h('h2', {}, `${r.id} · ${KIND[r.kind] ?? r.kind}`),
      h('div', { class: 'row' }, state, r.check ? h('span', { class: 'dim mono' }, `${r.check.feed} ${r.check.op === 'lt' ? '<' : '>'} ${r.check.movePct}% since the watch began`) : null),
      h('p', {}, r.text),
      h('div', { class: 'kv' },
        h('b', {}, 'last evaluated'), h('span', {}, ev ? `${when(ev.at)} · ${ev.bot ?? ''} · ${ev.result}${ev.detail ? ' — ' + ev.detail : ''}` : NOT_EVALUATED),
        r.fired ? h('b', {}, 'fired') : null, r.fired ? h('span', { class: 'mono' }, `block ${r.fired.block ?? '?'} · tx ${short(r.fired.tx ?? '')} · evidence ${short(r.fired.evidenceHash ?? '')}`) : null,
        ev?.tx ? h('b', {}, 'executed by') : null, ev?.tx ? h('span', { class: 'mono' }, `tx ${short(ev.tx)}`) : null),
      r.swaps?.length ? h('p', { class: 'dim' }, `${r.swaps.length} name rotation(s) in the SwapJournal`) : null));
  }
  root.appendChild(section('Executions',
    l.log.length ? h('table', {}, h('thead', {}, h('tr', {}, ...['when', 'rule', 'action', 'by', 'result', 'detail'].map((x) => h('th', {}, x)))),
      h('tbody', {}, ...l.log.map((e) => h('tr', {}, h('td', {}, when(e.at)), h('td', { class: 'mono' }, e.rule), h('td', {}, e.action), h('td', {}, e.bot), h('td', { class: e.result === 'error' ? 'bad' : '' }, e.result), h('td', {}, String(e.detail ?? '').slice(0, 120))))))
      : h('div', { class: 'empty' }, 'no executions yet')));
}
