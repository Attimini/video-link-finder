// Riproduttore interno: apre uno stream HLS o un file video in una scheda pulita
const p = new URLSearchParams(location.search);
const src = p.get('src');
const ref = p.get('ref') || '';
const kind = p.get('kind') || '';
const video = document.getElementById('v');
const msg = document.getElementById('msg');

document.getElementById('src').textContent = src;
document.title = new URL(src).host + ' · Player';
document.getElementById('copy').addEventListener('click', async (e) => {
  await navigator.clipboard.writeText(src);
  e.target.textContent = 'Copiato ✓';
  setTimeout(() => (e.target.textContent = 'Copia link'), 1200);
});

async function start() {
  // prima imposto il Referer del sito d'origine per questa scheda, poi carico
  await chrome.runtime.sendMessage({ type: 'prepareStream', referer: ref });

  const isHls = kind === 'HLS' || /\.m3u8/i.test(src);
  if (isHls && window.Hls?.isSupported()) {
    const hls = new Hls({ enableWorker: false });
    hls.on(Hls.Events.ERROR, (_, d) => {
      if (!d.fatal) return;
      msg.textContent = `Errore ${d.type}${d.response?.code ? ' ' + d.response.code : ''}: link scaduto o protetto`;
      if (d.type === Hls.ErrorTypes.NETWORK_ERROR) setTimeout(() => hls.startLoad(), 3000);
      else if (d.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
    });
    hls.loadSource(src);
    hls.attachMedia(video);
  } else {
    video.src = src;
    video.addEventListener('error', () => (msg.textContent = 'Impossibile riprodurre: link scaduto o protetto'));
  }
  video.play().catch(() => {});
}

start();
