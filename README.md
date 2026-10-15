# CineWave — API-enabled discovery website

Responsive dark-cinematic movie/TV discovery site with a settings drawer and a small Node.js backend.

## Features
- Live OMDb search (movie, TV, or mixed) and trending TV series.
- Server-side OMDb Bearer token configuration.
- FileList API configuration (username, passkey, optional category IDs) and read-only catalogue search by title/IMDb ID.
- Settings panel with password-free configuration on the private home network, provider connection tests, result limit, provider toggles, cache duration, and cache clearing.
- API response cache with configurable TTL.
- Local browser watchlist.
- Secrets are not returned in `/api/status` and are not embedded in frontend JavaScript.
- Opening a title automatically searches FileList and displays catalogue metadata. Clicking a FileList listing automatically requests its .torrent file server-side, submits it to qBittorrent, saves it under E:\\Torrent, and enables the built-in player when a video file reaches 10% progress.

## Requirements
- Node.js 18 or newer.
- A OMDb API key.
- Your own valid FileList API account credentials if you use that integration.

## Run on Windows
1. Extract the ZIP.
2. Copy `.env.example` to `.env`.
3. Edit `.env` and add your provider credentials. Keep `.env` private.
4. Open PowerShell in the project directory and run:
   ```powershell
   npm install
   npm start
   ```
5. Open `http://localhost:3000`, click **Settings**, enter provider credentials, save, and test each provider. Settings mutations are restricted to loopback/private-network clients; disable public port forwarding.

## Run on Linux
```bash
cp .env.example .env
nano .env
chmod 600 .env
npm install
npm start
```
For production, run behind HTTPS through Nginx/Caddy, configure a firewall, add proper user authentication, and do not expose port 3000 directly. Settings writes and connection tests are restricted by the backend to loopback/private-network client addresses. This is intended for trusted home LAN use, not a publicly exposed service.

## API details
The FileList API format here follows the public `ikevin127/filelist-app` README: GET requests with `username`, `passkey`, `action=search-torrents` or `latest-torrents`, `type=name|imdb`, and JSON output. The tracker may change its API/response format; test with your own account and adjust `pickResults()` if needed.
OMDb uses the official v3 API with the API key in an Authorization Bearer header.

## Important notes
- OMDb requires attribution and its free API is for non-commercial use; obtain permission/licensing for commercial use. The site includes the required notice.
- This app is for metadata discovery and authorized catalogue access. Use sources and media you have the rights to access.
- The browser watchlist is stored in localStorage; **Clear cache** clears server API response cache, not your browser's full HTTP cache or downloaded files.
- Blank secret fields in Settings mean “keep the current secret”; to remove a stored secret, edit `.env` manually and restart the server.


OMDb API key setup: add `OMDB_API_KEY=your_key` to `.env`, or enter the key under Settings & APIs and save. Keep `.env` private. FileList lookup uses the IMDb ID returned by OMDb, such as `tt15239678`. OMDb does not provide trending/popular rankings; use title search.

## Local media storage and playback progress
- The home page shows free/total space for `MEDIA_ROOT` (defaults to `E:\`) and creates `Movie` and `Series` folders there.
- The storage panel lists local video files in those folders.
- Playback position is saved to the local server database and can be restored after selecting the same local file again in the browser. Browsers do not allow a website to reopen an arbitrary local file automatically; the user must reselect it.
- Local subtitle files can be translated with the configured LibreTranslate endpoint. Clicking a FileList listing automatically downloads its .torrent file on the server and adds it to qBittorrent with sequential download enabled. The default destination is E:\\Torrent. Streaming is enabled when a video file reaches 10% progress and a video file is detected. The browser stream can wait for missing pieces; 10% total completion is not a guarantee that every requested byte is already available. FileList listing clicks are wired to the automatic .torrent download route. The route keeps the passkey on the server and never returns the download URL to the browser. Use only media you are authorized to download. Queue endpoints are private-LAN-only; do not expose port 3000 publicly.
- If your media drive is not `E:\`, set `MEDIA_ROOT` in `.env` to a valid folder path, such as `D:\\Media`, then restart the server.

## Authorized torrent queue
- Click a FileList listing to fetch its `.torrent` file automatically and add it to qBittorrent. Optional manual magnet or `.torrent` inputs remain available as fallback.
- The player is unlocked at 10% total torrent progress when a supported video file is detected. WebTorrent streams missing pieces on demand; playback may buffer.
- The queue is held in memory and resets when the server restarts. Downloaded files remain in `MEDIA_ROOT\Movie` or `MEDIA_ROOT\Series`.
- Queue control and stream routes are restricted to localhost/private LAN. This app has no user authentication; keep port 3000 off the public internet.

## qBittorrent Web API setup

- Keep qBittorrent Web UI bound to `127.0.0.1:8080`; do not forward port 8080 on your router.
- Copy `.env.example` to `.env` only if you do not already have `.env`; preserve existing API keys and settings.
- Set `QBITTORRENT_SAVE_PATH=E:\\Torrent`.
- Recommended: turn off “Bypass authentication for clients on localhost” and set `QBITTORRENT_USERNAME` and `QBITTORRENT_PASSWORD` in `.env`. Never put these credentials in browser JavaScript.
- Restart CineWave after editing `.env`. Clicking a FileList result automatically fetches the `.torrent` file and adds it to qBittorrent. Manual magnet and `.torrent` inputs remain optional fallbacks.
- Playback during download is best-effort and depends on file pieces being present and the browser supporting the video codec. The server returns byte-range responses for seeking.
- FileList listing selection remains catalogue-only; add an authorized magnet or `.torrent` file manually.


## Release progress / playback / deletion fixes
- FileList cards are matched against qBittorrent by exact normalized release name; resolution, codec, audio tags, edition, and release-group tokens are preserved.
- Live qBittorrent rows are preferred over local-file shortcuts while the same release is still downloading, so a partial local file does not hide the live progress bar.
- The progress bar remains visible from 0% through 99.9%; the configured threshold only enables Play/Delete and does not hide progress.
- Default playback threshold is 5%. In Settings, keep the threshold at 5% if you want VLC to open as soon as the selected video file reaches 5%.
- Local-media deletion now compares exact release identities rather than movie title/year, avoiding matches to other quality releases. The backend must successfully stop the matching qBittorrent job before deleting.
- VLC/player launching and qBittorrent actions still require a Windows machine with qBittorrent Web UI enabled locally and a valid player executable configured in Settings.
