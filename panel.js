// Panel: used both as the toolbar popup and as the in-page side panel
const params = new URLSearchParams(location.search);
const embed = params.has('embed');
let tabId = Number(params.get('tab')) || null;
const $ = (s) => document.querySelector(s);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function hostOf(u) {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
}

async function copy(text, button) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = el('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  const old = button.textContent;
  button.textContent = 'Copied ✓';
  button.classList.add('ok');
  setTimeout(() => {
    button.textContent = old;
    button.classList.remove('ok');
  }, 1200);
}

function btn(label, onClick, cls = '') {
  const b = el('button', cls, label);
  b.addEventListener('click', () => onClick(b));
  return b;
}

const q = (s) => '"' + s.replace(/"/g, '\\"') + '"';
const ytdlp = (it) => `yt-dlp ${it.referer ? '--referer ' + q(it.referer) + ' ' : ''}${q(it.url)}`;

function playInternal(it, kind) {
  const u = new URL(chrome.runtime.getURL('player.html'));
  u.searchParams.set('src', it.url);
  if (it.referer) u.searchParams.set('ref', it.referer);
  u.searchParams.set('kind', kind);
  chrome.tabs.create({ url: u.href });
}

function card(it, kind) {
  const c = el('div', 'item');
  const meta = el('div', 'meta');
  meta.append(el('span', 'tag ' + kind, kind === 'PLAYER' ? 'PLAYER' : kind), el('span', 'host', hostOf(it.url)));
  if (it.w && it.h) meta.append(el('span', 'dim', `${it.w}×${it.h}`));
  c.append(meta);

  const url = el('div', 'url', it.url);
  url.title = it.url;
  c.append(url);

  if (kind === 'PLAYER' && it.nested) c.append(el('div', 'note', 'Nested iframe: if it does not load, try the stream below.'));

  const b = el('div', 'btns');
  b.append(btn('Copy', (x) => copy(it.url, x), 'primary'));
  if (kind === 'PLAYER') {
    b.append(btn('Open in tab', () => chrome.runtime.sendMessage({ type: 'openPlayer', url: it.url, referer: it.referer, tabId })));
  } else if (kind === 'DASH') {
    b.append(btn('Open', () => chrome.tabs.create({ url: it.url })));
  } else {
    b.append(btn('Play', () => playInternal(it, kind)));
  }
  if (kind !== 'PLAYER') b.append(btn('Copy yt-dlp', (x) => copy(ytdlp(it), x)));
  c.append(b);
  return c;
}

function section(title, items, kindOf) {
  if (!items.length) return null;
  const frag = document.createDocumentFragment();
  const h = el('h2', null, title + ' ');
  h.append(el('span', 'n', String(items.length)));
  frag.append(h);
  for (const it of items) frag.append(card(it, kindOf(it)));
  return frag;
}

async function render(d) {
  if (d === undefined) {
    const r = await chrome.storage.session.get('tab' + tabId);
    d = r['tab' + tabId];
  }
  const list = $('#list');
  list.replaceChildren();
  $('#page').textContent = d?.page ? hostOf(d.page) + ' · ' + d.page : '';

  const byArea = (a, b) => (b.w || 0) * (b.h || 0) - (a.w || 0) * (a.h || 0);
  const players = Object.values(d?.players || {}).sort(byArea);
  const streams = Object.values(d?.streams || {}).sort((a, b) => a.t - b.t);
  const files = Object.values(d?.files || {}).sort(byArea);
  const total = players.length + streams.length + files.length;
  $('#count').textContent = total ? `· ${total}` : '';

  if (!total) {
    const e = el('div', 'empty');
    e.append(el('b', null, 'No video found'));
    e.append(
      document.createTextNode(
        d?.topVideo
          ? 'The video is in the page itself but uses a blob stream. Start playback and the stream will show up here.'
          : 'Start the video and wait a few seconds. If the page was open before the extension was installed, reload it.'
      )
    );
    list.append(e);
    return;
  }

  const parts = [
    section('Player (iframe)', players, () => 'PLAYER'),
    section('Stream', streams, (s) => s.kind),
    section('Video files', files, () => 'FILE'),
  ];
  for (const p of parts) if (p) list.append(p);
}

async function init() {
  if (embed) document.body.classList.add('embed');
  if (!tabId) {
    const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = t?.id;
  }
  $('#close').addEventListener('click', () => (embed ? parent.postMessage({ vlf: 'close' }, '*') : window.close()));
  $('#clear').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'clear', tabId }));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && embed) parent.postMessage({ vlf: 'close' }, '*');
  });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === 'session' && ch['tab' + tabId]) render(ch['tab' + tabId].newValue);
  });
  render();
}

init();
