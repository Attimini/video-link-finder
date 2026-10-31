// Built-in player: plays an HLS stream or a video file in a clean tab
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
  e.target.textContent = 'Copied ✓';
  setTimeout(() => (e.target.textContent = 'Copy link'), 1200);
});

async function start() {
  // set the original site's Referer for this tab first, then load
  await chrome.runtime.sendMessage({ type: 'prepareStream', referer: ref });

  const isHls = kind === 'HLS' || /\.m3u8/i.test(src);
  if (isHls && window.Hls?.isSupported()) {
    const hls = new Hls({ enableWorker: false });
    hls.on(Hls.Events.ERROR, (_, d) => {
      if (!d.fatal) return;
      msg.textContent = `Error ${d.type}${d.response?.code ? ' ' + d.response.code : ''}: link expired or protected`;
      if (d.type === Hls.ErrorTypes.NETWORK_ERROR) setTimeout(() => hls.startLoad(), 3000);
      else if (d.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
    });
    hls.loadSource(src);
    hls.attachMedia(video);
  } else {
    video.src = src;
    video.addEventListener('error', () => (msg.textContent = 'Cannot play: link expired or protected'));
  }
  video.play().catch(() => {});
}

start();
