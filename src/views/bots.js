/**
 * Bots: the switches and thresholds of the automation that does the Author's chores. Read and write the API only:
 * GET /v1/bots, POST /v1/bots/config. A bot never has a power the console’s buttons do not — turning one off only delays a duty.
 */
import { api, h, section, field, run, toast } from '../core.js';
import { when } from './shared.js';

const BOT = {
  rebalance: { title: 'Rebalance', does: 'keeps each book on the Author’s target weights', fields: [['signalBps', 'act on a weight change of at least (bps)'], ['driftBps', 'act on drift of at least (bps)']] },
  expiry: { title: 'Expiry', does: 'closes a fund at its term end: wind down, final score, book to cash', fields: [['graceSec', 'wait after the term end (seconds)']] },
  falsifier: { title: 'Falsifier watcher', does: 'fires a registered condition when its machine check holds', fields: [['confirmTicks', 'ticks in a row before firing']] },
};

/* A switch, not a button that says ON and leaves the state a guess. Read it first: green, knob right =
 * running; grey, knob left = stopped. Same markup as the console's Automation panel. */
const sw = (id, on, words, fn) => h('button', {
  id, class: `switch ${on ? 'on' : 'off'}`, role: 'switch', 'aria-checked': String(on),
  title: on ? 'running — click to stop it' : 'stopped — click to start it', onclick: (e) => { e.preventDefault(); fn(); },
}, h('span', { class: 'track' }, h('span', { class: 'knob' })), h('span', { class: 'word' }, on ? words[0] : words[1]));

export async function renderBots(root) {
  const s = await api('/v1/bots');
  const again = () => { root.replaceChildren(); return renderBots(root); };
  const save = (patch, label) => run(label, async () => { await api('/v1/bots/config', patch); await again(); });

  root.appendChild(section('Bots',
    h('p', { class: 'hint' }, 'Default ON. Each bot does what a button in the console does, through the same contract calls; the manual button stays available either way. Turning one off delays the duty — it never changes what is allowed.'),
    h('div', { class: 'row' },
      sw('toggle-global', !!s.config.global, ['all bots running', 'all bots stopped'], () => save({ global: !s.config.global }, 'global switch')),
      h('span', { class: 'dim' }, s.external ? 'running as their own process' : 'running inside the API’s keeper'))));

  for (const [name, def] of Object.entries(BOT)) {
    const c = s.config[name];
    const last = s.status?.[name]?.last;
    const inputs = def.fields.map(([k, label]) => {
      const lim = s.limits[`${name}.${k}`] ?? [];
      const inp = h('input', { type: 'number', id: `cfg-${name}-${k}`, value: String(c[k]), min: lim[0], max: lim[1], step: '1', style: 'width:110px' });
      return { k, inp, node: field(`${label}  [${lim[0]}–${lim[1]}]`, inp) };
    });
    root.appendChild(h('section', { class: 'card bot', 'data-bot': name },
      h('h2', {}, def.title),
      h('p', {}, def.does),
      h('div', { class: 'row' },
        sw(`toggle-${name}`, !!c.enabled, ['running', 'stopped'], () => save({ [name]: { enabled: !c.enabled } }, def.title + ' switch')),
        ...inputs.map((i) => i.node),
        h('button', { id: `save-${name}`, onclick: (e) => { e.preventDefault(); save({ [name]: Object.fromEntries(inputs.map((i) => [i.k, Number(i.inp.value)])) }, def.title + ' thresholds'); } }, 'save thresholds')),
      h('div', { class: 'kv' },
        h('b', {}, 'last check'), h('span', { id: `check-${name}` }, s.status?.[name]?.lastCheck ? when(s.status[name].lastCheck) : 'not yet'),
        h('b', {}, 'last action'), h('span', { id: `last-${name}` }, last ? `${last.result} · ${last.action} · ${last.rule}${last.detail ? ' — ' + String(last.detail).slice(0, 100) : ''}` : 'nothing yet'))));
  }
  void toast;
}
