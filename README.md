# ATLAS GLOBAL HUB

Dashboard pemantauan global — MVP: **Global News**, **Earthquake Monitor**, **Global Map**.

## Arsitektur

Static-first: HTML/CSS/JS murni. Tanpa backend, tanpa API key.

## Sumber data

- **Berita**: BBC World + ANTARA via [rss2json](https://rss2json.com) (tanpa key)
- **Gempa**: [USGS Earthquake Hazards Program](https://earthquake.usgs.gov) (feed GeoJSON per jam)
- **Peta**: [Leaflet](https://leafletjs.com) + © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (atribusi wajib)

## Deploy

Cloudflare Pages — hubungkan repo ini, build command kosong, output directory `/`.

## Struktur

- `index.html` — struktur dashboard
- `styles.css` — tema gelap
- `app.js` — fetch data, normalisasi, dedup URL, marker peta, indikator status jujur
