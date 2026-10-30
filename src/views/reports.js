/**
 * Reports: markdown with images, published to the fund's Reports tab on the Live page.
 * Content, not a transaction — no gas, no signature. Images go to the asset store (POST /v1/assets/<slug>) and the
 * markdown links them relatively (assets/x.png); the Live reader resolves those against /v1/assets/<slug>/x.png.
 */
import { api, apiBase, h, section, field, input, run, toast } from '../core.js';
import { loadThesis, ownerNote, when } from './shared.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A deliberately small markdown renderer — enough for a letter: ## heads, lists, **bold**, *italic*, links, images. */
export function renderMd(text, slug) {
  const inline = (s) => esc(s)
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => `<img alt="${alt}" src="${/^(https?:|data:)/.test(src) ? src : `${apiBase()}/v1/${src.replace(/^\.?\//, '').replace(/^assets\//, `assets/${slug}/`)}`}">`)
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\*([^*]+)\*/g, '<i>$1</i>');
  const out = [];
  let list = null;
  for (const block of String(text).replace(/\r/g, '').split(/\n{2,}/)) {
    const ls = block.split('\n');
    if (ls.every((l) => /^\s*[-*] /.test(l))) { out.push('<ul>' + ls.map((l) => `<li>${inline(l.replace(/^\s*[-*] /, ''))}</li>`).join('') + '</ul>'); continue; }
    const m = block.match(/^(#{1,3}) (.*)$/s);
    if (m) { out.push(`<h${m[1].length + 1}>${inline(m[2])}</h${m[1].length + 1}>`); continue; }
    out.push(`<p>${ls.map(inline).join('<br>')}</p>`);
  }
  void list;
  return out.join('\n');
}

const toBase64 = (buf) => { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };

export async function renderReports(root, vault) {
  const t = await loadThesis(vault);
  const note = ownerNote(t);
  if (note) root.appendChild(note);
  const slug = String(t.slug);

  const title = input('text', 'repTitle', '', { size: 36, placeholder: 'Q4 letter' });
  const sub = input('text', 'repSub', '', { size: 56, placeholder: 'what moved, in my own words' });
  const date = input('date', 'repDate', new Date().toISOString().slice(0, 10));
  const body = h('textarea', { id: 'repBody', rows: '14', placeholder: 'Write it like a blog post: blank lines between paragraphs, ## subheads, "- " lists. Add images with the button — they are linked as ![alt](assets/file.png).', style: 'width:100%;font-family:ui-monospace,monospace;font-size:12px;line-height:1.55;padding:10px' });
  const preview = h('div', { id: 'repPreview', class: 'md-preview' });
  const files = h('input', { type: 'file', id: 'repImage', accept: 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml' });
  const list = h('div', { style: 'margin-top:12px' });
  const upl = h('span', { class: 'dim', id: 'uplState' });

  const redraw = () => { preview.innerHTML = renderMd(body.value, slug); };
  body.addEventListener('input', redraw);

  async function addImage() {
    const f = files.files?.[0];
    if (!f) throw new Error('choose an image first');
    const r = await api(`/v1/assets/${slug}`, { name: f.name, data: toBase64(await f.arrayBuffer()) });
    const at = body.selectionStart ?? body.value.length;
    body.value = body.value.slice(0, at) + (at && body.value[at - 1] !== '\n' ? '\n\n' : '') + r.markdown + '\n\n' + body.value.slice(at);
    upl.textContent = `uploaded ${r.name}`;
    files.value = '';
    redraw();
  }

  const listMine = async () => {
    const rows = await api(`/v1/funds/${vault}/reports`).catch(() => []);
    list.replaceChildren(...(rows.length ? rows.map((x) => h('div', { class: 'row report-row' }, h('b', {}, x.title), h('span', { class: 'dim mono' }, x.writtenAt ? when(x.writtenAt).split(',')[0] : ''), h('span', { class: 'dim' }, x.file)))
      : [h('div', { class: 'empty' }, 'no reports on this fund yet')]));
  };

  const publish = async () => {
    if (!title.value.trim()) throw new Error('a report needs a title');
    await api('/v1/actions/report', { vault, title: title.value, subtitle: sub.value, body: body.value, written_at: date.value });
    toast('published — the fund page lists it under Reports');
    body.value = ''; redraw(); await listMine();
  };

  root.appendChild(section(`Write a report — ${t.fund.name}`,
    h('p', { class: 'hint' }, 'Markdown with images. No gas, no signature: the words land on the fund’s Reports tab on the Live page.'),
    h('div', { class: 'row' }, field('title', title), field('subtitle', sub), field('written as of', date)),
    h('div', { class: 'row' }, field('image', files), h('button', { id: 'addImage', onclick: (e) => { e.preventDefault(); run('upload image', addImage); } }, 'upload + insert'), upl),
    h('label', {}, 'body (markdown)'), body,
    h('div', { class: 'row', style: 'margin-top:10px' },
      h('button', { class: 'primary', id: 'publishReport', onclick: (e) => { e.preventDefault(); run('publish report', publish); } }, 'publish the report'))));
  root.appendChild(section('Preview', preview));
  root.appendChild(section('Published', list));
  redraw(); await listMine();
}
