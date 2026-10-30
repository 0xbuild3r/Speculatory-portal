/**
 * Conviction stake for one thesis: post, top up, withdraw, score the week. The same ConvictionStake calls the
 * console’s Author tab sends. Optional by design — a stake of 0 records the call and ranks it with nothing at risk.
 */
import { api, read, write, state, A, ADDR, h, section, field, input, kv, run, toast, usd, parseUsd, humanDuration, short } from '../core.js';
import { loadThesis, ownerNote, me } from './shared.js';

const MAX = 2n ** 255n;

export async function renderStake(root, vault) {
  const t = await loadThesis(vault);
  const note = ownerNote(t);
  if (note) root.appendChild(note);
  const who = me();
  const [bal, free, next] = await Promise.all([
    read(ADDR.usdc, A.MockUSDC, 'balanceOf', [who]),
    read(ADDR.stake, A.ConvictionStake, 'available', [who]),
    read(ADDR.stake, A.ConvictionStake, 'nextBoundary', [BigInt(state.latestTime)]),
  ]);
  const st = await api(`/v1/funds/${vault}/stake`).catch(() => ({ state: 'none' }));
  const live = st.live ?? {};
  const posted = st.state !== 'none' && st.state !== undefined;

  const amt = input('number', 'stAmt', '500'), band = input('number', 'stBand', '2', { step: '0.1' });
  const rmax = input('number', 'stRmax', '5', { step: '0.5' }), target = input('number', 'stTarget', '4', { step: '0.5' });
  const top = input('number', 'stTop', '100');
  const again = () => { root.replaceChildren(); return renderStake(root, vault); };

  root.appendChild(section(`Conviction stake — ${t.fund.name}`,
    kv([
      ['state', st.state ?? 'none'],
      ['at risk now', st.locked !== undefined ? `${st.locked.toLocaleString()} USDC` : '—'],
      ['posted', st.posted !== undefined ? `${st.posted.toLocaleString()} USDC · band ±${st.bandBps / 100} pt/wk · r_max ${st.rMaxBps / 100}%/wk · target ${st.targetBpsYear / 100}%/yr` : '—'],
      ['burned (slashed so far)', st.forfeited !== undefined ? `${st.forfeited.toLocaleString()} USDC` : '—'],
      ['rewarded', st.rewarded !== undefined ? `${st.rewarded.toLocaleString()} USDC` : '—'],
      ['this week so far', live.excess !== null && live.excess !== undefined ? `${(live.excess * 100).toFixed(2)} pt over the hurdle → ${(live.pendingMove ?? 0) >= 0 ? '+' : ''}${(live.pendingMove ?? 0).toFixed(2)} USDC if scored now` : '—'],
      ['next Sunday boundary', `${new Date(Number(next) * 1000).toUTCString()} (in ${humanDuration(Number(next) - state.latestTime)})`],
      ['USDC in wallet', usd(bal)], ['free in the stake account (carries across theses)', usd(free)],
    ]),
    h('div', { class: 'row' },
      h('button', { id: 'faucet', onclick: (e) => { e.preventDefault(); run('get demo USDC', async () => { await api('/v1/actions/fund', { address: who, usdc: 1000, eth: 0.5 }); await again(); }); } }, 'get 1,000 demo USDC'),
      h('span', { class: 'dim' }, 'the demo faucet — the same one on the Investor tab'))));

  root.appendChild(section(posted ? 'Top up or withdraw' : 'Register the call',
    posted ? h('div', { class: 'row' },
      field('top-up (USDC)', top),
      h('button', { class: 'primary', id: 'topUp', onclick: (e) => { e.preventDefault(); run('top up', async () => {
        await write(state.identity, ADDR.usdc, A.MockUSDC, 'approve', [ADDR.stake, MAX]);
        await write(state.identity, ADDR.stake, A.ConvictionStake, 'topUp', [vault, parseUsd(top.value)]);
        await again();
      }); } }, 'top up'),
      h('button', { id: 'withdraw', onclick: (e) => { e.preventDefault(); run('withdraw', async () => {
        if (free === 0n) throw new Error('nothing free to withdraw');
        await write(state.identity, ADDR.stake, A.ConvictionStake, 'withdraw', [free]);
        await again();
      }); } }, 'withdraw free balance'),
      h('button', { id: 'score', onclick: (e) => { e.preventDefault(); run('score the week', async () => { await write(state.identity, ADDR.stake, A.ConvictionStake, 'tick', [vault]); await again(); }); } }, 'score now (reverts until the boundary)'))
    : h('div', {},
      h('div', { class: 'row' }, field('stake (USDC, 0 = tracked only)', amt), field('band b (pt / week)', band), field('r_max (% / week)', rmax), field('target (% / yr)', target),
        h('button', { class: 'primary', id: 'post', onclick: (e) => { e.preventDefault(); run('post stake', async () => {
          if (Number(amt.value) > 0) await write(state.identity, ADDR.usdc, A.MockUSDC, 'approve', [ADDR.stake, MAX]);
          await write(state.identity, ADDR.stake, A.ConvictionStake, 'post', [vault, parseUsd(amt.value), Math.round(Number(band.value) * 100), Math.round(Number(rmax.value) * 100), Math.round(Number(target.value) * 100)]);
          await again();
        }); } }, 'register the call'))),
    h('p', { class: 'hint' }, 'Each Sunday 00:00 UTC: e = fund − benchmark − target/52; the stake moves by stake × r_max × clip(e / b, −1, +1) and compounds. A slash goes to the reserve; rewards and cover are paid from it. Zero stake is allowed: recorded and ranked, nothing at risk. Limits are the protocol’s (console › Admin › parameters).')));
  void toast; void short;
}
