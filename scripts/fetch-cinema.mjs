#!/usr/bin/env node
/**
 * Fetches cinema showtimes (Apollo Kino, Kino Artis) and writes data/cinema.json.
 * The normalisation lives in assets/cinema-sources.js, shared with the browser, which
 * fetches the same APIs live when it can (they allow CORS). This file is the fallback.
 *
 * Note: both cinema sites block GitHub-hosted runners, so in CI this script usually fails
 * and keeps the previously committed file. Run it locally to refresh the fallback.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../assets/cinema-sources.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'cinema.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

async function getJSON(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(45000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (i === 2) { console.warn(`[cinema] ${url}: ${e.message}`); throw e; }
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

async function main() {
  const t0 = Date.now();
  const out = await globalThis.CinemaSources.fetchAll(getJSON, { days: 31 });
  for (const [k, s] of Object.entries(out.sources)) console.log(`[${k}] ${s.ok ? `${s.shows} showtimes, ${s.movies} films, ${s.cinemas} cinemas` : `FAILED: ${s.error || 'no shows'}`}`);

  // Never replace good data with an empty file (the sites block datacenter IPs).
  if (out.shows.length < 50) {
    console.error(`Only ${out.shows.length} showtimes fetched; keeping the existing data/cinema.json untouched.`);
    process.exit(1);
  }
  // If one source failed, keep its previous shows that are still in the future.
  const failed = Object.entries(out.sources).filter(([, s]) => !s.ok).map(([k]) => k);
  if (failed.length) {
    try {
      const prev = JSON.parse(await fs.readFile(OUT, 'utf8'));
      const today = new Date().toISOString().slice(0, 10);
      for (const [id, c] of Object.entries(prev.cinemas || {})) if (failed.includes(c.src)) out.cinemas[id] = c;
      for (const s of prev.shows || []) {
        if (failed.includes(prev.cinemas?.[s.c]?.src) && s.s >= today) { out.shows.push(s); if (prev.movies?.[s.m]) out.movies[s.m] = prev.movies[s.m]; }
      }
      out.shows.sort((a, b) => (a.s < b.s ? -1 : a.s > b.s ? 1 : 0));
      console.log(`Kept previous data for failed source(s): ${failed.join(', ')}`);
    } catch { /* no previous file */ }
  }
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(out));
  const kb = Math.round((await fs.stat(OUT)).size / 1024);
  const cities = {};
  for (const s of out.shows) { const c = out.cinemas[s.c]?.c || '?'; cities[c] = (cities[c] || 0) + 1; }
  console.log(`Wrote ${out.shows.length} showtimes, ${Object.keys(out.movies).length} films to data/cinema.json (${kb} KB) in ${((Date.now() - t0) / 1000).toFixed(1)}s`, cities);
}

main().catch((e) => { console.error(e); process.exit(1); });
