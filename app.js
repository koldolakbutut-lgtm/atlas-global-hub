/* ATLAS GLOBAL HUB — MVP prototype
   Pure frontend: no backend, no API keys, no credentials.
   Data sources: USGS (earthquakes), rss2json (BBC World + ANTARA news),
   Leaflet + OpenStreetMap (map).
*/
'use strict';

const CONFIG = {
  news: {
    feeds: {
      world: 'https://api.rss2json.com/v1/api.json?rss_url=' +
        encodeURIComponent('https://feeds.bbci.co.uk/news/world/rss.xml'),
      indonesia: 'https://api.rss2json.com/v1/api.json?rss_url=' +
        encodeURIComponent('https://www.antaranews.com/rss/terkini.xml'),
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
    items: { world: [], indonesia: [] },
    lastOk: { world: 0, indonesia: 0 },
    error: { world: null, indonesia: null },
  },
  quakes: { list: [], lastOk: 0, error: null },
  activeTab: 'world',
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

function sourceLabel(k) {
  return k === 'world' ? 'BBC World via rss2json' : 'ANTARA via rss2json';
}

async function loadNews(feedKey) {
  const data = await fetchJson(CONFIG.news.feeds[feedKey], CONFIG.news.timeoutMs);
  if (!data || data.status !== 'ok' || !Array.isArray(data.items)) {
    throw new Error('respons tidak valid');
  }
  const feedName = (data.feed && data.feed.title) ? String(data.feed.title) : feedKey;
  const seen = new Set();
  const items = [];
  for (const it of data.items) {
    const rawUrl = it && it.link ? String(it.link) : '';
    const title = it && it.title ? String(it.title).trim() : '';
    if (!title) continue;
    // security: only allow https: article URLs — reject javascript:, data:, etc.
    let parsed;
    try { parsed = new URL(rawUrl); } catch (e) { continue; }
    if (parsed.protocol !== 'https:') continue;
    const url = normalizeUrl(rawUrl);
    if (seen.has(url)) continue; // dedup by normalized URL
    seen.add(url);
    items.push({ title: title, url: rawUrl, date: it.pubDate || null, source: feedName });
    if (items.length >= CONFIG.news.maxItems) break;
  }
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

function renderNewsStatus() {
  const k = state.activeTab;
  const upd = document.getElementById('news-updated');
  const st = document.getElementById('news-status');
  if (state.news.lastOk[k]) {
    upd.textContent = 'diperbarui ' + fmtClock(state.news.lastOk[k]);
    if (state.news.error[k]) {
      st.textContent = 'Sumber: ' + sourceLabel(k) + ' · DATA TERAKHIR ' +
        fmtClock(state.news.lastOk[k]) + ' (upaya terakhir gagal: ' + state.news.error[k] + ')';
      st.className = 'source-status stale';
    } else {
      st.textContent = 'Sumber: ' + sourceLabel(k) + ' · OK';
      st.className = 'source-status ok';
    }
  } else {
    upd.textContent = 'belum ada data';
    st.textContent = 'Sumber: ' + sourceLabel(k) + ' · GAGAL (' +
      (state.news.error[k] || 'memuat…') + ')';
    st.className = 'source-status err';
  }
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
    });
  }
  out.sort(function (a, b) { return b.time - a.time; });
  return out;
}

function renderQuakes() {
  const list = document.getElementById('quake-list');
  list.replaceChildren();
  const qs = state.quakes.list;
  const sum = document.getElementById('quake-summary');
  sum.replaceChildren();
  sum.appendChild(el('span', 'quake-count', qs.length + ' gempa / 1 jam terakhir'));
  if (!qs.length) {
    list.appendChild(el('li', 'empty', 'Belum ada data gempa.'));
  } else {
    const shown = qs.slice(0, 20);
    for (const q of shown) {
      const li = el('li', 'quake-item');
      const badge = el('span', 'mag', 'M' + q.mag.toFixed(1));
      badge.style.background = magColor(q.mag);
      li.appendChild(badge);
      const wrap = el('div', 'quake-info');
      wrap.appendChild(el('div', 'quake-place', q.place));
      wrap.appendChild(el('div', 'quake-time', fmtTime(q.time)));
      li.appendChild(wrap);
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
  renderQuakes();
  renderMapMarkers();
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
  for (const q of state.quakes.list) {
    const m = L.circleMarker([q.lat, q.lng], {
      radius: 4 + q.mag * 2,
      color: magColor(q.mag),
      weight: 1,
      fillOpacity: 0.7,
    });
    // popup content is escaped — no raw HTML from remote data
    m.bindPopup('<b>M' + q.mag.toFixed(1) + '</b><br>' +
      escapeHtml(q.place) + '<br>' + escapeHtml(fmtTime(q.time)));
    m.addTo(state.quakeLayer);
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
  const btns = document.querySelectorAll('.tab');
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
  renderNews();
  renderQuakes();
  poll(function () { refreshNews('world'); }, CONFIG.news.refreshMs);
  poll(function () { refreshNews('indonesia'); }, CONFIG.news.refreshMs);
  poll(refreshQuakes, CONFIG.quake.refreshMs);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) {
      refreshNews('world');
      refreshNews('indonesia');
      refreshQuakes();
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
