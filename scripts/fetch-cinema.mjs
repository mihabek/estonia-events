#!/usr/bin/env node
/**
 * Fetches cinema showtimes and writes data/cinema.json.
 *
 * Both sources run the same Markus Cinema web platform and expose the same public JSON:
 *   - Apollo Kino (all cinemas in Estonia)  https://www.apollokino.ee/xml/Schedule/
 *   - Kino Artis (Tallinn, Solaris)          https://www.kino.ee/xml/Schedule/
 *
 * Output shape (compact):
 * {
 *   generatedAt, sources,
 *   cinemas: { "<id>": { n: name, c: city, src } },
 *   movies:  { "<id>": { t, ot, y, len, r, g: [genres], img, u, syn, dir, trailer, ty } },
 *   shows:   [ { m: movieId, c: cinemaId, s: "YYYY-MM-DDTHH:mm", l: spoken, sub: [subs], f: "2D"|"3D", x: extra, u: ticketUrl } ]
 * }
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'cinema.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const DAYS = 31;

const SOURCES = [
  { key: 'apollo', base: 'https://www.apollokino.ee', label: 'Apollo Kino' },
  { key: 'artis', base: 'https://www.kino.ee', label: 'Kino Artis', defaultCity: 'Tallinn' },
];

async function getJSON(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(45000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (i === 2) throw e;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const truncate = (s, n) => (s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + '…' : s);
const https = (u) => (u ? String(u).replace(/^http:\/\//, 'https://') : null);

/** Fetch one Markus-platform cinema site: every "all cinemas of city" area, or the default area. */
async function fetchMarkus({ key, base, defaultCity }) {
  const [areas, events] = await Promise.all([
    getJSON(`${base}/xml/TheatreAreas/`).catch(() => []),
    getJSON(`${base}/xml/Events/`).catch(() => []),
  ]);
  // Areas look like "Tallinn - Apollo Kino Solaris" or "Tallinn - Kõik kinod" (all cinemas of the city).
  const cityByTheatre = {};
  const cityAreas = [];
  for (const a of areas) {
    const m = String(a.Name).match(/^(.+?)\s*-\s*(.+)$/);
    if (!m) continue;
    if (/Kõik kinod|All cinemas/i.test(m[2])) cityAreas.push({ id: a.ID, city: m[1].trim() });
    else cityByTheatre[m[2].trim()] = m[1].trim();
  }
  // Cities that have a single cinema have no "all cinemas" area: use the cinema's own area.
  const coveredCities = new Set(cityAreas.map((a) => a.city));
  for (const a of areas) {
    const m = String(a.Name).match(/^(.+?)\s*-\s*(.+)$/);
    if (m && !/Kõik kinod|All cinemas/i.test(m[2]) && !coveredCities.has(m[1].trim())) {
      cityAreas.push({ id: a.ID, city: m[1].trim() });
      coveredCities.add(m[1].trim());
    }
  }
  const queries = cityAreas.length ? cityAreas.map((a) => `${base}/xml/Schedule/?area=${a.id}&nrOfDays=${DAYS}`) : [`${base}/xml/Schedule/?nrOfDays=${DAYS}`];
  const schedules = await Promise.all(queries.map((u) => getJSON(u).catch((e) => { console.warn(`[${key}] ${u}: ${e.message}`); return { Shows: [] }; })));

  const eventById = new Map((Array.isArray(events) ? events : events.Events || []).map((e) => [e.ID, e]));
  const cinemas = {};
  const movies = {};
  const shows = [];
  const seen = new Set();
  for (const sched of schedules) {
    for (const s of sched.Shows || []) {
      if (seen.has(s.ID)) continue;
      seen.add(s.ID);
      const cid = `${key}-${s.TheatreID}`;
      cinemas[cid] ||= { n: s.Theatre, c: cityByTheatre[s.Theatre] || defaultCity || null, src: key };
      const mid = `${key}-${s.EventID}`;
      if (!movies[mid]) {
        const ev = eventById.get(s.EventID) || {};
        movies[mid] = {
          t: s.Title,
          ot: s.OriginalTitle && s.OriginalTitle !== s.Title ? s.OriginalTitle : null,
          y: s.ProductionYear || ev.ProductionYear || null,
          len: s.LengthInMinutes || ev.LengthInMinutes || null,
          r: s.RatingLabel || s.Rating || null,
          g: String(s.Genres || ev.Genres || '').split(',').map((x) => x.trim()).filter(Boolean),
          img: https(s.Images?.EventMediumImagePortrait || ev.Images?.EventMediumImagePortrait || null),
          u: s.EventURL || ev.EventURL || null,
          syn: truncate(strip(ev.ShortSynopsis || ev.Synopsis || ''), 260),
          dir: (ev.Directors || []).map((d) => `${d.FirstName || ''} ${d.LastName || ''}`.trim()).filter(Boolean).slice(0, 2),
          trailer: (ev.Videos || []).find((v) => v.MediaResourceFormat === 'YouTubeVideo')?.Location || null,
          ty: s.EventType && s.EventType !== 'Movie' ? s.EventType : null,
        };
      }
      shows.push({
        m: mid,
        c: cid,
        s: String(s.dttmShowStart).slice(0, 16),
        l: s.SpokenLanguage?.ISOTwoLetterCode || null,
        sub: [s.SubtitleLanguage1?.ISOTwoLetterCode, s.SubtitleLanguage2?.ISOTwoLetterCode].filter(Boolean),
        f: s.PresentationMethod || null,
        x: s.EventSeries || null,
        u: s.ShowURL || null,
      });
    }
  }
  return { cinemas, movies, shows };
}

async function main() {
  const t0 = Date.now();
  const sources = {};
  const out = { generatedAt: new Date().toISOString(), sources, cinemas: {}, movies: {}, shows: [] };
  await Promise.all(SOURCES.map(async (src) => {
    try {
      const r = await fetchMarkus(src);
      Object.assign(out.cinemas, r.cinemas);
      Object.assign(out.movies, r.movies);
      out.shows.push(...r.shows);
      sources[src.key] = { ok: true, label: src.label, shows: r.shows.length, movies: Object.keys(r.movies).length, cinemas: Object.keys(r.cinemas).length };
      console.log(`[${src.key}] ${r.shows.length} showtimes, ${Object.keys(r.movies).length} films, ${Object.keys(r.cinemas).length} cinemas`);
    } catch (e) {
      sources[src.key] = { ok: false, label: src.label, error: String(e.message || e) };
      console.error(`[${src.key}] FAILED: ${e.message}`);
    }
  }));
  out.shows.sort((a, b) => (a.s < b.s ? -1 : a.s > b.s ? 1 : 0));
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(out));
  const kb = Math.round((await fs.stat(OUT)).size / 1024);
  const cities = {};
  for (const s of out.shows) { const c = out.cinemas[s.c]?.c || '?'; cities[c] = (cities[c] || 0) + 1; }
  console.log(`Wrote ${out.shows.length} showtimes to data/cinema.json (${kb} KB) in ${((Date.now() - t0) / 1000).toFixed(1)}s`, cities);
  if (!Object.values(sources).some((s) => s.ok)) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
