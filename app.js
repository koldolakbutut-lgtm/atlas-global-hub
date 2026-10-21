/* ATLAS GLOBAL HUB — MVP prototype
   Pure frontend: no backend, no API keys, no credentials.
   Data sources: USGS (earthquakes), rss2json (BBC World, ANTARA,
   BBC Technology, BBC Science & Environment news), Leaflet + OpenStreetMap (map).
   V2.5 AI & Technology Radar adds rss2json feeds for Hugging Face Blog,
   Google AI Blog and MIT News AI; its TECHNOLOGY tab reuses the V2.4 news
   technology state — BBC Technology is fetched exactly once.
*/
'use strict';

const CONFIG = {
  news: {
    feeds: {
      world: 'https://api.rss2json.com/v1/api.json?rss_url=' +
        encodeURIComponent('https://feeds.bbci.co.uk/news/world/rss.xml'),
      indonesia: 'https://api.rss2json.com/v1/api.json?rss_url=' +
        encodeURIComponent('https://www.antaranews.com/rss/terkini.xml'),
      technology: 'https://api.rss2json.com/v1/api.json?rss_url=' +
        encodeURIComponent('https://feeds.bbci.co.uk/news/technology/rss.xml'),
      science: 'https://api.rss2json.com/v1/api.json?rss_url=' +
        encodeURIComponent('https://feeds.bbci.co.uk/news/science_and_environment/rss.xml'),
    },
    refreshMs: 5 * 60 * 1000,
    maxItems: 10,
    timeoutMs: 15000,
  },
  radar: {
    feeds: {
      models: 'https://api.rss2json.com/v1/api.json?rss_url=' +
        encodeURIComponent('https://huggingface.co/blog/feed.xml'),
      tools: 'https://api.rss2json.com/v1/api.json?rss_url=' +
        encodeURIComponent('https://blog.google/innovation-and-ai/technology/ai/rss/'),
      research: 'https://api.rss2json.com/v1/api.json?rss_url=' +
        encodeURIComponent('https://news.mit.edu/rss/topic/artificial-intelligence2'),
    },
    refreshMs: 5 * 60 * 1000,
    maxItems: 10,
    timeoutMs: 15000,
  },
  quake: {
    url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson',
    refreshMs: 60 * 1000,
    timeoutMs: 15000,
  },
};

const state = {
  news: {
    items: { world: [], indonesia: [], technology: [], science: [] },
    lastOk: { world: 0, indonesia: 0, technology: 0, science: 0 },
    error: { world: null, indonesia: null, technology: null, science: null },
  },
  radar: {
    items: { models: [], tools: [], research: [] },
    lastOk: { models: 0, tools: 0, research: 0 },
    error: { models: null, tools: null, research: null },
  },
  quakes: { list: [], lastOk: 0, error: null },
  quakeFilter: { minMag: 0, query: '' },
  selectedQuakeId: null,
  markerById: {},
  activeTab: 'world',
  activeRadarTab: 'models',
  map: null,
  quakeLayer: null,
};

/* ---------------- helpers ---------------- */

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text; // textContent only — never innerHTML for remote data
  return n;
}

function fmtTime(ts) {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString('id-ID', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  } catch (e) { return '—'; }
}

function fmtClock(ts) {
  try {
    return new Date(ts).toLocaleTimeString('id-ID', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch (e) { return ''; }
}

function normalizeUrl(u) {
  try {
    const x = new URL(u);
    x.hash = '';
    return x.toString().toLowerCase();
  } catch (e) { return String(u || '').toLowerCase(); }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

async function fetchJson(url, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(function () { ctrl.abort(); }, timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } catch (err) {
    if (err && err.name === 'AbortError') throw new Error('timeout ' + timeoutMs + 'ms');
    throw err;
  } finally { clearTimeout(t); }
}

/* ---------------- news ---------------- */

const SOURCE_LABELS = {
  world: 'BBC World via rss2json',
  indonesia: 'ANTARA via rss2json',
  technology: 'BBC Technology via rss2json',
  science: 'BBC Science & Environment via rss2json',
};

function sourceLabel(k) {
  return SOURCE_LABELS[k] || (k + ' via rss2json');
}

/* Parse an rss2json payload into validated items. Shared by the news
   panel and the AI & Technology Radar so the security/validation rules
   (https-only links, dedup, title required, maxItems cap) can never drift
   between the two: only https: article URLs survive — javascript:, data:,
   http: etc. are rejected. Identical to the original news parser. */
function parseFeedItems(data, maxItems) {
  const feedName = (data.feed && data.feed.title) ? String(data.feed.title) : '';
  const seen = new Set();
  const items = [];
  for (const it of data.items) {
    const rawUrl = it && it.link ? String(it.link) : '';
    const title = it && it.title ? String(it.title).trim() : '';
    if (!title) continue;
    let parsed;
    try { parsed = new URL(rawUrl); } catch (e) { continue; }
    if (parsed.protocol !== 'https:') continue;
    const url = normalizeUrl(rawUrl);
    if (seen.has(url)) continue; // dedup by normalized URL
    seen.add(url);
    items.push({ title: title, url: rawUrl, date: it.pubDate || null, source: feedName });
    if (items.length >= maxItems) break;
  }
  return items;
}

async function fetchFeedItems(url, timeoutMs, maxItems) {
  const data = await fetchJson(url, timeoutMs);
  if (!data || data.status !== 'ok' || !Array.isArray(data.items)) {
    throw new Error('respons tidak valid');
  }
  return parseFeedItems(data, maxItems);
}

async function loadNews(feedKey) {
  const items = await fetchFeedItems(
    CONFIG.news.feeds[feedKey], CONFIG.news.timeoutMs, CONFIG.news.maxItems);
  if (!items.length) throw new Error('tidak ada item berita');
  return items;
}

function renderNews() {
  const list = document.getElementById('news-list');
  list.replaceChildren();
  const items = state.news.items[state.activeTab];
  if (!items.length) {
    list.appendChild(el('li', 'empty', 'Belum ada data berita.'));
    return;
  }
  for (const it of items) {
    const li = el('li', 'news-item');
    const a = el('a', 'news-title');
    a.textContent = it.title;
    a.href = it.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    li.appendChild(a);
    li.appendChild(el('div', 'news-meta', it.source + ' · ' + fmtTime(it.date)));
    list.appendChild(li);
  }
}

/* Shared per-source status presenter (LIVE / STALE / ERROR semantics).
   Used by BOTH the news panel and the Radar panel: the Radar TECHNOLOGY
   tab passes the news technology state through this exact function, so
   its health status can never disagree with the news panel's. */
function presentSourceStatus(updEl, stEl, label, lastOk, error) {
  if (!updEl || !stEl) return;
  if (lastOk) {
    updEl.textContent = 'diperbarui ' + fmtClock(lastOk);
    if (error) {
      stEl.textContent = 'Sumber: ' + label + ' · DATA TERAKHIR ' +
        fmtClock(lastOk) + ' (upaya terakhir gagal: ' + error + ')';
      stEl.className = 'source-status stale';
    } else {
      stEl.textContent = 'Sumber: ' + label + ' · OK';
      stEl.className = 'source-status ok';
    }
  } else {
    updEl.textContent = 'belum ada data';
    stEl.textContent = 'Sumber: ' + label + ' · GAGAL (' +
      (error || 'memuat…') + ')';
    stEl.className = 'source-status err';
  }
}

function renderNewsStatus() {
  const k = state.activeTab;
  presentSourceStatus(
    document.getElementById('news-updated'),
    document.getElementById('news-status'),
    sourceLabel(k), state.news.lastOk[k], state.news.error[k]);
  renderHeaderStatus();
}

async function refreshNews(feedKey) {
  try {
    const items = await loadNews(feedKey);
    state.news.items[feedKey] = items;
    state.news.lastOk[feedKey] = Date.now();
    state.news.error[feedKey] = null;
  } catch (err) {
    // keep last valid data; record error honestly
    state.news.error[feedKey] = (err && err.message) || 'gagal memuat';
  }
  if (feedKey === state.activeTab) renderNews();
  renderNewsStatus();
  renderOverview();
  renderRadar(); // V2.5: the Radar TECHNOLOGY tab mirrors this same state
}

/* ---------------- AI & Technology Radar (V2.5) ----------------
   Three NEW sources (AI MODELS / AI TOOLS / AI RESEARCH) follow the exact
   news pattern: per-source items/lastOk/error, https-only validated
   parsing (shared parseFeedItems), last-valid-data retention, and the
   shared status presenter (presentSourceStatus).
   The fourth tab, TECHNOLOGY, has NO feed of its own: it renders
   state.news.items.technology and reads its health from
   state.news.lastOk/error.technology — one BBC Technology fetch, one
   refresh cycle, one health status, mirrored exactly here. */

const RADAR_SOURCE_LABELS = {
  models: 'Hugging Face Blog via rss2json',
  tools: 'Google AI Blog via rss2json',
  research: 'MIT News via rss2json',
  technology: 'BBC Technology via rss2json',
};

function radarSourceLabel(k) {
  return RADAR_SOURCE_LABELS[k] || (k + ' via rss2json');
}

function radarItems(k) {
  return k === 'technology' ? state.news.items.technology : state.radar.items[k];
}
function radarLastOk(k) {
  return k === 'technology' ? state.news.lastOk.technology : state.radar.lastOk[k];
}
function radarError(k) {
  return k === 'technology' ? state.news.error.technology : state.radar.error[k];
}

async function loadRadar(feedKey) {
  const items = await fetchFeedItems(
    CONFIG.radar.feeds[feedKey], CONFIG.radar.timeoutMs, CONFIG.radar.maxItems);
  if (!items.length) throw new Error('tidak ada item radar');
  return items;
}

function renderRadarList(listEl, items, emptyText) {
  listEl.replaceChildren();
  if (!items.length) {
    listEl.appendChild(el('li', 'empty', emptyText));
    return;
  }
  for (const it of items) {
    const li = el('li', 'news-item');
    const a = el('a', 'news-title');
    a.textContent = it.title;
    a.href = it.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    li.appendChild(a);
    li.appendChild(el('div', 'news-meta', it.source + ' · ' + fmtTime(it.date)));
    listEl.appendChild(li);
  }
}

function renderRadarStatus() {
  const k = state.activeRadarTab;
  presentSourceStatus(
    document.getElementById('radar-updated'),
    document.getElementById('radar-status'),
    radarSourceLabel(k), radarLastOk(k), radarError(k));
}

function renderRadar() {
  const list = document.getElementById('radar-list');
  if (list) {
    renderRadarList(list, radarItems(state.activeRadarTab), 'Belum ada data radar.');
  }
  renderRadarStatus();
}

async function refreshRadar(feedKey) {
  try {
    const items = await loadRadar(feedKey);
    state.radar.items[feedKey] = items;
    state.radar.lastOk[feedKey] = Date.now();
    state.radar.error[feedKey] = null;
  } catch (err) {
    // keep last valid data; record error honestly
    state.radar.error[feedKey] = (err && err.message) || 'gagal memuat';
  }
  renderRadar();
}

function initRadarTabs() {
  const btns = document.querySelectorAll('.radar-tab');
  btns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      btns.forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      state.activeRadarTab = btn.dataset.rfeed;
      renderRadar();
    });
  });
}

/* ---------------- earthquakes ---------------- */

function magColor(m) {
  if (m >= 6) return '#ef4444';
  if (m >= 5) return '#f97316';
  if (m >= 4) return '#eab308';
  return '#22d3ee';
}

async function loadQuakes() {
  const data = await fetchJson(CONFIG.quake.url, CONFIG.quake.timeoutMs);
  const feats = Array.isArray(data.features) ? data.features : [];
  const out = [];
  for (const f of feats) {
    const p = f && f.properties;
    const g = f && f.geometry;
    if (!p || !g || !Array.isArray(g.coordinates)) continue;
    const lng = g.coordinates[0];
    const lat = g.coordinates[1];
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    if (p.mag == null || typeof p.mag !== 'number') continue;
    out.push({
      id: f.id || String(p.code || '') + String(p.time || ''),
      mag: p.mag,
      place: p.place || 'lokasi tidak diketahui',
      time: p.time || 0,
      lat: lat,
      lng: lng,
      url: p.url != null ? String(p.url) : null,
      depth: typeof g.coordinates[2] === 'number' ? g.coordinates[2] : null,
    });
  }
  out.sort(function (a, b) { return b.time - a.time; });
  return out;
}

/* ---- Earthquake Intelligence (V2.2) ----
   state.quakes.list is ALWAYS the raw feed; filtering derives a view
   from it and never mutates it, so Global Overview keeps raw numbers. */

function filterActive() {
  return state.quakeFilter.minMag > 0 || state.quakeFilter.query.trim() !== '';
}

function visibleQuakes() {
  const minMag = state.quakeFilter.minMag;
  const q = state.quakeFilter.query.trim().toLowerCase();
  return state.quakes.list.filter(function (item) {
    if (item.mag < minMag) return false;
    if (q && item.place.toLowerCase().indexOf(q) === -1) return false;
    return true;
  });
}

function findQuake(id) {
  if (id == null) return null;
  for (const q of state.quakes.list) {
    if (q.id === id) return q;
  }
  return null;
}

function validUsgsUrl(u) {
  if (!u) return null;
  try {
    const x = new URL(u);
    if (x.protocol !== 'https:') return null;
    if (x.hostname !== 'earthquake.usgs.gov') return null;
    return x.toString();
  } catch (e) { return null; }
}

function renderDetail() {
  const box = document.getElementById('quake-detail');
  if (!box) return;
  const q = findQuake(state.selectedQuakeId);
  if (!q) {
    box.hidden = true;
    box.replaceChildren();
    return;
  }
  box.hidden = false;
  box.replaceChildren();
  const head = el('div', 'qd-head');
  const badge = el('span', 'mag', 'M' + q.mag.toFixed(1));
  badge.style.background = magColor(q.mag);
  head.appendChild(badge);
  head.appendChild(el('span', 'qd-place', q.place));
  box.appendChild(head);
  const rows = [
    ['Magnitudo', 'M' + q.mag.toFixed(1)],
    ['Lokasi', q.place],
    ['Waktu', fmtTime(q.time)],
    ['Koordinat', q.lat.toFixed(3) + ', ' + q.lng.toFixed(3)],
    ['Kedalaman', typeof q.depth === 'number' ? String(q.depth) + ' km' : 'tidak tersedia'],
  ];
  for (const pair of rows) {
    const row = el('div', 'qd-row');
    row.appendChild(el('span', 'qd-key', pair[0]));
    row.appendChild(el('span', 'qd-val', pair[1]));
    box.appendChild(row);
  }
  const url = validUsgsUrl(q.url);
  if (url) {
    const a = el('a', 'qd-link', 'Detail resmi USGS');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    box.appendChild(a);
  }
}

function refreshSelectionClasses() {
  const items = document.querySelectorAll('#quake-list .quake-item');
  items.forEach(function (li) {
    li.classList.toggle('selected', li.dataset.quakeId === state.selectedQuakeId);
  });
}

function centerMapOnQuake(id) {
  // Map trouble must never disturb the panel — fully isolated.
  try {
    if (!state.map) return;
    const q = findQuake(id);
    const marker = state.markerById ? state.markerById[id] : null;
    if (!q || !marker) return;
    state.map.setView([q.lat, q.lng], Math.max(state.map.getZoom(), 5));
    marker.openPopup();
  } catch (e) { /* map failure stays inside the map */ }
}

function selectQuake(id, center) {
  state.selectedQuakeId = id;
  refreshSelectionClasses();
  renderDetail();
  if (center) centerMapOnQuake(id);
}

function renderQuakes() {
  const list = document.getElementById('quake-list');
  list.replaceChildren();
  const raw = state.quakes.list;
  const vis = visibleQuakes();
  const active = filterActive();
  const sum = document.getElementById('quake-summary');
  sum.replaceChildren();
  sum.appendChild(el('span', 'quake-count', raw.length + ' gempa / 1 jam terakhir'));
  const rc = document.getElementById('quake-result-count');
  if (rc) {
    if (active) {
      rc.hidden = false;
      rc.textContent = 'Menampilkan ' + vis.length + ' dari ' + raw.length + ' gempa';
    } else {
      rc.hidden = true;
      rc.textContent = '';
    }
  }
  if (!raw.length) {
    list.appendChild(el('li', 'empty', 'Belum ada data gempa.'));
  } else if (!vis.length) {
    list.appendChild(el('li', 'empty', 'Tidak ada gempa yang cocok dengan filter'));
  } else {
    // MVP behaviour kept: the 20-item cap applies only with no filter active,
    // so a filtered list stays exactly in sync with the map markers.
    const shown = active ? vis : vis.slice(0, 20);
    for (const q of shown) {
      const li = el('li', 'quake-item');
      li.dataset.quakeId = q.id;
      if (q.id === state.selectedQuakeId) li.classList.add('selected');
      const badge = el('span', 'mag', 'M' + q.mag.toFixed(1));
      badge.style.background = magColor(q.mag);
      li.appendChild(badge);
      const wrap = el('div', 'quake-info');
      wrap.appendChild(el('div', 'quake-place', q.place));
      wrap.appendChild(el('div', 'quake-time', fmtTime(q.time)));
      li.appendChild(wrap);
      li.addEventListener('click', function () { selectQuake(q.id, true); });
      list.appendChild(li);
    }
  }
  const upd = document.getElementById('quake-updated');
  const st = document.getElementById('quake-status');
  if (state.quakes.lastOk) {
    upd.textContent = 'diperbarui ' + fmtClock(state.quakes.lastOk);
    if (state.quakes.error) {
      st.textContent = 'Sumber: USGS · DATA TERAKHIR ' + fmtClock(state.quakes.lastOk) +
        ' (upaya terakhir gagal)';
      st.className = 'source-status stale';
    } else {
      st.textContent = 'Sumber: USGS · OK';
      st.className = 'source-status ok';
    }
  } else {
    upd.textContent = 'belum ada data';
    st.textContent = 'Sumber: USGS · GAGAL (' + (state.quakes.error || 'memuat…') + ')';
    st.className = 'source-status err';
  }
  renderHeaderStatus();
  renderDetail();
}

async function refreshQuakes() {
  try {
    const qs = await loadQuakes();
    state.quakes.list = qs;
    state.quakes.lastOk = Date.now();
    state.quakes.error = null;
  } catch (err) {
    state.quakes.error = (err && err.message) || 'gagal memuat';
  }
  // A selected quake that left the feed clears the detail panel.
  if (state.selectedQuakeId != null && !findQuake(state.selectedQuakeId)) {
    state.selectedQuakeId = null;
  }
  renderQuakes();
  renderMapMarkers();
  renderOverview();
}

/* ---------------- map ---------------- */

function mapFallback(msg) {
  state.mapFailed = true;
  state.map = null;
  state.quakeLayer = null;
  const mapEl = document.getElementById('map');
  if (mapEl) {
    mapEl.replaceChildren();
    mapEl.appendChild(el('div', 'map-fallback', msg));
  }
}

function initMap() {
  // Leaflet is optional: news + quake monitor must survive a CDN failure
  if (typeof window.L === 'undefined') {
    mapFallback('Peta tidak dapat dimuat (Leaflet gagal dimuat). Data berita dan monitor gempa tetap tersedia.');
    return;
  }
  try {
    state.map = window.L.map('map', { worldCopyJump: true }).setView([0, 115], 2);
    window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(state.map);
    state.quakeLayer = window.L.layerGroup().addTo(state.map);
  } catch (err) {
    mapFallback('Peta tidak dapat dimuat. Data berita dan monitor gempa tetap tersedia.');
  }
}

function renderMapMarkers() {
  if (!state.quakeLayer) return;
  state.quakeLayer.clearLayers(); // no duplicate markers on update
  state.markerById = {};
  for (const q of visibleQuakes()) {
    const m = L.circleMarker([q.lat, q.lng], {
      radius: 4 + q.mag * 2,
      color: magColor(q.mag),
      weight: 1,
      fillOpacity: 0.7,
    });
    // popup content is escaped — no raw HTML from remote data.
    // The USGS link reuses the V2.2 validation helper (validUsgsUrl):
    // only a validated https earthquake.usgs.gov URL is ever rendered.
    let popupHtml = '<b>M' + q.mag.toFixed(1) + '</b><br>' +
      escapeHtml(q.place) + '<br>' + escapeHtml(fmtTime(q.time));
    const usgsUrl = validUsgsUrl(q.url);
    if (usgsUrl) {
      popupHtml += '<br><a href="' + escapeHtml(usgsUrl) +
        '" target="_blank" rel="noopener noreferrer">Detail resmi USGS</a>';
    }
    m.bindPopup(popupHtml);
    // Clicking a marker selects the same quake by ID (detail panel + list
    // highlight). Markers are NOT re-rendered here, so the popup Leaflet
    // opens for this click stays open and undisturbed.
    m.on('click', function () { selectQuake(q.id, false); });
    m.addTo(state.quakeLayer);
    state.markerById[q.id] = m;
  }
}

/* ---------------- header status ---------------- */

function renderHeaderStatus() {
  const dot = document.getElementById('status-dot');
  const txt = document.getElementById('status-text');
  const newsOk = state.news.lastOk.world || state.news.lastOk.indonesia;
  const quakeOk = state.quakes.lastOk;
  const newsErr = state.news.error.world || state.news.error.indonesia;
  const quakeErr = state.quakes.error;
  if ((newsOk && quakeOk) && !newsErr && !quakeErr) {
    dot.className = 'dot live';
    txt.textContent = 'ONLINE';
  } else if (newsOk || quakeOk) {
    dot.className = 'dot degraded';
    txt.textContent = 'TERBATAS';
  } else {
    dot.className = 'dot offline';
    txt.textContent = 'OFFLINE';
  }
}

/* ---------------- global overview (V2.1) ----------------
   Purely additive: every number and status below is derived from the
   state the MVP fetchers already maintain. No new network requests.
   An empty-but-successful quake feed is LIVE with count 0, not an error. */

function sourceState(lastOk, error) {
  if (lastOk) return error ? 'stale' : 'live';
  if (error) return 'error';
  return 'loading';
}

function setOverviewChip(id, st) {
  const chip = document.getElementById(id);
  if (!chip) return;
  chip.className = 'chip ' + st;
  chip.textContent =
    st === 'live' ? 'LIVE' :
    st === 'stale' ? 'STALE' :
    st === 'error' ? 'ERROR' : 'MEMUAT';
}

function renderOverview() {
  // Isolated on purpose: an overview bug must never stop the MVP panels.
  try {
    const setText = function (id, txt) {
      const n = document.getElementById(id);
      if (n) n.textContent = txt;
    };
    const qs = state.quakes.list;
    setText('ov-quakes', String(qs.length));
    let maxMag = null;
    for (const q of qs) {
      if (maxMag === null || q.mag > maxMag) maxMag = q.mag;
    }
    setText('ov-maxmag', maxMag === null ? '—' : 'M' + maxMag.toFixed(1));
    setText('ov-bbc', String(state.news.items.world.length));
    setText('ov-antara', String(state.news.items.indonesia.length));
    const feeds = [
      { key: 'world', chip: 'ov-status-bbc', upd: 'ov-updated-bbc' },
      { key: 'indonesia', chip: 'ov-status-antara', upd: 'ov-updated-antara' },
    ];
    for (const f of feeds) {
      setOverviewChip(f.chip, sourceState(state.news.lastOk[f.key], state.news.error[f.key]));
      setText(f.upd, state.news.lastOk[f.key]
        ? 'diperbarui ' + fmtClock(state.news.lastOk[f.key]) : '');
    }
    setOverviewChip('ov-status-usgs', sourceState(state.quakes.lastOk, state.quakes.error));
    setText('ov-updated-usgs', state.quakes.lastOk
      ? 'diperbarui ' + fmtClock(state.quakes.lastOk) : '');
  } catch (e) { /* overview failure stays inside the overview */ }
}

/* ---------------- clock, tabs, polling ---------------- */

function startClock() {
  const c = document.getElementById('clock');
  function update() {
    try {
      c.textContent = new Date().toLocaleString('id-ID', {
        weekday: 'short', day: 'numeric', month: 'short',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      });
    } catch (e) { c.textContent = ''; }
  }
  update();
  setInterval(update, 1000);
}

function initTabs() {
  const btns = document.querySelectorAll('.tab[data-feed]');
  btns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      btns.forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      state.activeTab = btn.dataset.feed;
      renderNews();
      renderNewsStatus();
    });
  });
}

function initQuakeControls() {
  const sel = document.getElementById('quake-minmag');
  const inp = document.getElementById('quake-search');
  const btn = document.getElementById('quake-reset');
  function apply() {
    renderQuakes();
    renderMapMarkers();
  }
  if (sel) {
    sel.addEventListener('change', function () {
      state.quakeFilter.minMag = Number(sel.value) || 0;
      apply();
    });
  }
  if (inp) {
    inp.addEventListener('input', function () {
      state.quakeFilter.query = inp.value;
      apply();
    });
  }
  if (btn) {
    btn.addEventListener('click', function () {
      state.quakeFilter.minMag = 0;
      state.quakeFilter.query = '';
      if (sel) sel.value = '0';
      if (inp) inp.value = '';
      apply();
    });
  }
}

function poll(fn, ms) {
  fn(); // immediate first load
  setInterval(function () {
    if (!document.hidden) fn(); // pause when tab inactive
  }, ms);
}

function init() {
  initMap();
  startClock();
  initTabs();
  initRadarTabs();
  initQuakeControls();
  renderNews();
  renderRadar();
  renderQuakes();
  renderOverview();
  // One poller per configured feed: a full refresh cycle is exactly one
  // request per feed (4 news) + one quake request — no feed is fetched twice.
  const feedKeys = Object.keys(CONFIG.news.feeds);
  for (const k of feedKeys) {
    poll(function () { refreshNews(k); }, CONFIG.news.refreshMs);
  }
  // V2.5 Radar feeds join the SAME polling pattern (5-minute refresh).
  // BBC Technology is NOT polled again here — the Radar TECHNOLOGY tab
  // mirrors the news technology state fed by the poller above.
  const radarKeys = Object.keys(CONFIG.radar.feeds);
  for (const k of radarKeys) {
    poll(function () { refreshRadar(k); }, CONFIG.radar.refreshMs);
  }
  poll(refreshQuakes, CONFIG.quake.refreshMs);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) {
      for (const k of feedKeys) refreshNews(k);
      for (const k of radarKeys) refreshRadar(k);
      refreshQuakes();
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
