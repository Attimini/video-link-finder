// Video Link Finder — content script (runs in every frame)
// 1. finds the <video> elements in the frame and reports them to the background
// 2. shows a "Link" button when hovering a video
// 3. in the top frame, opens the side panel on the right

(() => {
  if (window.__vlfLoaded) return;
  window.__vlfLoaded = true;

  const isTop = window === window.top;
  const MIN_W = 200;
  const MIN_H = 110;
  let videos = [];
  let lastSig = '';

  function send(msg) {
    try {
      chrome.runtime.sendMessage(msg).catch(() => {});
    } catch {
      // extension reloaded: this script is orphaned, ignore
    }
  }

  // --- scanning -------------------------------------------------------------

  function findVideos() {
    const list = [...document.querySelectorAll('video')];
    if (!list.length && document.body) {
      // some players live inside web components (open shadow DOM)
      for (const el of document.body.querySelectorAll('*')) {
        if (el.shadowRoot) list.push(...el.shadowRoot.querySelectorAll('video'));
      }
    }
    return list;
  }

  function scan() {
    videos = findVideos();
    const info = videos
      .map((v) => {
        const r = v.getBoundingClientRect();
        return { src: v.currentSrc || v.src || '', w: Math.round(r.width), h: Math.round(r.height) };
      })
      .filter((x) => (x.w >= 150 && x.h >= 80) || (x.src && !x.src.startsWith('blob:')));
    if (!info.length) return;
    const sig = location.href + '|' + info.map((i) => i.src).join('|');
    if (sig === lastSig) return;
    lastSig = sig;
    send({ type: 'frameVideo', isTop, frameUrl: location.href, videos: info });
  }

  let scanT;
  const scanSoon = () => {
    clearTimeout(scanT);
    scanT = setTimeout(scan, 400);
  };

  scan();
  new MutationObserver(scanSoon).observe(document.documentElement, { childList: true, subtree: true });
  for (const ev of ['loadedmetadata', 'play', 'emptied']) document.addEventListener(ev, scanSoon, true);
  setInterval(scan, 5000);

  // --- hover button on videos -------------------------------------------

  let host, btn, hideT;

  function ensureButton() {
    if (host) return;
    host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;top:0;left:0;display:none;';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        button{all:initial;font:600 12px/1 system-ui,-apple-system,Segoe UI,sans-serif;color:#fff;
          background:rgba(20,22,28,.82);border:1px solid rgba(255,255,255,.18);border-radius:7px;
          padding:6px 9px;cursor:pointer;display:flex;align-items:center;gap:5px;
          backdrop-filter:blur(6px);box-shadow:0 2px 10px rgba(0,0,0,.4);transition:background .15s}
        button:hover{background:#e10600;border-color:#e10600}
        svg{width:13px;height:13px}
      </style>
      <button title="Video Link Finder: show player / stream links">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5"/>
          <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5"/>
        </svg>Link
      </button>`;
    btn = root.querySelector('button');
    const stop = (e) => {
      e.stopPropagation();
      e.preventDefault();
    };
    for (const ev of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick']) host.addEventListener(ev, stop);
    host.addEventListener('click', (e) => {
      stop(e);
      lastSig = '';
      scan();
      send({ type: 'showPanel' });
    });
    host.addEventListener('mouseenter', () => clearTimeout(hideT));
    host.addEventListener('mouseleave', scheduleHide);
  }

  function scheduleHide() {
    clearTimeout(hideT);
    hideT = setTimeout(() => {
      if (host) host.style.display = 'none';
    }, 1800);
  }

  function videoAt(x, y) {
    let best = null;
    for (const v of videos) {
      const r = v.getBoundingClientRect();
      if (r.width < MIN_W || r.height < MIN_H) continue;
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        if (!best || r.width * r.height > best.r.width * best.r.height) best = { v, r };
      }
    }
    return best;
  }

  function showButton(r) {
    ensureButton();
    const fs = document.fullscreenElement;
    const parent = fs && fs.tagName !== 'VIDEO' && fs.tagName !== 'IFRAME' ? fs : document.documentElement;
    if (host.parentNode !== parent) parent.appendChild(host);
    host.style.display = 'block';
    const top = Math.max(6, r.top + 10);
    const right = Math.max(6, innerWidth - r.right + 10);
    host.style.top = top + 'px';
    host.style.left = 'auto';
    host.style.right = right + 'px';
    clearTimeout(hideT);
    scheduleHide();
  }

  let moveQueued = false;
  document.addEventListener(
    'mousemove',
    (e) => {
      if (moveQueued) return;
      moveQueued = true;
      requestAnimationFrame(() => {
        moveQueued = false;
        if (!videos.length) return;
        const hit = videoAt(e.clientX, e.clientY);
        if (hit) {
          showButton(hit.r);
        }
      });
    },
    { passive: true, capture: true }
  );

  // --- side panel (top frame only) ---------------------------------------

  if (!isTop) return;

  let panel = null;

  function closePanel() {
    panel?.remove();
    panel = null;
  }

  function openPanel(tabId) {
    if (panel) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    const f = document.createElement('iframe');
    f.src = chrome.runtime.getURL(`panel.html?embed=1&tab=${tabId}`);
    f.allow = 'clipboard-write';
    const css = {
      all: 'initial',
      position: 'fixed',
      top: '12px',
      right: '12px',
      width: 'min(430px, calc(100vw - 24px))',
      height: 'min(620px, calc(100vh - 24px))',
      border: '0',
      'border-radius': '12px',
      'box-shadow': '0 16px 48px rgba(0,0,0,.55)',
      'z-index': '2147483647',
      background: '#14161b',
      'color-scheme': 'normal',
    };
    for (const [k, v] of Object.entries(css)) f.style.setProperty(k, v, 'important');
    document.documentElement.appendChild(f);
    panel = f;
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== 'togglePanel') return;
    if (panel && !msg.open) closePanel();
    else openPanel(msg.tabId);
  });

  window.addEventListener('message', (e) => {
    if (panel && e.source === panel.contentWindow && e.data?.vlf === 'close') closePanel();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel) closePanel();
  });
})();
