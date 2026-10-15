
const img = p => p ? (String(p).startsWith('http') ? p : `https://image.tmdb.org/t/p/w500${p}`) : '';
const back = p => p ? (String(p).startsWith('http') ? p : `https://image.tmdb.org/t/p/w1280${p}`) : '';
let activeFilter='all', selected=null, omdbConfigured=false, appConfig={}, currentSearchQuery='', currentSearchPage=1, currentSearchType='multi', currentSearchHasMore=false;
const demo=[
{id:101,title:'Dune: Part Two',year:2024,type:'movie',rating:8.3,genre:'Science Fiction',poster:'/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg',backdrop:'/xOMo8BRK7PfcJv9JCnx7s5hj0PX.jpg',overview:'Paul Atreides unites with Chani and the Fremen while seeking revenge against the conspirators who destroyed his family.',source:'demo'},
{id:102,title:'The Last of Us',year:2023,type:'tv',rating:8.6,genre:'Drama · Adventure',poster:'/uKvVjHNqB5VmOrds7d2a7Z5RM6h.jpg',backdrop:'/uDgy6hyPd82kOHh6I95FLtLnj6p.jpg',overview:'A hardened survivor escorts a teenager across a dangerous, changed world.',source:'demo'},
{id:103,title:'Interstellar',year:2014,type:'movie',rating:8.7,genre:'Science Fiction · Drama',poster:'/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg',backdrop:'/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg',overview:'A team travels beyond this galaxy to discover whether mankind has a future among the stars.',source:'demo'},
{id:104,title:'Severance',year:2022,type:'tv',rating:8.7,genre:'Mystery · Science Fiction',poster:'/lFf6LLrQjYldcZItzOkGmMMyg4s.jpg',backdrop:'/lFf6LLrQjYldcZItzOkGmMMyg4s.jpg',overview:'Employees at a mysterious company undergo a procedure that separates their work memories from their personal lives.',source:'demo'},
{id:105,title:'Oppenheimer',year:2023,type:'movie',rating:8.1,genre:'Drama · History',poster:'/ptpr0kGAckfQkJeJIt8st5dglvd.jpg',backdrop:'/fm6KqXpk3M2HVveHwCrBSSBaO0V.jpg',overview:'The story of J. Robert Oppenheimer and the creation of the atomic bomb.',source:'demo'},
{id:106,title:'House of the Dragon',year:2022,type:'tv',rating:8.3,genre:'Fantasy · Drama',poster:'/z2yahl2uefxDCl0nogcRBiwsvn7.jpg',backdrop:'/etj8E2o0xisjob60M8H1FUCb8Ik.jpg',overview:'The Targaryen dynasty at the height of its power.',source:'demo'}];
let currentItems=[...demo];
function formatBytes(n){if(!Number.isFinite(n)||n<0)return '';const units=['B','KB','MB','GB','TB'];let i=0;while(n>=1024&&i<units.length-1){n/=1024;i++}return `${n.toFixed(i===0?0:2)} ${units[i]}`;}
function escapeHtml(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function normalizeOmdb(x,type){return {id:x.imdbID||x.id||'',imdb_id:x.imdbID||x.imdb_id||x.id||'',title:x.Title||x.title||'Untitled',year:String(x.Year||x.year||'').split(/[–-]/)[0],type:type||x.type||(x.Type==='series'?'tv':'movie'),rating:x.rating||'—',genre:x.genre||'',poster:x.Poster&&x.Poster!=='N/A'?x.Poster:(x.poster||''),backdrop:'',overview:x.overview||'',source:'omdb'};}
function card(x){const p=img(x.poster);const stableId=String(x.id||'');return `<article class="movie" tabindex="0" role="button" aria-label="Open ${escapeHtml(x.title)}" onclick="openItem('${escapeHtml(stableId)}')" onkeydown="if(event.key==='Enter')openItem('${escapeHtml(stableId)}')"><div class="poster">${p?`<img loading="lazy" src="${p}" alt="${escapeHtml(x.title)} poster" onerror="this.style.display='none';this.parentElement.classList.add('poster-missing')">`:''}<span class="tag">${x.type==='tv'?'SERIES':'MOVIE'}</span><span class="score">★ ${escapeHtml(String(x.rating||'—'))}</span></div><h3>${escapeHtml(x.title)}</h3><div class="year">${escapeHtml(x.year||'Year unknown')} · ${x.type==='tv'?'TV series':escapeHtml(x.genre||'')}</div>${x.imdb_id?`<div class="year">IMDb: ${escapeHtml(x.imdb_id)}</div>`:''}</article>`}
function render(list=currentItems){const q=document.getElementById('searchInput').value.trim().toLowerCase();let filtered=list.filter(x=>(activeFilter==='all'||x.type===activeFilter)&&(!q||(x.title+' '+x.year+' '+(x.genre||'')).toLowerCase().includes(q)));document.getElementById('movieCards').innerHTML=filtered.map(card).join('')||'<div class="empty">No matching titles. Try a different search.</div>';const tv=list.filter(x=>x.type==='tv').slice(0,12);document.getElementById('seriesCards').innerHTML=tv.map(card).join('')||'<div class="empty">No series loaded yet.</div>';renderWatchlist();}
function renderWatchlist(){let ids=JSON.parse(localStorage.getItem('cinewave-watchlist')||'[]');let w=ids.map(id=>currentItems.find(x=>String(x.id)===String(id))).filter(Boolean);document.getElementById('watchlistCards').innerHTML=w.map(card).join('')||'<div class="empty">Your watchlist is empty. Open a title and add it.</div>'}
function openItem(id){selected=currentItems.find(x=>String(x.id)===String(id))||demo.find(x=>String(x.id)===String(id));if(!selected)return;document.getElementById('modalTitle').textContent=selected.title;document.getElementById('modalMeta').innerHTML=`<span class="score">★ ${escapeHtml(String(selected.rating||'—'))}</span><span>${escapeHtml(selected.year||'')}</span><span>${escapeHtml(selected.type==='tv'?'TV Series':'Movie')}</span><span>${escapeHtml(selected.genre||'')}</span>`;document.getElementById('modalOverview').textContent=selected.overview||'No overview available.';const b=document.getElementById('modalBackdropImg');b.style.display=selected.backdrop?'block':'none';b.src=back(selected.backdrop);const initialImdb=String(selected.imdb_id||selected.imdbID||'').trim();document.getElementById('imdbLink').href=/^tt\d+$/.test(initialImdb)?`https://www.imdb.com/title/${initialImdb}/`:`https://www.imdb.com/find/?q=${encodeURIComponent(selected.title)}`;document.getElementById('imdbLink').textContent=/^tt\d+$/.test(initialImdb)?'Open IMDb ↗':'Search IMDb ↗';if(selected.source==='omdb'&&selected.imdb_id){api(`/api/title?imdb=${encodeURIComponent(selected.imdb_id)}`).then(d=>{if(!selected||String(selected.imdb_id)!==String(d.imdb_id))return;selected={...selected,...d};document.getElementById('modalTitle').textContent=selected.title;document.getElementById('modalMeta').innerHTML=`<span class="score">★ ${escapeHtml(String(selected.rating||'—'))}</span><span>${escapeHtml(selected.year||'')}</span><span>${escapeHtml(selected.type==='tv'?'TV Series':'Movie')}</span><span>${escapeHtml(selected.genre||'')}</span>`;document.getElementById('modalOverview').textContent=selected.overview||'No overview available.';document.getElementById('imdbLink').href=selected.imdb_url||`https://www.imdb.com/title/${encodeURIComponent(selected.imdb_id)}/`;}).catch(e=>console.warn('OMDb details:',e.message));}document.getElementById('providerResults').innerHTML='';document.getElementById('playbackNote').textContent='Choose a catalogue listing or add an authorized magnet/.torrent file below. FileList remains a catalogue connector; torrent input is provided separately.'; renderTorrentQueue();document.getElementById('modalBackdrop').classList.add('open');if(appConfig.useFileList!==false)setTimeout(()=>findFileList(),0)}
function closeModal(){document.getElementById('modalBackdrop').classList.remove('open')}
function addSelected(){if(!selected)return;let ids=JSON.parse(localStorage.getItem('cinewave-watchlist')||'[]');if(!ids.map(String).includes(String(selected.id)))ids.push(selected.id);localStorage.setItem('cinewave-watchlist',JSON.stringify(ids));renderWatchlist();notify('Added to watchlist.')}
function clearWatchlist(){localStorage.removeItem('cinewave-watchlist');renderWatchlist();notify('Watchlist cleared.')}
async function deleteFileListRelease(id,category){if(!/^\d{1,12}$/.test(String(id||''))){notify('Cannot identify this FileList release.');return;}if(!confirm('Stop this release download and delete only its Movie/Series folder and matching .torrent file?'))return;try{const d=await api('/api/filelist/release/'+encodeURIComponent(id),{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({category})});notify(d.message||'Release deleted.');await refreshStorage();await findFileList();await renderTorrentQueue();}catch(e){notify('Delete failed: '+e.message)}}
async function deleteLocalMedia(folder,name,mediaPath){if(!confirm('Delete this release folder, its video and matching .torrent file?\n\n'+(mediaPath||folder+'/'+name)+'\n\nThis cannot be undone.'))return;try{const result=await api('/api/media/item',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({folder,name,mediaPath})});notify(result.message||'Release deleted.');await refreshStorage();if(selected)await findFileList();await renderTorrentQueue()}catch(e){notify(e.message)}}
async function launchExternalPlayer(filePath){try{const d=await api('/api/player/open',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filePath})});notify(d.message||'Player launched.')}catch(e){notify('Could not launch player: '+e.message)}}
function notify(m){let t=document.getElementById('toast');t.textContent=m;t.style.display='block';clearTimeout(window._toastTimer);window._toastTimer=setTimeout(()=>t.style.display='none',3000)}
function openSettings(){document.getElementById('settingsBackdrop').classList.add('open');loadSettingsStatus()}
function closeSettings(){document.getElementById('settingsBackdrop').classList.remove('open')}
async function api(path,opts={}){const r=await fetch(path,opts);let data;try{data=await r.json()}catch{data={error:'Unexpected server response'}}if(!r.ok)throw new Error(data.error||`Request failed (${r.status})`);return data}
async function loadSettingsStatus(){try{const d=await api('/api/status');appConfig=d;document.getElementById('omdbStatus').textContent='OMDb · '+(d.omdbConfigured?'configured':'not configured');document.getElementById('filelistStatus').textContent='FileList · '+(d.filelistConfigured?'configured':'not configured');document.getElementById('cacheMinutes').value=d.cacheMinutes??15;document.getElementById('resultLimit').value=String(d.resultLimit||20);document.getElementById('useFileList').checked=d.useFileList!==false;document.getElementById('useOmdb').checked=d.useOmdb!==false;document.getElementById('omdbLanguage').value=d.language||'en';document.getElementById('translateUrl').value=d.translateUrl||'';document.getElementById('subtitleLanguage').value=d.subtitleLanguage||'ru';document.getElementById('subtitleSourceLanguage').value=d.subtitleSourceLanguage||'auto';document.getElementById('autoTranslateSubs').checked=d.autoTranslateSubs!==false;document.getElementById('externalPlayer').value=d.externalPlayer||'vlc';document.getElementById('externalPlayerPath').value=d.externalPlayerPath||'';document.getElementById('streamQuality').value=d.streamQuality||'1080p';document.getElementById('streamThreshold').value=String(d.streamThreshold||10);document.getElementById('settingsStatus').textContent='Server reachable. Secrets are never returned to the browser.';}catch(e){document.getElementById('settingsStatus').textContent='Backend not running: '+e.message+'\\nStart the server with npm start, then open http://localhost:3000.'}}
async function saveSettings(){const body={omdbKey:document.getElementById('omdbKey').value,filelistUsername:document.getElementById('filelistUsername').value,filelistPasskey:document.getElementById('filelistPasskey').value,filelistCategories:document.getElementById('filelistCategories').value,cacheMinutes:Number(document.getElementById('cacheMinutes').value),resultLimit:Number(document.getElementById('resultLimit').value),useFileList:document.getElementById('useFileList').checked,useOmdb:document.getElementById('useOmdb').checked,language:document.getElementById('omdbLanguage').value,translateUrl:document.getElementById('translateUrl').value,translateApiKey:document.getElementById('translateApiKey').value,subtitleLanguage:document.getElementById('subtitleLanguage').value,subtitleSourceLanguage:document.getElementById('subtitleSourceLanguage').value,autoTranslateSubs:document.getElementById('autoTranslateSubs').checked,externalPlayer:document.getElementById('externalPlayer').value,externalPlayerPath:document.getElementById('externalPlayerPath').value,streamQuality:document.getElementById('streamQuality').value,streamThreshold:Number(document.getElementById('streamThreshold').value)};try{let d=await api('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});document.getElementById('settingsStatus').textContent=(d.message||'Settings saved.')+'\nSaved configuration persists on the server. Secret fields stay blank after reload; leave them blank to keep saved credentials.';await loadSettingsStatus();notify('Settings saved on server.')}catch(e){document.getElementById('settingsStatus').textContent=e.message;}}
async function testConnection(provider){let body={provider,omdbKey:document.getElementById('omdbKey').value,filelistUsername:document.getElementById('filelistUsername').value,filelistPasskey:document.getElementById('filelistPasskey').value};try{let d=await api('/api/test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});document.getElementById('settingsStatus').textContent=`${provider.toUpperCase()} test: ${d.ok?'OK':'failed'}\\n${d.message}`;notify(`${provider} test ${d.ok?'passed':'failed'}.`)}catch(e){document.getElementById('settingsStatus').textContent=e.message}}
async function clearCache(){try{const d=await api('/api/cache/clear',{method:'POST'});localStorage.removeItem('cinewave-watchlist');renderWatchlist();document.getElementById('settingsStatus').textContent=d.message;notify('App cache cleared.')}catch(e){document.getElementById('settingsStatus').textContent=e.message}}
async function searchNow(){const q=document.getElementById('searchInput').value.trim();if(!q){notify('Type a title to search.');document.getElementById('searchInput').focus();return}currentSearchQuery=q;currentSearchPage=1;currentSearchType=activeFilter==='all'?'multi':activeFilter;document.getElementById('catalogueSubtitle').textContent='Searching live providers…';document.getElementById('loadMoreBtn').hidden=true;try{const d=await api(`/api/search?q=${encodeURIComponent(q)}&type=${currentSearchType}&page=1`);let results=(d.results||[]).map(x=>normalizeOmdb(x));currentItems=results;currentSearchHasMore=!!d.hasMore;render(results);document.getElementById('catalogueSubtitle').textContent=`${d.totalResults||results.length} matching metadata results · Page 1`;document.getElementById('loadMoreBtn').hidden=!currentSearchHasMore;document.getElementById('loadMoreSentinel').textContent=currentSearchHasMore?'Scroll for more results':'';setupAutoLoad();if(!results.length)notify('No results found.')}catch(e){document.getElementById('catalogueSubtitle').textContent='Live search unavailable: '+e.message;let local=demo.filter(x=>(x.title+' '+x.genre).toLowerCase().includes(q.toLowerCase()));currentItems=local;render(local);notify('Could not reach backend. Start the server and configure APIs.')}}
async function loadMoreResults(){if(!currentSearchHasMore||!currentSearchQuery)return;const btn=document.getElementById('loadMoreBtn');btn.disabled=true;btn.textContent='Loading…';try{const next=currentSearchPage+1;const d=await api(`/api/search?q=${encodeURIComponent(currentSearchQuery)}&type=${currentSearchType}&page=${next}`);const more=(d.results||[]).map(x=>normalizeOmdb(x));const known=new Set(currentItems.map(x=>x.id));currentItems=[...currentItems,...more.filter(x=>!known.has(x.id))];currentSearchPage=next;currentSearchHasMore=!!d.hasMore;render(currentItems);document.getElementById('catalogueSubtitle').textContent=`${d.totalResults||currentItems.length} matching metadata results · Page ${currentSearchPage}`;btn.hidden=!currentSearchHasMore;document.getElementById('loadMoreSentinel').textContent=currentSearchHasMore?'Scroll for more results':'No more results';setupAutoLoad();}catch(e){btn.hidden=false;notify('Could not load more results: '+e.message)}finally{btn.disabled=false;btn.textContent='Load more results';}}

let autoLoadObserver;
function setupAutoLoad(){const sentinel=document.getElementById('loadMoreSentinel');if(!sentinel||!('IntersectionObserver' in window))return;if(autoLoadObserver)autoLoadObserver.disconnect();autoLoadObserver=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)&&currentSearchHasMore&&!window._autoLoading){window._autoLoading=true;loadMoreResults().finally(()=>{window._autoLoading=false;});}}, {rootMargin:'700px 0px'});autoLoadObserver.observe(sentinel);}

async function loadPopular(type){try{const d=await api(`/api/popular?type=${type}`);let a=(d.results||[]).map(x=>normalizeOmdb(x,type));if(type==='tv'){document.getElementById('seriesCards').innerHTML=a.map(card).join('')||'<div class="empty">No series returned.</div>';currentItems=[...currentItems.filter(x=>x.source!=='omdb'),...a];}notify(`Loaded ${a.length} popular ${type==='tv'?'series':'movies'}.`)}catch(e){notify(e.message)}}
async function loadMatchedDatabase(){const el=document.getElementById('matchedDatabaseResults');if(!el)return;try{const d=await api('/api/filelist/matches');const rows=d.results||[];el.innerHTML=rows.map(x=>`<div class="provider-row"><div><strong>${escapeHtml(x.name||'Untitled listing')}</strong><br><small>${escapeHtml(x.titleQuery||'')} · ${escapeHtml(x.category||'FileList listing')}${x.size?` · ${escapeHtml(String(x.size))}`:''}</small></div><small>${x.status==='missing-grace-period'?'Missing · grace period': 'Matched'}${x.lastSeenAt?`<br>${new Date(x.lastSeenAt).toLocaleString()}`:''}</small></div>`).join('')||'<div class="api-status">No saved matches yet. Open a title and choose “Search FileList catalogue” to populate this database.</div>'}catch(e){el.innerHTML=`<div class="api-status">Could not load saved matches: ${escapeHtml(e.message)}</div>`}}
let fileListLaunchInFlight = false;
async function selectFileListListing(card){
  if(card.dataset.downloading==='true') return;
  document.querySelectorAll('.fl-result.selected').forEach(el=>el.classList.remove('selected'));
  card.classList.add('selected');
  const title=card.querySelector('.fl-result-title')?.textContent||'FileList listing';
  const id=String(card.dataset.listingId||'').trim();
  const note=document.getElementById('playbackNote');
  if(!/^\d{1,12}$/.test(id)){note.textContent='This FileList result has no valid listing ID.';return;}
  card.dataset.downloading='true';
  const inline=card.querySelector('.fl-inline-download'); if(inline){inline.hidden=false;const st=inline.querySelector('.fl-inline-status');if(st)st.textContent='Downloading .torrent and adding to qBittorrent…';} const dlButton=card.querySelector('.fl-download-button'); if(dlButton){dlButton.disabled=true;dlButton.textContent='Starting…';}
  note.textContent=`Automatically downloading the .torrent for “${title}” and sending it to qBittorrent…`;
  try{
    const result=await api(`/api/filelist/download/${encodeURIComponent(id)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({listingName:title,category:card.dataset.category||''})});
    note.textContent=result.message||'Added to qBittorrent.';
    if(inline){const st=inline.querySelector('.fl-inline-status');if(st)st.textContent=result.alreadyPresent?'Already downloaded locally.':(result.message||'Queued in qBittorrent.');if(result.alreadyPresent){inline.hidden=true;}else{inline.hidden=false;}}
    if(result.alreadyPresent){
      const action=card.querySelector('.fl-result-action');
      if(action && result.localMediaPath){
        const localPath=String(result.localMediaPath), localName=localPath.split(/[\\/]/).pop(), localFolder=String(result.mediaFolder||'Movie');
        const playArg=JSON.stringify(localPath).replace(/&/g,'&amp;').replace(/</g,'&lt;');
        action.innerHTML=`<button type="button" class="btn primary" onclick="event.stopPropagation();launchExternalPlayer(${playArg})">▶ Play</button><button type="button" class="btn" onclick="event.stopPropagation();deleteLocalMedia('${localFolder}','${localName.replace(/'/g, '&#39;')}')">Delete</button>`;
      }
      const inlinePanel=card.querySelector('.fl-inline-download'); if(inlinePanel) inlinePanel.hidden=true;
    }
    notify(result.alreadyPresent ? 'Matching local video found; saved the matching .torrent without duplicating the download.' : `Started: ${title}`);
    if(!result.alreadyPresent && dlButton){dlButton.disabled=true;dlButton.textContent='Downloading…';}
    await renderTorrentQueue();
    if(result.alreadyPresent && result.localMediaPath && document.getElementById('autoOpenPlayer')?.checked){
      await launchExternalPlayer(result.localMediaPath);
    }
  }catch(e){
    if(inline){const st=inline.querySelector('.fl-inline-status');if(st)st.textContent='Download failed: '+e.message;}
    if(dlButton){dlButton.disabled=false;dlButton.textContent='↓ Download';}
    note.textContent=`Automatic download failed for “${title}”: ${e.message}`;
    notify(e.message);
  }finally{card.dataset.downloading='false';}
}
async function findFileList(){
  if(!selected)return;
  const el=document.getElementById('providerResults');
  el.innerHTML='<div class="api-status">Searching FileList by IMDb ID…</div>';
  try{
    let imdb=String(selected.imdb_id||selected.imdbID||selected.imdbId||selected.id||'').trim();

    // Demo cards can have numeric IDs. Resolve them through OMDb by title first.
    if(!/^tt\d+$/.test(imdb)){
      try {
        const kind=selected.type==='tv'?'tv':'movie';
        const lookup=await api(`/api/search?q=${encodeURIComponent(selected.title)}&type=${kind}`);
        const candidates=(lookup.results||[]).map(x=>normalizeOmdb(x,kind));
        const title=String(selected.title||'').trim().toLowerCase();
        const year=String(selected.year||'').trim();
        const match=candidates.find(x=>
          String(x.title||'').trim().toLowerCase()===title &&
          (!year || !x.year || String(x.year).trim()===year)
        ) || candidates.find(x=>
          String(x.title||'').trim().toLowerCase()===title
        );

        const resolved=String(match?.imdb_id||match?.id||'').trim();
        if(/^tt\d+$/.test(resolved)){
          selected={...selected,...match};
          imdb=resolved;
        }
      } catch(e) {
        console.warn('Could not resolve IMDb ID:',e.message);
      }
    }

    if(!/^tt\d+$/.test(imdb)){
      el.innerHTML='<div class="api-status">Could not resolve this title to an IMDb ID. Try searching for the title again.</div>';
      return;
    }
    const d=await api(`/api/filelist/search?imdb=${encodeURIComponent(imdb)}`);
    const results=d.results||[];
    let localMedia=[];try{localMedia=(await api('/api/media/list')).items||[]}catch{}
    const normMedia=v=>String(v||'').split(/[\\/]/).pop().trim().replace(/\.(mkv|mp4|avi|mov|wmv|webm|m4v|torrent|srt|vtt)$/i,'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    // Match the film/series title and year, ignoring release-specific tags such as DD5.1, x264, BDRip.
    const localIdentity=value=>{const base=normMedia(value).replace(/[._-]+/g,' ');const year=(base.match(/\b(19\d{2}|20\d{2})\b/)||[])[1]||'';const prefix=year?base.slice(0,base.indexOf(year)):base;const title=prefix.replace(/\b(ddp?|dts(?: hd)?(?: ma)?|truehd|aac|ac3|eac3)(?:[ ._-]?\d(?:[ ._-]?\d)?)?\b/gi,' ').replace(/\b(x264|x265|h ?264|h ?265|hevc|avc|bluray|blu ray|bdrip|brrip|webrip|web dl|hdr|uhd|proper|repack)\b/gi,' ').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');return title+'|'+year};
    const localForTitle=title=>{const wanted=localIdentity(title);return localMedia.find(m=>localIdentity(m.name)===wanted)||null};
    const formatSize=n=>{n=Number(n)||0;if(!n)return '—';const u=['B','KB','MB','GB','TB'];let i=0;while(n>=1024&&i<u.length-1){n/=1024;i++}return `${n.toFixed(i>=3?2:1)} ${u[i]}`};
    const esc=v=>escapeHtml(String(v??''));
    el.innerHTML=results.map((x,index)=>{
      const size=x.size?formatSize(x.size):'—';
      const seeds=Number(x.seeders)||0, leeches=Number(x.leechers)||0;
      const date=x.uploadDate||x.upload_date||'';
      const internal=Number(x.internal)===1;
      const freeleech=Number(x.freeleech)===1;
      const desc=x.description||x.small_description||'';
      const cat=x.category||'FileList listing';
      const local=localForTitle(x.name||'');
      return `<article class="fl-result" data-listing-id="${esc(x.id??'')}" data-category="${esc(cat)}">
        <div class="fl-result-main">
          <div class="fl-result-title">${esc(x.name||'Untitled listing')}</div>
          <div class="fl-result-tags"><span class="fl-tag fl-category">${esc(cat)}</span>${internal?'<span class="fl-tag fl-internal">INTERNAL</span>':''}${freeleech?'<span class="fl-tag fl-freeleech">FREELEECH</span>':''}</div>
          ${desc?`<div class="fl-result-desc">${esc(desc)}</div>`:''}
          <div class="fl-result-date">${date?`Uploaded ${esc(date)}`:'Upload date unavailable'}${x.files?` · ${esc(x.files)} file${Number(x.files)===1?'':'s'}`:''}</div>
        </div>
        <div class="fl-result-stats">
          <div class="fl-stat fl-size"><span class="fl-stat-label">SIZE</span><strong>${esc(size)}</strong></div>
          <div class="fl-stat fl-seeders"><span class="fl-stat-icon" aria-hidden="true">↑</span><div><strong>${esc(seeds.toLocaleString())}</strong><span>Seeders</span></div></div>
          <div class="fl-stat fl-leechers"><span class="fl-stat-icon" aria-hidden="true">↓</span><div><strong>${esc(leeches.toLocaleString())}</strong><span>Leechers</span></div></div>
        </div>
        <div class="fl-result-action">${local?`<button type="button" class="btn primary" onclick="event.stopPropagation();launchExternalPlayer(${JSON.stringify(local.path).replace(/&/g,'&amp;').replace(/</g,'&lt;')})">▶ Play</button><button type="button" class="btn" onclick="event.stopPropagation();deleteLocalMedia('${esc(local.folder)}','${esc(local.name)}',${JSON.stringify(local.path).replace(/&/g,'&amp;').replace(/</g,'&lt;')})">Delete</button>`:`<button type="button" class="btn primary fl-download-button" onclick="event.stopPropagation();selectFileListListing(this.closest('.fl-result'))">↓ Download</button>`}</div>
        <div class="fl-inline-download" hidden style="grid-column:1/-1;width:100%;"><div class="api-status fl-inline-status">Preparing download…</div><div style="height:6px;background:#ffffff12;border-radius:9px;overflow:hidden;margin-top:8px"><div class="fl-inline-bar" style="height:100%;width:0%;background:var(--green);transition:width .3s"></div></div><small class="fl-inline-percent" style="display:block;margin-top:5px;color:var(--muted)">0.0%</small></div>
      </article>`;
    }).join('')||'<div class="api-status">No FileList listings matched this IMDb ID. Confirm the IMDb ID and FileList API credentials.</div>';
    document.getElementById('playbackNote').textContent='Click a FileList listing to download its named .torrent into E:\\cinewave-website\\Torrent and queue it automatically. Movies and series are saved into release-named folders; playback opens at 10%.';
    loadMatchedDatabase();
  }catch(e){el.innerHTML=`<div class="api-status">${escapeHtml(e.message)}</div>`}
}
document.getElementById('settingsOpen').addEventListener('click',openSettings);document.getElementById('searchInput').addEventListener('keydown',e=>{if(e.key==='Enter')searchNow()});document.getElementById('searchInput').addEventListener('input',()=>{if(!document.getElementById('searchInput').value.trim()){currentItems=[...demo];render()}});document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));b.classList.add('active');activeFilter=b.dataset.filter;render()}));document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeModal();closeSettings()}});render();setupAutoLoad();loadSettingsStatus();loadMatchedDatabase();
async function translateSubtitleFile(){
  const input=document.getElementById('subtitleFile');
  const file=input?.files?.[0];
  if(!file){notify('Choose an .srt or .vtt subtitle file first.');return;}
  if(file.size>1024*1024){notify('Subtitle file must be smaller than 1 MB.');return;}
  try{
    const text=await file.text();
    const data=await api('/api/subtitles/translate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filename:file.name,text,targetLanguage:document.getElementById('subtitleLanguage')?.value||'en',sourceLanguage:document.getElementById('subtitleSourceLanguage')?.value||'auto'})});
    const blob=new Blob([data.translatedText],{type:'text/plain;charset=utf-8'});
    const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=file.name.replace(/\.(srt|vtt)$/i,'')+'.translated.'+(file.name.match(/\.(srt|vtt)$/i)?.[1]||'srt');document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
    document.getElementById('playbackNote').textContent=`Subtitle translation complete (${data.cues} cues). Translated file saved by your browser.`;
  }catch(e){document.getElementById('playbackNote').textContent='Subtitle translation failed: '+e.message;notify(e.message);}
}
document.getElementById('localVideoFile')?.addEventListener('change',event=>{
  const file=event.target.files?.[0];const player=document.getElementById('localVideoPlayer');
  if(!file||!player)return;
  if(player.dataset.objectUrl)URL.revokeObjectURL(player.dataset.objectUrl);
  const url=URL.createObjectURL(file);player.dataset.objectUrl=url;player.src=url;player.style.display='block';
  document.getElementById('playbackNote').textContent=`Ready to play local file: ${file.name}`;
});
let progressSaveTimer=null;
async function refreshStorage(){
 const summary=document.getElementById('storageSummary'), bar=document.getElementById('storageBar'), list=document.getElementById('localMediaList');
 try{const d=await api('/api/media/status'); if(!d.ok){summary.textContent=d.error||'Storage unavailable';bar.style.width='0%';return;}
 const used=Math.max(0,d.totalGB-d.freeGB);const pct=d.totalGB?Math.min(100,used/d.totalGB*100):0;
 summary.textContent=`${d.root} · ${d.freeGB} GB free of ${d.totalGB} GB`;
 document.getElementById('storageFolders').textContent='Folders ready: Movie · Series';bar.style.width=pct+'%';
 const m=await api('/api/media/list'); list.innerHTML=(m.items||[]).slice(0,8).map(x=>`<div class="provider-row"><div><strong>${escapeHtml(x.name)}</strong><br><small>${escapeHtml(x.folder)} · ${(x.sizeBytes/1073741824).toFixed(2)} GB</small></div><div style="display:flex;gap:8px;align-items:center"><small>${new Date(x.modifiedAt).toLocaleDateString()}</small><button class="btn" type="button" onclick="launchExternalPlayer(${JSON.stringify(x.folder+'/'+x.name).replace(/&/g,'&amp;').replace(/</g,'&lt;')})">Open player</button></div></div>`).join('')||'<div class="api-status">No local videos found yet. Place authorized media in E:\\Movie or E:\\Series.</div>';
 }catch(e){summary.textContent='Storage API unavailable: '+e.message;}
}
function currentProgressId(file){return 'local:'+file.name+':'+file.size+':'+file.lastModified;}
async function loadSavedProgress(file, player){try{const d=await api('/api/progress');const item=d.progress?.[currentProgressId(file)];if(item&&item.seconds>0){player.addEventListener('loadedmetadata',function resumeOnce(){player.removeEventListener('loadedmetadata',resumeOnce);if(item.duration&&Math.abs(player.duration-item.duration)>3)return;player.currentTime=Math.min(item.seconds,Math.max(0,player.duration-1));document.getElementById('playbackNote').textContent=`Continue from ${Math.floor(item.seconds/60)} min ${Math.floor(item.seconds%60)} sec, or drag to the beginning for a new start.`;},{once:true});}}catch{}}
async function savePlayerProgress(player,file){if(!file||!Number.isFinite(player.currentTime))return;try{await api('/api/progress',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:currentProgressId(file),seconds:player.currentTime,duration:player.duration})});}catch{}}
const originalLocalVideoHandler=document.getElementById('localVideoFile');
originalLocalVideoHandler?.addEventListener('change',async event=>{const file=event.target.files?.[0],player=document.getElementById('localVideoPlayer');if(!file||!player)return;player.dataset.progressId=currentProgressId(file);player.dataset.progressName=file.name;await loadSavedProgress(file,player);});

let torrentPollTimer = null;
let autoPlayedTorrentId = '';
// Only auto-open when a torrent crosses the threshold during this page session.
// Existing torrents already above the threshold on initial page load must NOT launch on refresh.
let torrentQueueInitialSnapshotTaken = false;
const previousTorrentProgress = new Map();
function fmtQueueBytes(n){n=Number(n)||0;const u=['B','KB','MB','GB','TB'];let i=0;while(n>=1024&&i<u.length-1){n/=1024;i++}return `${n.toFixed(i>=3?2:1)} ${u[i]}`;}
async function addMagnetToQueue(){
 const magnet=document.getElementById('torrentMagnet').value.trim();
 if(!/^magnet:\?xt=urn:btih:[a-z0-9]{32,64}/i.test(magnet)){notify('Paste a valid magnet URI first.');return;}
 await submitTorrent({magnet,title:document.getElementById('torrentTitle').value.trim(),folder:document.getElementById('torrentFolder').value});
}
async function addTorrentFileToQueue(){
 const file=document.getElementById('torrentFile').files?.[0];if(!file){notify('Choose a .torrent file first.');return;}
 if(file.size>5*1024*1024){notify('.torrent files must be 5 MB or smaller.');return;}
 try{const b64=await new Promise((resolve,reject)=>{const r=new FileReader();r.onerror=()=>reject(new Error('Could not read the .torrent file.'));r.onload=()=>resolve(String(r.result).split(',')[1]||'');r.readAsDataURL(file)});
 await submitTorrent({torrentBase64:b64,title:document.getElementById('torrentTitle').value.trim()||file.name.replace(/\.torrent$/i,''),folder:document.getElementById('torrentFolder').value});document.getElementById('torrentFile').value='';
 }catch(e){notify(e.message)}
}
async function submitTorrent(body){try{const d=await api('/api/torrents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});document.getElementById('torrentMagnet').value='';notify(d.message||'Torrent added.');await renderTorrentQueue();}catch(e){document.getElementById('playbackNote').textContent='Could not add torrent: '+e.message;notify(e.message)}}
async function playTorrent(id,url,encodedTitle){
 const title=decodeURIComponent(encodedTitle||'Video');
 try{
  const d=await api('/api/torrents/'+encodeURIComponent(id)+'/open',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})});
  document.getElementById('playbackNote').textContent=d.message||('Opened '+title+' in the player selected in Settings.');
  notify(d.message||'Opened in external player.');
 }catch(e){document.getElementById('playbackNote').textContent='Could not open external player: '+e.message;notify(e.message);}
}
async function removeTorrent(id){try{await api('/api/torrents/'+encodeURIComponent(id),{method:'DELETE'});await renderTorrentQueue()}catch(e){notify(e.message)}}
// Persist automatic launch guards across page refreshes so a reload never reopens VLC.
const AUTO_PLAY_GUARD_KEY = 'cinewave.autoPlayedTorrentIds.v1';
const AUTO_OPEN_PREF_KEY = 'cinewave.autoOpenPlayer.v1';
const autoOpenCheckbox=document.getElementById('autoOpenPlayer');
if(autoOpenCheckbox){try{autoOpenCheckbox.checked=localStorage.getItem(AUTO_OPEN_PREF_KEY)!=='false'}catch{} autoOpenCheckbox.addEventListener('change',()=>{try{localStorage.setItem(AUTO_OPEN_PREF_KEY,autoOpenCheckbox.checked?'true':'false')}catch{}})}
function autoOpenEnabled(){return Boolean(document.getElementById('autoOpenPlayer')?.checked)}
const autoPlayedTorrentIds = new Set((()=>{try{return JSON.parse(sessionStorage.getItem(AUTO_PLAY_GUARD_KEY)||'[]')}catch{return []}})().map(String));
function rememberAutoPlayedTorrent(id){autoPlayedTorrentIds.add(String(id));try{sessionStorage.setItem(AUTO_PLAY_GUARD_KEY,JSON.stringify([...autoPlayedTorrentIds]))}catch{}}
async function renderTorrentQueue(){
 const el=document.getElementById('torrentQueueResults');if(!el)return;
 try{
  const d=await api('/api/torrents');const all=d.items||[];
  const threshold=Number(document.getElementById('streamThreshold')?.value||10);
  // Normalize names identically for qBittorrent titles and files in E:\Movie / E:\Series.
  // Example: Interstellar.2014.BDRip.X264.RoSubbed-playSD and
  // Interstellar.2014.BDRip.X264.RoSubbed-playSD.mkv become the same key.
  const normalizeMediaName=value=>String(value||'').split(/[\\/]/).pop().replace(/\.(mkv|mp4|avi|mov|webm|m4v|mpg|mpeg|wmv)$/i,'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
  let localMedia=[];
  try{const local=await api('/api/media/list');localMedia=Array.isArray(local.items)?local.items:[]}catch{}
  const localKeys=new Set(localMedia.map(f=>normalizeMediaName(f.name)).filter(Boolean));
  // Group same-name torrents first; hide any queue item whose movie file is already
  // present locally. UUID-named .torrent input files are not media and are irrelevant.
  const byTitle=new Map();
  for(const x of all){const key=normalizeMediaName(x.title);const old=byTitle.get(key);if(!old||Number(x.progress)>Number(old.progress))byTitle.set(key,x);}
  const items=[...byTitle.values()].filter(x=>{
    // Keep matched local-video entries visible so the user can play them.
    if(x.localPath) return true;
    return !localKeys.has(normalizeMediaName(x.title));
  });
  // On first poll, record current progress only; never auto-open a torrent that was
  // already above the threshold when the page loaded (common after browser refresh).
  let newlyReady=null;
  for(const x of items){
    const id=String(x.id), progress=Number(x.progress)||0, previous=previousTorrentProgress.get(id);
    if(torrentQueueInitialSnapshotTaken && previous!==undefined && previous<threshold && progress>=threshold && x.playable && x.videoFileIndex!==null && !autoPlayedTorrentIds.has(id)){
      newlyReady=x;
    }
    previousTorrentProgress.set(id,progress);
  }
  torrentQueueInitialSnapshotTaken=true;
  // Render qBittorrent progress only inside the selected FileList category card; never show the global queue.
  const normListing=value=>String(value||'').split(/[\\/]/).pop().replace(/\.(mkv|mp4|avi|mov|webm|m4v|mpg|mpeg|wmv|torrent)$/i,'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
  document.querySelectorAll('.fl-result[data-listing-id]').forEach(card=>{
    const title=card.querySelector('.fl-result-title')?.textContent||'';
    const key=normListing(title);
    const panel=card.querySelector('.fl-inline-download'); if(!panel)return;
    const action=card.querySelector('.fl-result-action');
    // IMPORTANT: exact release matching only. Fuzzy title/token matching caused a
    // downloaded 480p release to mark unrelated 720p/1080p/4K releases as local.
    const match=items.find(x=>!x.localPath && normListing(x.title)===key) || items.find(x=>!x.localPath && normListing(String(x.title||'').replace(/\s*\[[^\]]+\]\s*$/,'').replace(/\s*\(\d{4}\)\s*$/,''))===key);
    const local=localMedia.find(m=>normListing(m.releaseFolder)===key || normListing(m.name)===key);
    // A file can exist on disk while qBittorrent is still writing it; do not
    // expose Play/Delete until the matching torrent reaches 100%.
    if(local && (!match || Number(match.progress)>=100)){
      panel.hidden=true;
      if(action){const playArg=JSON.stringify(local.path).replace(/&/g,'&amp;').replace(/</g,'&lt;');const folder=String(local.folder||'Movie').replace(/[^A-Za-z]/g,'');const name=String(local.name||'').replace(/'/g,'&#39;');action.innerHTML=`<button type="button" class="btn primary" onclick="event.stopPropagation();launchExternalPlayer(${playArg})">▶ Play</button><button type="button" class="btn" onclick="event.stopPropagation();deleteLocalMedia('${folder}','${name}',${JSON.stringify(local.path).replace(/&/g,'&amp;').replace(/</g,'&lt;')})">Delete</button>`;}
      card.dataset.downloading='false';return;
    }
    // An active qBittorrent row belongs to this card only when its complete
    // normalized release name matches exactly; never match by shared movie title.
    if(match){
      const pct=Math.max(0,Math.min(100,Number(match.progress)||0));
      const ready=Boolean(match.playable && match.videoFileIndex!==null && pct>=threshold);
      // Keep the live progress panel visible all the way to 100%, even after
      // playback unlocks. The threshold controls Play availability, not the bar.
      panel.hidden = pct >= 100;
      const bar=panel.querySelector('.fl-inline-bar');if(bar)bar.style.width=pct+'%';
      const pc=panel.querySelector('.fl-inline-percent');if(pc)pc.textContent=pct.toFixed(1)+'%';
      const st=panel.querySelector('.fl-inline-status');if(st)st.textContent=match.error||(pct>=100?'Download complete.':`Downloading · ${match.status||'qBittorrent'}…`);
      if(ready){
        if(action){const encoded=encodeURIComponent(match.title||title);action.innerHTML=`<button type="button" class="btn primary" onclick="event.stopPropagation();playTorrent('${String(match.id).replace(/'/g,'')}','', '${encoded}')">▶ Play</button><button type="button" class="btn" onclick="event.stopPropagation();deleteFileListRelease('${String(card.dataset.listingId||'').replace(/[^0-9]/g,'')}','${String(card.dataset.category||'').replace(/[^a-zA-Z0-9 _-]/g,'')}')">Delete</button>`;}
      } else {
        if(action)action.innerHTML='<button type="button" class="btn primary fl-download-button" disabled>Downloading…</button>';
      }
    } else if(card.dataset.downloading!=='true') {
      panel.hidden=true;
      if(action)action.innerHTML='<button type="button" class="btn primary fl-download-button" onclick="event.stopPropagation();selectFileListListing(this.closest(\'.fl-result\'))">↓ Download</button>';
    }
  });
  if(newlyReady && autoOpenEnabled()){rememberAutoPlayedTorrent(newlyReady.id);setTimeout(()=>playTorrent(String(newlyReady.id),'',encodeURIComponent(newlyReady.title||'Torrent video')),150);}
  el.innerHTML=''; /* qBittorrent queue is intentionally hidden; progress is shown in each selected FileList card. */
  /* el.innerHTML=items.length?items.map(x=>{const playable=x.playable&&x.videoFileIndex!==null;const progress=Math.max(0,Math.min(100,Number(x.progress)||0));const local=Boolean(x.localPath);const playButton=local?`<button class="btn primary" onclick="launchExternalPlayer(${JSON.stringify(x.localPath).replace(/&/g,'&amp;').replace(/</g,'&lt;')})">▶ Play</button>`:(playable?`<button class="btn primary" onclick="playTorrent('${escapeHtml(x.id)}','','${encodeURIComponent(x.title)}')">▶ Play</button>`:'');return `<div class="provider-row"><div style="min-width:0;flex:1"><strong>${escapeHtml(x.title)}</strong>${local?`<small style="display:block;margin-top:5px;color:var(--muted)">Already downloaded · ${escapeHtml(x.localFolder||'Movie/Series')}</small>`:`<div style="height:6px;background:#ffffff12;border-radius:9px;margin-top:10px;overflow:hidden"><div style="height:100%;width:${progress}%;background:var(--green);transition:width .3s"></div></div><small style="display:block;margin-top:5px;color:var(--muted)">${progress.toFixed(1)}%${x.error?' · '+escapeHtml(x.error):''}</small>`}</div><div class="actions">${playButton}${local?'':`<button class="btn" onclick="removeTorrent('${escapeHtml(x.id)}')">Delete</button>`}</div></div>`}).join(''):'<div class="api-status">No active downloads.</div>'; */
 }catch(e){/* Keep global qBittorrent details hidden; per-card action reports errors. */}
}
function startTorrentQueuePolling(){if(torrentPollTimer)clearInterval(torrentPollTimer);renderTorrentQueue();torrentPollTimer=setInterval(renderTorrentQueue,2000);}
async function saveTorrentProgress(player){const id=player.dataset.torrentId;if(!id||!Number.isFinite(player.currentTime))return;try{await api('/api/progress',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'torrent:'+id,seconds:player.currentTime,duration:player.duration})});}catch{}}

startTorrentQueuePolling();
refreshStorage();

