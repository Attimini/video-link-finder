# Video Link Finder

Chrome extension that finds the real link behind any embedded video: the **player URL** (the iframe) and the **stream URL** (`.m3u8` / `.mpd` / `.mp4`), so you can open the player alone in a new tab or play the stream in a clean page.

## Features

- **Hover button**: move the mouse over a video and a **🔗 Link** button appears; click it to open the side panel.
- **Automatic detection**:
  - **PLAYER**: the iframe that contains the video, including nested iframes
  - **HLS / DASH**: `.m3u8` and `.mpd` streams, detected from network traffic (also when the URL has no extension, by Content-Type)
  - **FILE**: direct `.mp4` / `.webm` videos
- **Open in tab**: opens the player alone and sends the original site's Referer, so most players that block direct opening still load.
- **Play**: built-in HLS player ([hls.js](https://github.com/video-dev/hls.js)) that plays the stream in a clean tab, with the right Referer/Origin.
- **Copy** the link, or a ready-made `yt-dlp` command with the Referer included.
- Badge on the icon with the number of links found. Shortcut: **Alt+Shift+L**.

## Installation

1. Download this repository (**Code → Download ZIP**) and unzip it, or `git clone` it.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the `video-link-finder` folder.
4. Reload the pages that were already open.

Works on Chrome, Edge, Brave and other Chromium browsers.

## Limitations

- Links with expiring tokens stop working after a while.
- Players that check via JavaScript that they are embedded in a specific site won't work standalone. Use the HLS link with **Play** instead.
- DASH (`.mpd`) is not played by the built-in player. Copy it and use VLC or yt-dlp.

## Privacy

Nothing leaves your browser. The extension sends no data anywhere and stores detected links only in session memory, cleared when the tab is closed.

## License

[MIT](LICENSE)
