import { api, h, section, table, EMPTY, short } from '../core.js';
import { me, context, fundState, navOf, chip, when, STATUS_CLASS } from './shared.js';

const draftOf = (vault) => { try { return JSON.parse(localStorage.getItem('portal-draft:' + vault) || 'null'); } catch { return null; } };

export async function renderMine(root) {
  const ctx = await context();
  const funds = await api('/v1/funds');
  const mine = [];
  for (const f of funds) {
    const d = await api(`/v1/funds/${f.address}`);
    if (String(d.creator ?? '').toLowerCase() === me()) mine.push(f.address);
  }
  const states = await Promise.all(mine.map((v) => fundState(v, ctx)));
  const opened = new Set(states.map((s) => s.fund.specHash.toLowerCase()));
  const pending = ctx.review.filter((r) => String(r.author ?? '').toLowerCase() === me() && !opened.has(r.specHash.toLowerCase()));

  root.appendChild(section('My theses',
    h('p', { class: 'hint' }, 'Everything one author does, per thesis. Update changes the weights, signals or falsifier wording as a new version that waits for review while the current one keeps running.')));

  if (!states.length && !pending.length) root.appendChild(EMPTY('No thesis of yours yet — publish one from the console’s Author tab (or the Live page), then come back to run it from here.'));

  for (const s of states) {
    const draft = draftOf(s.vault);
    const statusChips = [chip(s.status, STATUS_CLASS[s.status])];
    if (s.next) statusChips.push(chip(`v2 ${s.next.status === 'submitted' ? 'in review' : s.next.status}`, STATUS_CLASS[s.next.status === 'submitted' ? 'in review' : s.next.status] ?? ''));
    if (draft) statusChips.push(chip('draft saved', ''));
    const st = s.stake;
    const fired = (s.ledger.log ?? []).filter((e) => e.result === 'fired' || e.result === 'done').slice(0, 3);
    root.appendChild(h('section', { class: 'card thesis', 'data-vault': s.vault },
      h('h2', {}, s.fund.name ?? short(s.vault)),
      h('div', { class: 'row' }, ...statusChips, h('span', { class: 'dim mono' }, short(s.vault))),
      h('div', { class: 'kv' },
        h('b', {}, 'NAV / unit'), h('span', { class: 'mono' }, navOf(s.fund).toFixed(4)),
        h('b', {}, 'stake at risk'), h('span', { class: 'mono' }, st.state === 'none' ? 'no stake' : `${(st.locked ?? 0).toLocaleString()} USDC`),
        h('b', {}, 'burned (slashed)'), h('span', { class: 'mono' }, st.state === 'none' ? '—' : `${(st.forfeited ?? 0).toLocaleString()} USDC`),
        h('b', {}, 'fired lately'), h('span', {}, fired.length ? fired.map((e) => `${e.rule}: ${e.action} (${e.bot}) ${e.detail ? '· ' + String(e.detail).slice(0, 70) : ''}`).join(' | ') : 'nothing yet')),
      s.next ? h('p', { class: 'hint' }, `A new version (${short(s.next.specHash)}) is ${s.next.status === 'submitted' ? 'waiting in the review queue' : s.next.status}. This one keeps running until it is approved.`) : null,
      h('div', { class: 'row' },
        h('a', { class: 'btn sm primary', href: `#/t/${s.vault}/edit` }, 'Update'),
        h('a', { class: 'btn sm', href: `#/t/${s.vault}/stake` }, 'Stake'),
        h('a', { class: 'btn sm', href: `#/t/${s.vault}/reports` }, 'Reports'),
        h('a', { class: 'btn sm', href: `#/t/${s.vault}/ledger` }, 'Rule ledger'))));
  }

  if (pending.length) {
    root.appendChild(section('Waiting to go Live',
      table(['thesis', 'spec', 'status', 'submitted'], pending.map((r) => [
        r.title ?? '(untitled)', { t: short(r.specHash), cls: 'mono' },
        { t: r.status === 'submitted' ? 'in review' : r.status, cls: STATUS_CLASS[r.status === 'submitted' ? 'in review' : r.status] ?? '' },
        when(r.submittedAt)])),
      h('p', { class: 'hint' }, 'The console’s Admin tab approves or rejects; nothing is decided here.')));
  }
}
