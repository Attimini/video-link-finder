// Video Link Finder — service worker
// Collects per tab: players (iframes containing a <video>), streams (m3u8 / mpd)
// and direct video files. State lives in storage.session so it survives service
// worker restarts and the panel updates itself.

const STREAM_RE = /\.(m3u8|mpd)(?:[?#;]|$)/i;
const FILE_RE = /\.(mp4|webm|mkv|mov|m4v)(?:[?#;]|$)/i;
const STREAM_CT = /mpegurl|dash\+xml/i;
const VIDEO_CT = /^video\/(?!mp2t|iso\.segment)/i;
const MAX_PER_BUCKET = 40;

const empty = (page = '') => ({ page, players: {}, streams: {}, files: {} });
const skey = (tabId) => 'tab' + tabId;

// --- per-tab state ----------------------------------------------------------

const loading = new Map(); // tabId -> Promise<data>
const timers = new Map();

function load(tabId) {
  if (!loading.has(tabId)) {
    loading.set(
      tabId,
      chrome.storage.session.get(skey(tabId)).then((r) => r[skey(tabId)] || empty())
    );
  }
  return loading.get(tabId);
}

function save(tabId, data) {
  clearTimeout(timers.get(tabId));
  timers.set(
    tabId,
    setTimeout(() => {
      timers.delete(tabId);
      chrome.storage.session.set({ [skey(tabId)]: data });
      updateBadge(tabId, data);
    }, 200)
  );
}

function reset(tabId, page) {
  const data = empty(page);
  loading.set(tabId, Promise.resolve(data));
  save(tabId, data);
}

function updateBadge(tabId, d) {
  const n =
    Object.keys(d.players).length + Object.keys(d.streams).length + Object.keys(d.files).length;
  chrome.action.setBadgeText({ tabId, text: n ? String(n) : '' }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#e10600' }).catch(() => {});
}

// same resource with different query tokens = one entry (keep the latest)
function urlKey(u) {
  try {
    const x = new URL(u);
    return x.origin + x.pathname;
  } catch {
    return u;
  }
}

function put(bucket, key, entry) {
  if (!bucket[key] && Object.keys(bucket).length >= MAX_PER_BUCKET) return false;
  const prev = bucket[key];
  if (prev && prev.url === entry.url && prev.referer === entry.referer) return false;
  bucket[key] = { ...prev, ...entry, t: prev?.t || Date.now() };
  return true;
}

async function getFrame(tabId, frameId) {
  try {
    return await chrome.webNavigation.getFrame({ tabId, frameId });
  } catch {
    return null;
  }
}

// URL of the document that made the request = Referer to reuse
async function refererFor(d, data) {
  if (d.frameId >= 0) {
    const f = await getFrame(d.tabId, d.frameId);
    if (f?.url && /^https?:/.test(f.url)) return f.url;
  }
  if (d.initiator && /^https?:/.test(d.initiator)) return d.initiator + '/';
  return data.page;
}

// --- network: streams and video files----------------------------------------

function fromExtension(d) {
  return d.initiator && d.initiator.startsWith('chrome-extension://');
}

async function addStream(d, kind) {
  const data = await load(d.tabId);
  const referer = await refererFor(d, data);
  if (put(data.streams, urlKey(d.url), { url: d.url, kind, referer })) save(d.tabId, data);
}

async function addFile(d) {
  const data = await load(d.tabId);
  const referer = await refererFor(d, data);
  if (put(data.files, urlKey(d.url), { url: d.url, referer })) save(d.tabId, data);
}

chrome.webRequest.onBeforeRequest.addListener(
  (d) => {
    if (d.tabId < 0 || fromExtension(d)) return;
    const m = d.url.match(STREAM_RE);
    if (m) addStream(d, m[1].toLowerCase() === 'mpd' ? 'DASH' : 'HLS');
    else if (d.type === 'media' && FILE_RE.test(d.url)) addFile(d);
  },
  { urls: ['<all_urls>'], types: ['xmlhttprequest', 'media', 'other'] }
);

// streams without an extension in the URL: detect them by Content-Type
chrome.webRequest.onHeadersReceived.addListener(
  (d) => {
    if (d.tabId < 0 || fromExtension(d) || STREAM_RE.test(d.url)) return;
    const ct = d.responseHeaders?.find((h) => h.name.toLowerCase() === 'content-type')?.value || '';
    if (STREAM_CT.test(ct)) addStream(d, /dash/i.test(ct) ? 'DASH' : 'HLS');
    else if (d.type === 'media' && VIDEO_CT.test(ct) && !FILE_RE.test(d.url)) addFile(d);
  },
  { urls: ['<all_urls>'], types: ['xmlhttprequest', 'media', 'other'] },
  ['responseHeaders']
);

// new page in the tab → start over (SPA navigations don't fire this)
chrome.webNavigation.onCommitted.addListener((d) => {
  if (d.frameId === 0 && !d.url.startsWith(chrome.runtime.getURL(''))) reset(d.tabId, d.url);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  loading.delete(tabId);
  chrome.storage.session.remove(skey(tabId));
  chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [tabId] }).catch(() => {});
});

// --- players: frames that contain a <video> --------------------------------

// Walks up from the video's frame to the first frame with a real http(s) URL
// (about:blank / srcdoc iframes can't be opened on their own).
async function playerFrame(tabId, frameId, frameUrl) {
  let fid = frameId;
  let url = frameUrl;
  while (fid > 0 && !/^https?:/.test(url)) {
    const f = await getFrame(tabId, fid);
    if (!f) return null;
    fid = f.parentFrameId;
    url = (await getFrame(tabId, fid))?.url || '';
  }
  if (fid <= 0) return null; // the video is directly in the page
  const f = await getFrame(tabId, fid);
  const parent = f ? await getFrame(tabId, f.parentFrameId) : null;
  return { url, referer: parent?.url || '', nested: (f?.parentFrameId ?? 0) > 0 };
}

async function onFrameVideo(msg, sender) {
  const tabId = sender.tab?.id;
  if (tabId == null || tabId < 0) return;
  const data = await load(tabId);
  let changed = false;

  const biggest = msg.videos.reduce((a, v) => (v.w * v.h > a.w * a.h ? v : a), { w: 0, h: 0 });

  if (!msg.isTop) {
    const p = await playerFrame(tabId, sender.frameId, msg.frameUrl);
    if (p) changed = put(data.players, p.url, { ...p, w: biggest.w, h: biggest.h }) || changed;
  } else {
    data.topVideo = true;
  }

  for (const v of msg.videos) {
    if (v.src && /^https?:/.test(v.src)) {
      const k = urlKey(v.src);
      if (STREAM_RE.test(v.src)) {
        const kind = /\.mpd/i.test(v.src) ? 'DASH' : 'HLS';
        changed = put(data.streams, k, { url: v.src, kind, referer: msg.frameUrl }) || changed;
      } else {
        changed = put(data.files, k, { url: v.src, referer: msg.frameUrl, w: v.w, h: v.h }) || changed;
      }
    }
  }
  if (changed || msg.isTop) save(tabId, data);
}

// --- Referer: to open players / streams outside the original site ---------

const ALL_TYPES = ['main_frame', 'sub_frame', 'xmlhttprequest', 'media', 'other', 'script', 'image', 'stylesheet', 'font', 'websocket'];

async function setRefererRule(tabId, referer, mode) {
  if (!referer || !/^https?:/.test(referer)) return;
  const requestHeaders = [{ header: 'referer', operation: 'set', value: referer }];
  let resourceTypes;
  if (mode === 'player') {
    // standalone player page: only the navigation must look embedded;
    // the player's own requests keep their natural Referer
    resourceTypes = ['main_frame'];
  } else {
    // built-in player: all stream requests look like they come from the original site
    resourceTypes = ['xmlhttprequest', 'media', 'other'];
    requestHeaders.push({ header: 'origin', operation: 'set', value: new URL(referer).origin });
  }
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [tabId],
    addRules: [
      {
        id: tabId,
        priority: 1,
        action: { type: 'modifyHeaders', requestHeaders },
        condition: { tabIds: [tabId], resourceTypes },
      },
    ],
  });
}

async function openPlayerTab(url, referer, openerTabId) {
  const tab = await chrome.tabs.create({ url: 'about:blank', active: true, openerTabId });
  await setRefererRule(tab.id, referer, 'player');
  await chrome.tabs.update(tab.id, { url });
}

// --- messages --------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  switch (msg?.type) {
    case 'frameVideo':
      onFrameVideo(msg, sender);
      break;
    case 'showPanel':
      if (sender.tab)
        chrome.tabs
          .sendMessage(sender.tab.id, { type: 'togglePanel', tabId: sender.tab.id, open: true }, { frameId: 0 })
          .catch(() => {});
      break;
    case 'openPlayer':
      openPlayerTab(msg.url, msg.referer, msg.tabId).then(() => reply(true), () => reply(false));
      return true;
    case 'prepareStream':
      // sent by player.html before loading the stream
      setRefererRule(sender.tab.id, msg.referer, 'stream').then(() => reply(true), () => reply(false));
      return true;
    case 'clear':
      load(msg.tabId).then((d) => reset(msg.tabId, d.page));
      break;
  }
});
