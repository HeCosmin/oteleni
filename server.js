const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const dotenv = require('dotenv');

dotenv.config();
const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const ENV_PATH = path.join(ROOT, '.env');
const cache = new Map();
// Server-only map of FileList listing IDs to the exact download_link returned by its API.
const filelistDownloadLinks = new Map();
const DATA_DIR = path.join(ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');
fs.mkdirSync(DATA_DIR, { recursive: true });
function readDb() {
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch { return { matchedFiles: [], subtitleCache: {}, playbackProgress: {} }; }
}
function writeDb(db) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, DB_PATH);
}


app.disable('x-powered-by');
app.use(express.json({ limit: '8mb' }));
app.use(express.static(PUBLIC, { etag: true, maxAge: 0, setHeaders(res) { res.setHeader('Cache-Control', 'no-cache'); } }));

function getConfig() {
  return {
    omdbKey: process.env.OMDB_API_KEY || '',
    filelistUsername: process.env.FILELIST_USERNAME || '',
    filelistPasskey: process.env.FILELIST_PASSKEY || '',
    filelistCategories: process.env.FILELIST_CATEGORIES || '',
    language: process.env.OMDB_LANGUAGE || 'en',
    cacheMinutes: clamp(process.env.API_CACHE_MINUTES, 0, 1440, 15),
    resultLimit: clamp(process.env.RESULT_LIMIT, 1, 40, 20),
    useFileList: process.env.ENABLE_FILELIST !== 'false',
    useOmdb: process.env.ENABLE_OMDB !== 'false',
    subtitleLanguage: process.env.SUBTITLE_LANGUAGE || 'ru',
    subtitleSourceLanguage: process.env.SUBTITLE_SOURCE_LANGUAGE || 'auto',
    translateUrl: process.env.LIBRETRANSLATE_URL || '',
    translateApiKey: process.env.LIBRETRANSLATE_API_KEY || '',
    autoTranslateSubs: process.env.ENABLE_SUBTITLE_TRANSLATION !== 'false',
    externalPlayer: process.env.EXTERNAL_PLAYER || 'vlc',
    externalPlayerPath: process.env.EXTERNAL_PLAYER_PATH || '',
    streamQuality: ['480p','720p','1080p','4k','original'].includes(process.env.STREAM_QUALITY) ? process.env.STREAM_QUALITY : '1080p',
    streamThreshold: clamp(process.env.STREAM_THRESHOLD, 5, 20, 5)
  };
}
function clamp(v, min, max, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
function isPrivateAddress(ip) {
  ip = String(ip || '').replace(/^::ffff:/, '').split('%')[0];
  return ip === '127.0.0.1' || ip === '::1' ||
    /^10\./.test(ip) || /^192\.168\./.test(ip) ||
    /^172\.(1[6-9]|2[0-9]|3[01])\./.test(ip) ||
    /^fc[0-9a-f]{2}:/i.test(ip) || /^fd[0-9a-f]{2}:/i.test(ip) ||
    /^fe80:/i.test(ip);
}
function requireLocalNetwork(req, res, next) {
  // Do not trust X-Forwarded-For: only the actual socket peer is checked.
  if (!isPrivateAddress(req.socket.remoteAddress || req.ip)) {
    return res.status(403).json({ error: 'Settings are available only from this PC or your private home network. Disable public port forwarding.' });
  }
  next();
}
function cacheGet(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiresAt) { cache.delete(key); return null; }
  return item.value;
}
function cacheSet(key, value) {
  const minutes = getConfig().cacheMinutes;
  if (minutes <= 0) return;
  cache.set(key, { value, expiresAt: Date.now() + minutes * 60 * 1000 });
  if (cache.size > 300) cache.delete(cache.keys().next().value);
}
async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const r = await fetch(url, { ...options, signal: controller.signal, headers: { Accept: 'application/json', ...(options.headers || {}) } });
    const body = await r.text();
    let data;
    try { data = JSON.parse(body); } catch { data = { raw: body.slice(0, 500) }; }
    if (!r.ok) {
      const msg = data?.message || data?.error || `Provider returned HTTP ${r.status}`;
      const err = new Error(msg); err.status = r.status; throw err;
    }
    return data;
  } finally { clearTimeout(timer); }
}
async function omdbRequest(params = {}, keyOverride) {
  const cfg = getConfig();
  const key = keyOverride || cfg.omdbKey;
  if (!key) throw new Error('OMDb API key is not configured. Add OMDB_API_KEY to .env or Settings.');
  const u = new URL('https://www.omdbapi.com/');
  u.searchParams.set('apikey', key);
  Object.entries(params).forEach(([k,v]) => { if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v); });
  const data = await fetchJson(u);
  if (data.Response === 'False') { const e = new Error(data.Error || 'OMDb request failed.'); e.status = 400; throw e; }
  return data;
}
function normalizeOmdbSearch(x) {
  const type = x.Type === 'series' ? 'tv' : 'movie';
  return { id: x.imdbID || '', imdb_id: x.imdbID || '', title: x.Title || 'Untitled',
    year: String(x.Year || '').split('â€“')[0], type, rating: 'â€”',
    genre: type === 'tv' ? 'TV series' : 'Movie',
    poster: x.Poster && x.Poster !== 'N/A' ? x.Poster : '', backdrop: '', overview: '', source: 'omdb' };
}
function filelistUrl(params, override = {}) {
  const cfg = getConfig();
  const username = override.username || cfg.filelistUsername;
  const passkey = override.passkey || cfg.filelistPasskey;
  if (!username || !passkey) throw new Error('FileList username and passkey are not configured.');
  const u = new URL('https://filelist.io/api.php');
  u.searchParams.set('username', username);
  u.searchParams.set('passkey', passkey);
  Object.entries(params).forEach(([k,v]) => { if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v); });
  if (cfg.filelistCategories && !params.category && !(params.action === 'search-torrents' && params.type === 'imdb')) u.searchParams.set('category', cfg.filelistCategories);
  return u;
}
async function filelistRequest(params, override = {}) {
  const u = filelistUrl(params, override);
  return fetchJson(u);
}
function pickResults(data) {
  if (Array.isArray(data)) return data;
  for (const k of ['data','results','torrents','items','response']) if (Array.isArray(data?.[k])) return data[k];
  return [];
}
function publicStatus() {
  const c = getConfig();
  return { omdbConfigured: Boolean(c.omdbKey), filelistConfigured: Boolean(c.filelistUsername && c.filelistPasskey),
    language: c.language, streamQuality: c.streamQuality, streamThreshold: c.streamThreshold, cacheMinutes: c.cacheMinutes, resultLimit: c.resultLimit, useFileList: c.useFileList, useOmdb: c.useOmdb, subtitleLanguage: c.subtitleLanguage, subtitleSourceLanguage: c.subtitleSourceLanguage, translateUrl: c.translateUrl, autoTranslateSubs: c.autoTranslateSubs, externalPlayer: c.externalPlayer, externalPlayerPath: c.externalPlayerPath };
}
function mediaRoot() {
  // Default Windows target requested by the user; override with MEDIA_ROOT in .env.
  return path.resolve(process.env.MEDIA_ROOT || 'E:\\cinewave-website');
}
function ensureMediaFolders() {
  const root = mediaRoot();
  for (const folder of ['Movie', 'Series', 'Torrent']) fs.mkdirSync(path.join(root, folder), { recursive: true });
  return root;
}
function torrentInputsDir() {
  const dir = path.join(ensureMediaFolders(), 'Torrent');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
app.get('/api/media/status', (_req, res) => {
  try {
    const root = ensureMediaFolders();
    const stat = fs.statfsSync(root);
    const free = Number(stat.bavail) * Number(stat.bsize);
    const total = Number(stat.blocks) * Number(stat.bsize);
    res.json({ ok: true, root, folders: ['Movie', 'Series'], freeBytes: free, totalBytes: total,
      freeGB: Math.round(free / 1073741824 * 10) / 10, totalGB: Math.round(total / 1073741824 * 10) / 10 });
  } catch (e) {
    res.json({ ok: false, root: mediaRoot(), error: e.code === 'ENOENT' ? 'The E: drive is not available. Connect it or set MEDIA_ROOT in .env.' : e.message });
  }
});
app.get('/api/media/list', (_req, res) => {
  try {
    const root = ensureMediaFolders();
    const items = [];
    const walk = (folder, dir, depth=0) => {
      if (depth > 4 || items.length >= 1500) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(folder, full, depth + 1); continue; }
        if (!entry.isFile() || !/\.(mp4|mkv|webm|avi|mov|m4v)$/i.test(entry.name)) continue;
        try { const st = fs.statSync(full); items.push({ name: entry.name, folder, releaseFolder: path.basename(path.dirname(full)), path: full, sizeBytes: st.size, modifiedAt: st.mtime.toISOString() }); } catch {}
      }
    };
    for (const folder of ['Movie', 'Series']) walk(folder, path.join(root, folder));
    res.json({ root, items: items.slice(0, 1500) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/media/item', requireLocalNetwork, async (req, res) => {
  try {
    const folder = String(req.body?.folder || '');
    const name = String(req.body?.name || '');
    const suppliedPath = String(req.body?.mediaPath || '');
    if (!['Movie', 'Series'].includes(folder) || !name || name !== path.basename(name) || !/\.(mp4|mkv|webm|avi|mov|m4v)$/i.test(name)) {
      return res.status(400).json({ error: 'Invalid local media selection.' });
    }
    const root = path.resolve(mediaRoot(), folder);
    const full = path.resolve(suppliedPath || path.join(root, name));
    const rel = path.relative(root, full);
    if (!rel || rel.startsWith('..' + path.sep) || rel === '..' || path.isAbsolute(rel) || path.basename(full) !== name) {
      return res.status(403).json({ error: 'Invalid media path.' });
    }
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      return res.status(404).json({ error: `Media file was not found at ${full}. Refresh the local library and try again.` });
    }

    // A release is stored in Movie/<release-name>/ or Series/<release-name>/.
    // Delete only that one direct child release folder, plus its matching .torrent.
    // Never allow a request to recursively delete the Movie/Series root itself.
    const releaseDir = path.dirname(full);
    const releaseRel = path.relative(root, releaseDir);
    // Stop the exact qBittorrent job before deleting the on-disk release folder.
    try {
      const releaseIdentity = normalizedReleaseIdentity(path.basename(releaseDir));
      const activeRows = await qbitJson('/api/v2/torrents/info');
      for (const q of activeRows.filter(q => normalizedReleaseIdentity(q.name).key === releaseIdentity.key || (q.content_path && path.resolve(q.content_path).toLowerCase() === path.resolve(releaseDir).toLowerCase()))) {
        await qbitRequest('/api/v2/torrents/delete', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ hashes: q.hash, deleteFiles: 'false' }) });
        for (const item of torrentQueue) if (item.hash === q.hash) item.status = 'removed';
      }
    } catch (e) { return res.status(502).json({ error: `Could not stop the matching qBittorrent download; nothing was deleted: ${e.message}` }); }
    const isReleaseFolder = releaseRel && !releaseRel.startsWith('..' + path.sep) &&
      releaseRel !== '..' && !path.isAbsolute(releaseRel) && path.dirname(releaseRel) === '.';
    let deletedReleaseFolder = false;
    if (isReleaseFolder && fs.existsSync(releaseDir) && fs.statSync(releaseDir).isDirectory()) {
      fs.rmSync(releaseDir, { recursive: true, force: true });
      deletedReleaseFolder = true;
    } else {
      fs.unlinkSync(full);
    }

    const torrentDir = torrentInputsDir();
    const releaseName = path.basename(releaseDir);
    const torrentCandidates = [
      path.join(torrentDir, `${releaseName}.torrent`),
      path.join(torrentDir, `${path.basename(name).replace(/\.(mp4|mkv|webm|avi|mov|m4v)$/i, '')}.torrent`)
    ];
    const deletedTorrents = [];
    for (const torrentPath of new Set(torrentCandidates)) {
      if (path.dirname(path.resolve(torrentPath)) === path.resolve(torrentDir) && fs.existsSync(torrentPath) && fs.statSync(torrentPath).isFile()) {
        fs.unlinkSync(torrentPath);
        deletedTorrents.push(path.basename(torrentPath));
      }
    }
    return res.json({
      ok: true,
      message: `Deleted ${deletedReleaseFolder ? 'release folder and its contents' : 'media file'}${deletedTorrents.length ? ' and matching .torrent file(s)' : ''}.`,
      deletedReleaseFolder, deletedTorrents
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});
app.get('/api/progress', (_req, res) => {
  const db = readDb(); res.json({ progress: db.playbackProgress || {} });
});
app.post('/api/progress', (req, res) => {
  const id = String(req.body?.id || '').slice(0, 300);
  const seconds = Number(req.body?.seconds);
  const duration = Number(req.body?.duration);
  if (!id || !Number.isFinite(seconds) || seconds < 0) return res.status(400).json({ error: 'Invalid playback progress.' });
  const db = readDb(); db.playbackProgress ||= {};
  db.playbackProgress[id] = { seconds, duration: Number.isFinite(duration) ? duration : 0, updatedAt: new Date().toISOString(), finished: Number.isFinite(duration) && duration > 0 && seconds >= duration * 0.95 };
  writeDb(db); res.json({ ok: true, progress: db.playbackProgress[id] });
});
app.get('/api/status', (_req,res) => res.json(publicStatus()));

app.post('/api/settings', requireLocalNetwork, (req,res) => {
  const body = req.body || {};
  const current = getConfig();
  const updates = {
    OMDB_API_KEY: String(body.omdbKey || current.omdbKey).trim(),
    FILELIST_USERNAME: String(body.filelistUsername || current.filelistUsername).trim(),
    FILELIST_PASSKEY: String(body.filelistPasskey || current.filelistPasskey).trim(),
    FILELIST_CATEGORIES: String(body.filelistCategories ?? current.filelistCategories).trim(),
    OMDB_LANGUAGE: String(body.language || current.language).trim(),
    API_CACHE_MINUTES: String(clamp(body.cacheMinutes, 0, 1440, current.cacheMinutes)),
    RESULT_LIMIT: String(clamp(body.resultLimit, 1, 40, current.resultLimit)),
    ENABLE_FILELIST: String(body.useFileList !== false),
    ENABLE_OMDB: String(body.useOmdb !== false),
    SUBTITLE_LANGUAGE: String(body.subtitleLanguage || current.subtitleLanguage),
    SUBTITLE_SOURCE_LANGUAGE: String(body.subtitleSourceLanguage || current.subtitleSourceLanguage),
    LIBRETRANSLATE_URL: String(body.translateUrl || current.translateUrl).trim(),
    LIBRETRANSLATE_API_KEY: String(body.translateApiKey || current.translateApiKey).trim(),
    ENABLE_SUBTITLE_TRANSLATION: String(body.autoTranslateSubs !== false),
    EXTERNAL_PLAYER: String(body.externalPlayer || current.externalPlayer || 'vlc'),
    EXTERNAL_PLAYER_PATH: String(body.externalPlayerPath || current.externalPlayerPath || '').trim(),
    STREAM_QUALITY: ['480p','720p','1080p','4k','original'].includes(String(body.streamQuality)) ? String(body.streamQuality) : current.streamQuality,
    STREAM_THRESHOLD: String(clamp(body.streamThreshold, 5, 20, current.streamThreshold))
  };
  // Blank credential fields mean "keep current secret"; clear a credential by editing .env manually.
  const all = { ...process.env, ...updates, ADMIN_PASSWORD: process.env.ADMIN_PASSWORD };
  const content = Object.entries(all)
    .filter(([k]) => ['PORT','ADMIN_PASSWORD', ...Object.keys(updates)].includes(k))
    .map(([k,v]) => `${k}=${JSON.stringify(String(v ?? ''))}`).join('\n') + '\n';
  try {
    fs.writeFileSync(ENV_PATH, content, { mode: 0o600 });
    Object.assign(process.env, updates);
    dotenv.config({ path: ENV_PATH, override: true });
    res.json({ ok: true, message: 'Settings saved to the server .env file (permissions restricted to the owner).' });
  } catch (e) { res.status(500).json({ error: 'Could not save .env: ' + e.message }); }
});

app.post('/api/test', requireLocalNetwork, async (req,res) => {
  try {
    if (req.body.provider === 'omdb') {
      const data = await omdbRequest({ i: 'tt15239678', plot: 'short' }, String(req.body.omdbKey || '').trim() || undefined);
      return res.json({ ok: true, message: `OMDb responded successfully. Test title: ${data.Title || 'available'}.` });
    }
    if (req.body.provider === 'filelist') {
      const data = await filelistRequest({ action: 'latest-torrents', limit: 1, output: 'json' }, {
        username: String(req.body.filelistUsername || '').trim(), passkey: String(req.body.filelistPasskey || '').trim()
      });
      return res.json({ ok: true, message: `FileList API responded. Result rows: ${pickResults(data).length}.` });
    }
    return res.status(400).json({ error: 'Unknown provider.' });
  } catch (e) { return res.status(e.status || 502).json({ error: e.message }); }
});

app.get('/api/search', async (req,res) => {
  const cfg = getConfig();
  if (!cfg.useOmdb) return res.status(400).json({ error: 'OMDb search is disabled in settings.' });
  const q = String(req.query.q || '').trim().slice(0,120);
  if (!q) return res.status(400).json({ error: 'Enter a search query.' });
  const type = ['movie','tv','multi'].includes(req.query.type) ? req.query.type : 'multi';
  const page = clamp(req.query.page, 1, 100, 1);
  const key = `omdb:search:${type}:${q.toLowerCase()}:page:${page}`;
  const cached = cacheGet(key); if (cached) return res.json(cached);
  try {
    const params = { s: q, page };
    if (type === 'movie') params.type = 'movie';
    if (type === 'tv') params.type = 'series';
    const data = await omdbRequest(params);
    const out = { results: (data.Search || []).map(normalizeOmdbSearch), page, totalResults: Number(data.totalResults) || 0, hasMore: page * 10 < (Number(data.totalResults) || 0) };
    cacheSet(key, out); res.json(out);
  } catch (e) {
    if (/not found/i.test(e.message)) return res.json({ results: [] });
    res.status(e.status || 502).json({ error: e.message });
  }
});
app.get('/api/title', async (req,res) => {
  const imdb = String(req.query.imdb || '').trim();
  if (!/^tt\d+$/.test(imdb)) return res.status(400).json({ error: 'A valid IMDb ID is required, e.g. tt15239678.' });
  try {
    const d = await omdbRequest({ i: imdb, plot: 'full' });
    res.json({ id: d.imdbID, imdb_id: d.imdbID, title: d.Title || 'Untitled', year: d.Year || '',
      type: d.Type === 'series' ? 'tv' : 'movie', rating: d.imdbRating && d.imdbRating !== 'N/A' ? d.imdbRating : 'â€”',
      genre: d.Genre && d.Genre !== 'N/A' ? d.Genre : '', poster: d.Poster && d.Poster !== 'N/A' ? d.Poster : '',
      backdrop: '', overview: d.Plot && d.Plot !== 'N/A' ? d.Plot : '', runtime: d.Runtime || '',
      rated: d.Rated || '', director: d.Director || '', actors: d.Actors || '',
      imdb_url: `https://www.imdb.com/title/${d.imdbID}/`, source: 'omdb' });
  } catch(e) { res.status(e.status || 502).json({ error: e.message }); }
});
app.get('/api/popular', async (_req,res) => res.json({ results: [], note: 'OMDb does not provide trending/popular rankings. Search by title instead.' }));
app.get('/api/filelist/search', async (req,res) => {
  const cfg = getConfig();
  if (!cfg.useFileList) return res.status(400).json({ error: 'FileList search is disabled in settings.' });
  const q = String(req.query.q || '').trim().slice(0,120);
  const imdb = String(req.query.imdb || '').trim().slice(0,20);
  if (!imdb) return res.status(400).json({ error: 'A valid IMDb ID is required. Search OMDb first, then search FileList from a title result.' });
  const key = `filelist:${q.toLowerCase()}:${imdb}:${cfg.filelistCategories}`;
  // Always re-query FileList for this endpoint so disappearance grace-period bookkeeping is current.
  try {
    let data;
    if (imdb) {
      if (!/^tt\d+$/.test(imdb)) return res.status(400).json({ error: 'IMDb ID must look like tt22084616.' });
      // Follow FileList's documented IMDb search parameters. Deliberately omit title/name and category filters.
      data = await filelistRequest({ action: 'search-torrents', type: 'imdb', query: imdb });
    }
    const rawResults = pickResults(data).slice(0, cfg.resultLimit);
    // Keep each provider-issued download_link on the server; never expose its passkey to the browser.
    for (const x of rawResults) {
      const listingId = String(x.id ?? '');
      const downloadLink = x.download_link || x.downloadLink || x.torrent_url || x.torrentUrl;
      if (/^\d{1,12}$/.test(listingId) && typeof downloadLink === 'string' && /^https:\/\/filelist\.io\/download\.php\?/i.test(downloadLink)) {
        filelistDownloadLinks.set(listingId, { url: downloadLink.replace(/\\\//g, '/'), savedAt: Date.now(), name: String(x.name || x.title || x.torrent_name || x.filename || `FileList-${listingId}`), category: String(x.category_name || x.category || '') });
      }
    }
    const out = { results: rawResults.map(x => ({
      id: Number.isSafeInteger(Number(x.id)) ? Number(x.id) : null,
      name: x.name || x.title || x.torrent_name || x.filename || 'Untitled listing',
      category: x.category_name || x.category || '',
      size: x.size || x.filesize || x.total_size || '',
      imdb: x.imdb || x.imdb_id || '',
      year: x.year || '',
      seeders: Number.isFinite(Number(x.seeders)) ? Number(x.seeders) : undefined,
      leechers: Number.isFinite(Number(x.leechers)) ? Number(x.leechers) : undefined,
      freeleech: Number(x.freeleech) === 1,
      uploadDate: x.upload_date || '',
      completed: Number.isFinite(Number(x.times_completed)) ? Number(x.times_completed) : undefined,
      files: Number.isFinite(Number(x.files)) ? Number(x.files) : undefined,
      description: x.small_description || '',
      // Do not forward passkeys, download URLs, magnet links, or arbitrary provider fields to the browser.
    })) };
    // Persist matched catalogue rows. If a row disappears on a later search for the same query,
    // retain it for a 10-minute grace period before pruning it from the local database.
    const db = readDb();
    const now = Date.now();
    const qKey = (imdb || q).toLowerCase().trim();
    const foundKeys = new Set(out.results.map(x => `${qKey}|${String(x.name).toLowerCase()}`));
    for (const row of db.matchedFiles) {
      if (row.queryKey !== qKey) continue;
      const rowKey = `${qKey}|${String(row.name).toLowerCase()}`;
      if (foundKeys.has(rowKey)) { row.lastSeenAt = now; row.missingSince = null; }
      else if (!row.missingSince) row.missingSince = now;
    }
    for (const item of out.results) {
      const rowKey = `${qKey}|${String(item.name).toLowerCase()}`;
      let row = db.matchedFiles.find(r => `${r.queryKey}|${String(r.name).toLowerCase()}` === rowKey);
      if (!row) { row = { id: crypto.randomUUID(), queryKey: qKey, titleQuery: q, name: item.name, category: item.category, size: item.size, imdb: item.imdb, year: item.year, firstMatchedAt: now }; db.matchedFiles.push(row); }
      Object.assign(row, { category: item.category, size: item.size, imdb: item.imdb, year: item.year, lastSeenAt: now, missingSince: null, status: 'matched' });
    }
    db.matchedFiles = db.matchedFiles.filter(r => !r.missingSince || now - r.missingSince < 10 * 60 * 1000);
    writeDb(db);
    res.json(out);
  } catch(e) { res.status(e.status || 502).json({ error: e.message }); }
});
app.get('/api/filelist/matches', (_req,res) => {
  const db = readDb();
  const now = Date.now();
  const rows = db.matchedFiles.filter(r => !r.missingSince || now - r.missingSince < 10 * 60 * 1000)
    .sort((a,b) => (b.lastSeenAt || b.firstMatchedAt || 0) - (a.lastSeenAt || a.firstMatchedAt || 0))
    .map(r => ({ id: r.id, titleQuery: r.titleQuery, name: r.name, category: r.category, size: r.size, imdb: r.imdb, year: r.year, status: r.missingSince ? 'missing-grace-period' : 'matched', firstMatchedAt: r.firstMatchedAt, lastSeenAt: r.lastSeenAt, missingSince: r.missingSince }));
  res.json({ results: rows });
});
app.post('/api/subtitles/translate', async (req,res) => {
  const cfg = getConfig();
  if (!cfg.autoTranslateSubs) return res.status(400).json({ error: 'Subtitle translation is disabled in Settings.' });
  const text = String(req.body?.text || '');
  if (!text || text.length > 1_000_000) return res.status(400).json({ error: 'Provide a subtitle file under 1 MB.' });
  if (!/\.(srt|vtt)$/i.test(String(req.body?.filename || 'subtitle.srt'))) return res.status(400).json({ error: 'Only .srt and .vtt subtitle files are supported.' });
  if (!cfg.translateUrl) return res.status(400).json({ error: 'Configure a LibreTranslate-compatible endpoint in Settings first.' });
  let endpoint;
  try { endpoint = new URL(cfg.translateUrl); } catch { return res.status(400).json({ error: 'Translation endpoint URL is invalid.' }); }
  if (!['https:','http:'].includes(endpoint.protocol)) return res.status(400).json({ error: 'Translation endpoint must use HTTP or HTTPS.' });
  const target = String(req.body?.targetLanguage || cfg.subtitleLanguage);
  const source = String(req.body?.sourceLanguage || cfg.subtitleSourceLanguage || 'auto');
  if (!/^[a-z]{2,3}(-[A-Z]{2})?$/.test(target) || !(source === 'auto' || /^[a-z]{2,3}(-[A-Z]{2})?$/.test(source))) return res.status(400).json({ error: 'Unsupported language code.' });
  const db = readDb();
  const cacheKey = crypto.createHash('sha256').update(`${endpoint.origin}${endpoint.pathname}|${source}|${target}|${text}`).digest('hex');
  if (db.subtitleCache[cacheKey]) return res.json({ translatedText: db.subtitleCache[cacheKey], cues: countSubtitleCues(text), cached: true });
  try {
    const blocks = text.split(/\r?\n\s*\r?\n/);
    const out = [];
    let cueCount = 0;
    for (const block of blocks) {
      const lines = block.split(/\r?\n/);
      const timingIndex = lines.findIndex(line => /\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,.]\d{3}/.test(line));
      if (timingIndex < 0) { out.push(block); continue; }
      const textStart = timingIndex + 1;
      const cueText = lines.slice(textStart).join('\n').trim();
      cueCount++;
      if (!cueText) { out.push(block); continue; }
      const body = { q: cueText, source, target, format: 'text' };
      if (cfg.translateApiKey) body.api_key = cfg.translateApiKey;
      const translated = await fetchJson(new URL('/translate', endpoint).toString(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!translated.translatedText) throw new Error('Translation provider returned no translatedText.');
      lines.splice(textStart, lines.length - textStart, ...String(translated.translatedText).split('\n'));
      out.push(lines.join('\n'));
      if (cueCount > 500) throw new Error('Subtitle contains more than 500 cues; split the file into smaller parts.');
    }
    const translatedText = out.join('\n\n');
    db.subtitleCache[cacheKey] = translatedText;
    writeDb(db);
    res.json({ translatedText, cues: cueCount, cached: false });
  } catch(e) { res.status(e.status || 502).json({ error: `Subtitle translation failed: ${e.message}` }); }
});
function countSubtitleCues(text) { return (String(text).match(/\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->/g) || []).length; }
app.post('/api/cache/clear', (_req,res) => { cache.clear(); res.json({ ok: true, message: 'Server API cache cleared. Browser watchlist was kept unless you choose to clear it.' }); });

function openInConfiguredPlayer(full, res) {
  if (process.platform !== 'win32') return res.status(501).json({ error: 'External player launching is supported on Windows only.' });
  const cfg = getConfig();
  const defaults = { vlc: 'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe', potplayer: 'C:\\Program Files\\DAUM\\PotPlayer\\PotPlayerMini64.exe', mpv: 'C:\\Program Files\\mpv\\mpv.exe' };
  const player = String(cfg.externalPlayer || 'vlc');
  const executable = cfg.externalPlayerPath || defaults[player];
  if (player === 'default' && !cfg.externalPlayerPath) {
    const child = spawn('cmd.exe', ['/d', '/s', '/c', 'start', '""', full], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref(); return res.json({ ok: true, message: 'Opened with the Windows default player.', filePath: full });
  }
  if (!['vlc','potplayer','mpv'].includes(player) && !cfg.externalPlayerPath) return res.status(400).json({ error: 'Choose VLC, PotPlayer, mpv, or Windows default player in Settings.' });
  if (!executable || !fs.existsSync(executable)) return res.status(400).json({ error: `Player executable not found: ${executable || player}. Set the full executable path in Settings.` });
  // Keep VLC on the primary display and reuse its existing window instead of spawning a new instance per launch.
  // VLC's video position/size flags override stale off-screen coordinates saved in its preferences.
  let playerArgs = [full];
  if (player === 'vlc') playerArgs = ['--one-instance', '--video-x=0', '--video-y=0', '--width=1280', '--height=720', full];
  else if (player === 'mpv') playerArgs = ['--geometry=1280x720+0+0', '--force-window=yes', full];
  else if (player === 'potplayer') playerArgs = ['/current', full];
  const child = spawn(executable, playerArgs, { detached: true, stdio: 'ignore', windowsHide: false });
  child.on('error', err => console.error('External player launch failed:', err.message)); child.unref();
  // VLC may restore an old off-screen/minimized window despite --video-x/--video-y.
  // Ask Windows to restore and move the existing player window onto the primary display.
  if (player === 'vlc' || player === 'potplayer') {
    const helper = path.join(__dirname, 'scripts', 'bring-player-onscreen.ps1');
    const procName = player === 'vlc' ? 'vlc' : 'PotPlayerMini64';
    const fix = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', helper, '-ProcessName', procName], { detached: true, stdio: 'ignore', windowsHide: true });
    fix.on('error', err => console.error('Player window positioning helper failed:', err.message)); fix.unref();
  }
  return res.json({ ok: true, message: `Opened in ${player}.`, filePath: full });
}
app.post('/api/player/open', requireLocalNetwork, (req, res) => {
  const requested = String(req.body?.filePath || '').trim();
  if (!requested) return res.status(400).json({ error: 'A media file path is required.' });
  const full = path.resolve(requested), root = path.resolve(mediaRoot());
  if (full.toLowerCase() !== root.toLowerCase() && !full.toLowerCase().startsWith(root.toLowerCase() + path.sep.toLowerCase())) return res.status(403).json({ error: 'Only files under the configured media drive can be opened.' });
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return res.status(404).json({ error: 'Media file not found.' });
  return openInConfiguredPlayer(full, res);
});
app.post('/api/torrents/:id/open', requireLocalNetwork, async (req, res) => {
  if (process.platform !== 'win32') return res.status(501).json({ error: 'External player launching is supported on Windows only.' });
  const item = torrentQueue.find(x => x.id === req.params.id && x.status !== 'removed');
  if (!item?.hash) return res.status(404).json({ error: 'Torrent is not available in qBittorrent yet.' });
  try {
    const q = (await qbitJson('/api/v2/torrents/info?hashes=' + encodeURIComponent(item.hash)))[0];
    const files = await qbitJson('/api/v2/torrents/files?hash=' + encodeURIComponent(item.hash));
    if (!q) return res.status(404).json({ error: 'Torrent was not found in qBittorrent.' });
    const playbackThreshold = getConfig().streamThreshold / 100;
    const f = files.find(x => /\.(mp4|mkv|webm|avi|mov|m4v)$/i.test(x.name));
    if (!f) return res.status(409).json({ error: 'No supported video file has been identified in this torrent yet.' });
    if (Number(f.progress) < playbackThreshold) return res.status(409).json({ error: `The video file itself has downloaded ${Math.floor(Number(f.progress) * 100)}%; playback unlocks when that video reaches ${getConfig().streamThreshold}%.` });
    const contentPath = path.resolve(q.content_path || path.join(q.save_path, q.name));
    const contentIsFile = fs.existsSync(contentPath) && fs.statSync(contentPath).isFile();
    const root = contentIsFile ? path.dirname(contentPath) : contentPath;
    // qBittorrent's files endpoint returns a relative path including any internal
    // folders. Keep that path (not just the basename) when resolving the video.
    const relativeVideoPath = String(f.path || f.name || '').replace(/[\\/]+/g, path.sep);
    const full = contentIsFile ? contentPath : path.resolve(root, relativeVideoPath);
    if (full !== root && !full.toLowerCase().startsWith((root + path.sep).toLowerCase())) return res.status(403).json({ error: 'Invalid torrent media path.' });
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return res.status(409).json({ error: 'The video file has not been created on disk yet. Try again in a moment.' });
    return openInConfiguredPlayer(full, res);
  } catch (e) { return res.status(502).json({ error: 'Could not open video in external player: ' + e.message }); }
});

app.get('/api/health', (_req,res) => res.json({ ok: true, uptimeSeconds: Math.round(process.uptime()) }));

// qBittorrent Web API integration (local-only control API).
const torrentQueue = [];
const QBIT_BASE = String(process.env.QBITTORRENT_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '');
const QBIT_SAVE_PATH = process.env.QBITTORRENT_SAVE_PATH || path.join(mediaRoot(), 'Torrent');
const QBIT_USERNAME = process.env.QBITTORRENT_USERNAME || '';
const QBIT_PASSWORD = process.env.QBITTORRENT_PASSWORD || '';
let qbitCookies = '';
let qbitAuthed = false;
let qbitLoginPromise = null;

function safeMediaTitle(value) {
  return String(value || 'Untitled media').replace(/[<>:"'/\\|?*`\x00-\x1f]/g, ' ').replace(/[. ]+$/g, '').trim().slice(0,150) || 'Untitled media';
}
function saveCookies(r) {
  const all = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [r.headers.get('set-cookie') || ''];
  for (const c of all) { const first=c.split(';')[0]; if(first.includes('=')){ const pair=first.split('='); qbitCookies += (qbitCookies?'; ':'')+pair[0]+'='+pair.slice(1).join('='); } }
}
async function qbitRequest(apiPath, options={}) {
  if (QBIT_USERNAME && QBIT_PASSWORD && !qbitAuthed && apiPath !== '/api/v2/auth/login') {
    if (!qbitLoginPromise) qbitLoginPromise=(async()=>{
      const r=await fetch(QBIT_BASE+'/api/v2/auth/login',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({username:QBIT_USERNAME,password:QBIT_PASSWORD}),signal:AbortSignal.timeout(10000)});
      saveCookies(r); const t=await r.text();
      if(!r.ok || !/^Ok\\.?$/.test(t.trim())) throw new Error('qBittorrent login failed; check Web UI credentials.');
      qbitAuthed=true;
    })().finally(()=>qbitLoginPromise=null);
    await qbitLoginPromise;
  }
  const headers=new Headers(options.headers||{}); if(qbitCookies)headers.set('Cookie',qbitCookies);
  const r=await fetch(QBIT_BASE+apiPath,{...options,headers,signal:options.signal||AbortSignal.timeout(20000)});
  saveCookies(r);
  if(r.status===403 && QBIT_USERNAME && QBIT_PASSWORD){qbitAuthed=false;qbitCookies='';throw new Error('qBittorrent rejected the session. Check Web UI authentication settings and credentials.');}
  if(!r.ok)throw new Error(`qBittorrent API HTTP ${r.status} (${apiPath})`);
  return r;
}
async function qbitJson(p){return (await qbitRequest(p)).json();}
function qbitState(q){if(['error','missingFiles'].includes(q.state))return 'error';if(['pausedDL','pausedUP'].includes(q.state))return 'paused';if(['queuedDL','metaDL','checkingDL','allocating'].includes(q.state))return 'queued';return Number(q.progress)>=1?'complete':'downloading';}
function normalizeMediaMatch(value) {
 // Exact release identity: preserve resolution, codec, audio tags, edition and release group.
 // Only remove a known file extension and normalize punctuation/case/whitespace.
 return String(value || '').split(/[\\/]/).pop().trim()
  .replace(/\.(mkv|mp4|avi|mov|wmv|webm|m4v|torrent|srt|vtt)$/i, '')
  .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
function findLocalMediaMatch(title) {
 try {
  const root=ensureMediaFolders(), target=normalizeMediaMatch(title);
  if(!target)return null;
  for(const folder of ['Movie','Series']){
   const stack=[{dir:path.join(root,folder),depth:0}];
   while(stack.length){const {dir,depth}=stack.pop();if(depth>4)continue;
    for(const ent of fs.readdirSync(dir,{withFileTypes:true})){
     const full=path.join(dir,ent.name);
     if(ent.isDirectory()){stack.push({dir:full,depth:depth+1});continue;}
     if(!ent.isFile()||!/\.(mkv|mp4|webm|avi|mov|m4v)$/i.test(ent.name))continue;
     const candidate=normalizeMediaMatch(ent.name);
     if(candidate===target)return {path:full,folder,name:ent.name};
    }
   }
  }
 } catch {}
 return null;
}
function publicTorrentItem(item){
 const q=item.q||{}, files=item.files||[], v=files.find(f=>f.isVideo), progress=v ? Number(v.progress)||0 : Number(q.progress)||0;
 const localMatch=findLocalMediaMatch(item.title||q.name);
 return {id:item.id,title:item.title||q.name||'Torrent',folder:item.folder||'Torrent',status:item.status,
 progress:Math.round(progress*1000)/10,downloadedBytes:Number(q.downloaded)||0,totalBytes:Number(q.total_size)||files.reduce((n,f)=>n+f.length,0),
 downloadSpeed:Number(q.dlspeed)||0,uploadSpeed:Number(q.upspeed)||0,numPeers:(Number(q.num_seeds)||0)+(Number(q.num_leechs)||0),error:item.error||'',files,
 localPath:localMatch?.path||null,localFolder:localMatch?.folder||null,localName:localMatch?.name||null,
 videoFileIndex:v?v.index:null,playable:Boolean(v&&Number(v.progress)>=(getConfig().streamThreshold/100)),streamUrl:v?`/api/torrents/${encodeURIComponent(item.id)}/stream/${v.index}`:null};
}
async function readQbitFiles(hash){const fs=await qbitJson('/api/v2/torrents/files?hash='+encodeURIComponent(hash));return fs.map((f,index)=>({index,name:f.name.split(/[\\/]/).pop(),path:f.name,length:Number(f.size)||0,progress:Number(f.progress)||0,isVideo:/\.(mp4|mkv|webm|avi|mov|m4v)$/i.test(f.name)}));}
app.get('/api/torrents',requireLocalNetwork,async(_req,res)=>{
 try{
  const rows=await qbitJson('/api/v2/torrents/info');
  for(const q of rows){let it=torrentQueue.find(x=>x.hash===q.hash);if(!it){it={id:crypto.randomUUID(),hash:q.hash,title:q.name,folder:'Torrent',status:qbitState(q),error:'',files:[],q};torrentQueue.push(it);}
   it.q=q;it.title=q.name;it.status=qbitState(q);it.error=['error','missingFiles'].includes(q.state)?`qBittorrent state: ${q.state}`:'';
   try{it.files=await readQbitFiles(q.hash)}catch{}
  }
  const active=new Set(rows.map(q=>q.hash));for(const it of torrentQueue)if(it.hash&&!active.has(it.hash))it.status='removed';
  const items=torrentQueue.filter(x=>x.status!=='removed').map(publicTorrentItem);
  // Make local videos visible in the same queue, with a working external-player action.
  const seenLocal=new Set(items.filter(x=>x.localPath).map(x=>path.resolve(x.localPath).toLowerCase()));
  try {
   const root=ensureMediaFolders();
   for(const folder of ['Movie','Series']) {
    const stack=[{dir:path.join(root,folder),depth:0}];
    while(stack.length) { const {dir,depth}=stack.pop(); if(depth>4) continue;
     for(const ent of fs.readdirSync(dir,{withFileTypes:true})) {
      const full=path.join(dir,ent.name);
      if(ent.isDirectory()){stack.push({dir:full,depth:depth+1});continue;}
      if(!ent.isFile()||!/\.(mkv|mp4|webm|avi|mov|m4v)$/i.test(ent.name))continue;
      const key=path.resolve(full).toLowerCase(); if(seenLocal.has(key))continue; seenLocal.add(key);
      const size=fs.statSync(full).size;
      items.push({id:'local:'+Buffer.from(key).toString('base64url'),title:ent.name.replace(/\.(mkv|mp4|webm|avi|mov|m4v)$/i,''),folder,status:'complete',progress:100,downloadedBytes:size,totalBytes:size,downloadSpeed:0,uploadSpeed:0,numPeers:0,error:'',files:[],localPath:full,localFolder:folder,localName:ent.name,videoFileIndex:null,playable:true,streamUrl:null,isLocal:true});
     }
    }
   }
  } catch(e) { console.warn('Could not add local media to queue:',e.message); }
  res.json({items,sequential:true,playThreshold:getConfig().streamThreshold,streamQuality:getConfig().streamQuality,engine:'qBittorrent'});
 }catch(e){res.status(502).json({error:`Cannot reach qBittorrent at ${QBIT_BASE}. Open qBittorrent and enable its local Web UI. ${e.message}`});}
});

// Derive the local .torrent filename from an already-downloaded Movie/Series file.
// Example: local Interstellar.2014.BDRip.X264.RoSubbed-playSD.mkv wins over
// a FileList listing named Interstellar.2014.BDRip.DD5.1.x264.RoSubbed-playSD.
function normalizedReleaseIdentity(value) {
  // Exact release identity shared by the FileList card, qBittorrent job,
  // media-folder name, video filename and .torrent filename.
  const key = String(value || '').split(/[\\/]/).pop().trim()
    .replace(/\.(mkv|mp4|avi|mov|wmv|webm|m4v|torrent|srt|vtt)$/i, '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  return { title: key, year: '', key };
}
function localTorrentFilename(listingName, listingId) {
  try {
    const root = ensureMediaFolders();
    const wanted = normalizedReleaseIdentity(listingName);
    if (wanted.key) {
      for (const folder of ['Movie', 'Series']) {
        const baseDir = path.join(root, folder);
        const stack = [{ dir: baseDir, depth: 0 }];
        while (stack.length) {
          const { dir, depth } = stack.pop();
          if (depth > 5) continue;
          let entries;
          try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
          for (const ent of entries) {
            const full = path.join(dir, ent.name);
            if (ent.isDirectory()) { stack.push({ dir: full, depth: depth + 1 }); continue; }
            if (!ent.isFile() || !/\.(mkv|mp4|webm|avi|mov|m4v)$/i.test(ent.name)) continue;
            const local = normalizedReleaseIdentity(ent.name);
            if (local.key === wanted.key) {
              // Use the actual on-disk media basename; never use the API release name.
              return path.basename(ent.name).replace(/\.(mkv|mp4|webm|avi|mov|m4v)$/i, '') + '.torrent';
            }
          }
        }
      }
    }
  } catch (e) { console.warn('Local media filename detection failed:', e.message); }
  // No local match: preserve the listing name only as a fallback.
  const safe = path.basename(String(listingName || `FileList-${listingId}`)).replace(/\.torrent$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
  return `${safe || `FileList-${listingId}`}.torrent`;
}

// One click on a FileList result: fetch its .torrent server-side and add it to qBittorrent.
app.post('/api/filelist/download/:id', requireLocalNetwork, async (req, res) => {
  const cfg = getConfig();
  const id = String(req.params.id || '');
  if (!/^\d{1,12}$/.test(id)) return res.status(400).json({ error: 'Invalid FileList listing ID.' });
  if (!cfg.filelistUsername || !cfg.filelistPasskey) return res.status(400).json({ error: 'Configure FileList username and passkey in Settings first.' });
  try {
    // Keep the passkey on the server. Never return this URL to browser JavaScript.
    const cachedLink = filelistDownloadLinks.get(id);
    // Prefer the exact download_link supplied by search-torrents; fallback is useful after a server restart.
    const u = cachedLink && Date.now() - cachedLink.savedAt < 30 * 60 * 1000
      ? new URL(cachedLink.url)
      : new URL('https://filelist.io/download.php');
    if (!cachedLink || Date.now() - cachedLink.savedAt >= 30 * 60 * 1000) {
      u.searchParams.set('id', id);
      u.searchParams.set('passkey', cfg.filelistPasskey);
    }
    if (u.hostname !== 'filelist.io' || u.pathname !== '/download.php' || u.searchParams.get('id') !== id) throw new Error('FileList returned an unexpected download URL for this listing.');
    const response = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'CineWave/1.0', 'Accept': 'application/x-bittorrent, application/octet-stream' } });
    if (!response.ok) throw new Error(`FileList returned HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 20 || bytes.length > 5 * 1024 * 1024) throw new Error('FileList response is not a valid-size .torrent file (max 5 MB).');
    // Bencoded torrent files normally begin with "d"; HTML/login/error pages must not be uploaded.
    if (bytes[0] !== 0x64) throw new Error(`FileList did not return a .torrent file (content type: ${contentType || 'unknown'}). Check the FileList passkey and account access.`);
    const beforeRows = await qbitJson('/api/v2/torrents/info');
    const beforeHashes = new Set(beforeRows.map(row => row.hash));
    const requestedListingName = String(req.body?.listingName || '').slice(0, 300).trim();
    const listingName = requestedListingName || cachedLink?.name || `FileList-${id}`;
    const localMatch = findLocalMediaMatch(listingName);
    // If this release already exists locally, name the .torrent after the actual
    // media file, not after FileList's slightly different release string.
    const torrentFilename = localMatch
      ? path.basename(localMatch.name).replace(/\.(mkv|mp4|webm|avi|mov|m4v)$/i, '') + '.torrent'
      : localTorrentFilename(listingName, id);
    const requestedCategory = String(req.body?.category || cachedLink?.category || '').toLowerCase();
    const mediaFolder = localMatch?.folder || (/series|tv|episode|season/.test(requestedCategory) ? 'Series' : 'Movie');
    const releaseFolder = safeMediaTitle(listingName);
    const mediaDestination = localMatch ? path.dirname(localMatch.path) : path.join(mediaRoot(), mediaFolder, releaseFolder);
    if (!localMatch) fs.mkdirSync(mediaDestination, { recursive: true });
    const torrentPath = path.join(torrentInputsDir(), torrentFilename);
    fs.writeFileSync(torrentPath, bytes, { mode: 0o600 });
    // A matching local video is authoritative: save the correctly named torrent
    // for it, but do not create a second qBittorrent download of the same movie.
    if (localMatch) {
      return res.status(200).json({
        ok: true, alreadyPresent: true,
        message: `Matching video already exists: ${localMatch.path}. Saved its matching torrent as ${torrentFilename} in ${torrentInputsDir()}; no duplicate download was added.`,
        torrentFilename, torrentPath, mediaFolder, mediaDestination, localMediaPath: localMatch.path
      });
    }
    const form = new FormData();
    form.set('savepath', mediaDestination);
    form.set('paused', 'false');
    form.set('sequentialDownload', 'true');
    form.set('firstLastPiecePrio', 'true');
    form.set('torrents', new Blob([bytes], { type: 'application/x-bittorrent' }), torrentFilename);
    await qbitRequest('/api/v2/torrents/add', { method: 'POST', body: form });
    const it = { id: crypto.randomUUID(), title: `FileList #${id}`, folder: 'Torrent', status: 'queued', error: '', hash: null, files: [], listingId: id };
    torrentQueue.push(it);
    setTimeout(async () => {
      try {
        const rows = await qbitJson('/api/v2/torrents/info');
        const q = rows.find(x => !beforeHashes.has(x.hash));
        if (q) { it.hash = q.hash; it.q = q; it.title = q.name; it.status = qbitState(q); it.files = await readQbitFiles(q.hash); }
        else { it.error = 'qBittorrent accepted the torrent, but its new hash was not visible yet. The queue refresh will detect it.'; }
      } catch (e) { it.error = e.message; }
    }, 1800);
    return res.status(202).json({ ok: true, message: `Torrent saved as ${torrentFilename} in ${torrentInputsDir()} and added to qBittorrent; media destination is ${mediaDestination}.`, torrentFilename, torrentPath: path.join(torrentInputsDir(), torrentFilename), mediaFolder, mediaDestination, item: publicTorrentItem(it) });
  } catch (e) {
    return res.status(502).json({ error: `Automatic FileList download failed: ${e.message}` });
  }
});

app.delete('/api/filelist/release/:id', requireLocalNetwork, async (req, res) => {
  const id = String(req.params.id || '');
  if (!/^\d{1,12}$/.test(id)) return res.status(400).json({ error: 'Invalid FileList listing ID.' });
  try {
    const cached = filelistDownloadLinks.get(id);
    const releaseName = safeMediaTitle(cached?.name || req.body?.listingName || `FileList-${id}`);
    const category = String(req.body?.category || cached?.category || '').toLowerCase();
    const folder = /series|tv|episode|season/.test(category) ? 'Series' : 'Movie';
    const root = path.resolve(mediaRoot(), folder);
    const releaseDir = path.resolve(root, releaseName);
    if (!releaseDir.startsWith(root + path.sep)) return res.status(403).json({ error: 'Invalid release folder.' });
    // Stop/remove only the torrent whose exact name matches this selected release.
    const rows = await qbitJson('/api/v2/torrents/info');
    const wantedName = releaseName.toLowerCase();
    const matched = rows.filter(q => {
      const qName = String(q.name || '').toLowerCase();
      const contentPath = String(q.content_path || '').toLowerCase();
      const savePath = String(q.save_path || '').toLowerCase();
      return qName === wantedName || contentPath === releaseDir.toLowerCase() ||
        contentPath.startsWith((releaseDir + path.sep).toLowerCase()) ||
        savePath === releaseDir.toLowerCase();
    });
    for (const q of matched) {
      await qbitRequest('/api/v2/torrents/delete', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ hashes: q.hash, deleteFiles: 'true' }) });
      for (const item of torrentQueue) if (item.hash === q.hash) item.status = 'removed';
    }
    let deletedFolder = false;
    if (fs.existsSync(releaseDir) && fs.statSync(releaseDir).isDirectory()) { fs.rmSync(releaseDir, { recursive: true, force: true }); deletedFolder = true; }
    const torrentName = localTorrentFilename(cached?.name || releaseName, id);
    const torrentPath = path.resolve(torrentInputsDir(), torrentName);
    let deletedTorrent = false;
    if (path.dirname(torrentPath) === path.resolve(torrentInputsDir()) && fs.existsSync(torrentPath) && fs.statSync(torrentPath).isFile()) { fs.unlinkSync(torrentPath); deletedTorrent = true; }
    // Also remove the common exact release-name torrent variant, never arbitrary files.
    const exactTorrent = path.resolve(torrentInputsDir(), releaseName + '.torrent');
    if (path.dirname(exactTorrent) === path.resolve(torrentInputsDir()) && fs.existsSync(exactTorrent) && fs.statSync(exactTorrent).isFile()) { fs.unlinkSync(exactTorrent); deletedTorrent = true; }
    res.json({ ok: true, deletedFolder, stoppedTorrents: matched.length, deletedTorrent, message: `Deleted selected release${matched.length ? ` and stopped ${matched.length} matching qBittorrent download(s)` : ''}${deletedFolder ? ', including its media folder' : ''}${deletedTorrent ? ' and its .torrent file' : ''}.` });
  } catch (e) { res.status(502).json({ error: `Could not delete selected release: ${e.message}` }); }
});

app.post('/api/torrents',requireLocalNetwork,async(req,res)=>{
 const magnet=String(req.body?.magnet||'').trim(), encoded=String(req.body?.torrentBase64||'').trim();
 const title=safeMediaTitle(req.body?.title), folder=['Series','Torrent'].includes(req.body?.folder)?req.body.folder:'Movie';
 try{
  const form=new FormData();form.set('savepath',path.join(mediaRoot(),folder));form.set('paused','false');form.set('sequentialDownload','true');form.set('firstLastPiecePrio','true');
  if(/^magnet:\?xt=urn:btih:[a-z0-9]{32,64}/i.test(magnet))form.set('urls',magnet);
  else if(encoded){if(encoded.length>7*1024*1024)return res.status(413).json({error:'.torrent file must be 5 MB or smaller.'});const b=Buffer.from(encoded,'base64');if(b.length<20||b.length>5*1024*1024)return res.status(400).json({error:'Invalid .torrent file.'});form.set('torrents',new Blob([b],{type:'application/x-bittorrent'}),'upload.torrent');}
  else return res.status(400).json({error:'Paste a valid magnet URI or choose a .torrent file you are authorized to download.'});
  await qbitRequest('/api/v2/torrents/add',{method:'POST',body:form});
  const it={id:crypto.randomUUID(),title,folder,status:'queued',error:'',hash:null,files:[]};torrentQueue.push(it);
  setTimeout(async()=>{try{const rows=await qbitJson('/api/v2/torrents/info');const q=rows.find(x=>(magnet&&x.magnet_uri===magnet)||(x.name&&x.name.toLowerCase()===title.toLowerCase()));if(q){it.hash=q.hash;it.q=q;it.title=q.name;it.status=qbitState(q);it.files=await readQbitFiles(q.hash);}}catch(e){it.error=e.message;}},1200);
  res.status(202).json({item:publicTorrentItem(it),message:'Added to qBittorrent. Queue status will refresh automatically.'});
 }catch(e){res.status(502).json({error:`Could not add torrent to qBittorrent: ${e.message}`});}
});
app.delete('/api/torrents/:id',requireLocalNetwork,async(req,res)=>{
 const it=torrentQueue.find(x=>x.id===req.params.id);if(!it)return res.status(404).json({error:'Queue item not found.'});
 try{if(it.hash)await qbitRequest('/api/v2/torrents/delete',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({hashes:it.hash,deleteFiles:'false'})});it.status='removed';res.json({ok:true});}
 catch(e){res.status(502).json({error:e.message});}
});
app.get('/api/torrents/:id/stream/:fileIndex',requireLocalNetwork,async(req,res)=>{
 const it=torrentQueue.find(x=>x.id===req.params.id&&x.status!=='removed');if(!it?.hash)return res.status(404).end('Torrent is still being added to qBittorrent.');
 try{
  const q=(await qbitJson('/api/v2/torrents/info?hashes='+encodeURIComponent(it.hash)))[0], files=await qbitJson('/api/v2/torrents/files?hash='+encodeURIComponent(it.hash)), f=files[Number(req.params.fileIndex)];
  if(!q||!f||!/\.(mp4|mkv|webm|avi|mov|m4v)$/i.test(f.name))return res.status(404).end('Playable video not available yet.');
  const root=path.resolve(q.content_path||path.join(q.save_path,q.name)), filePath=path.resolve(root,f.name);
  if(filePath!==root&&!filePath.startsWith(root+path.sep))return res.status(403).end('Invalid media path.');
  const st=await fs.promises.stat(filePath), total=Number(f.size)||st.size;let start=0,end=total-1;
  if(req.headers.range){const m=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);if(!m)return res.status(416).end();if(m[1])start=Number(m[1]);if(m[2])end=Number(m[2]);if(start>end||start>=total)return res.status(416).end();end=Math.min(end,total-1);res.status(206).set({'Content-Range':`bytes ${start}-${end}/${total}`,'Accept-Ranges':'bytes','Content-Length':String(end-start+1)});}
  else res.set({'Accept-Ranges':'bytes','Content-Length':String(total)});
  const ext=path.extname(filePath).toLowerCase();res.set('Content-Type',({'.mp4':'video/mp4','.m4v':'video/mp4','.webm':'video/webm','.mov':'video/quicktime','.mkv':'video/x-matroska','.avi':'video/x-msvideo'})[ext]||'application/octet-stream');
  fs.createReadStream(filePath,{start,end}).on('error',()=>res.end()).pipe(res);
 }catch(e){res.status(503).end(`Video not ready to stream: ${e.message}`);}
});
app.get('*', (_req,res) => res.sendFile(path.join(PUBLIC, 'index.html')));
app.listen(PORT, "0.0.0.0", () => console.log(`CineWave listening on http://0.0.0.0:${PORT}`));

