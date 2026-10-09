#!/usr/bin/env node
/**
 * Fetches events from several Estonian sources, normalises them into one
 * schema, de-duplicates and writes data/events.json.
 *
 * Sources:
 *   - Piletilevi          https://www.piletilevi.ee/api/v1/events       (public JSON API)
 *   - Fienta              https://fienta.com/api/v1/public/events       (documented public API)
 *   - Tartu Kultuuriaken  https://kultuuriaken.tartu.ee/api/events      (public JSON API)
 *   - Eventbrite          https://www.eventbrite.com/d/estonia/events/  (schema.org JSON-LD in HTML)
 *   - Meetup              https://www.meetup.com/find/?location=ee--…   (Next.js page data)
 *
 * No dependencies. Node 20+.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const CACHE_DIR = path.join(DATA_DIR, 'cache');
const OUT_FILE = path.join(DATA_DIR, 'events.json');
const TZ = 'Europe/Tallinn';
const UA = 'Mozilla/5.0 (compatible; EstoniaEventsBot/1.0; +https://github.com/)';

const NOW = new Date();
const DAY = 86400000;
const WINDOW_START = new Date(NOW.getTime() - 1 * DAY);
const WINDOW_END = new Date(NOW.getTime() + 400 * DAY);
const DESCRIPTION_MAX = 320;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithRetry(url, init = {}, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { 'user-agent': UA, accept: 'application/json, text/html;q=0.9, */*;q=0.8', ...(init.headers || {}) },
        signal: AbortSignal.timeout(45000),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (e) {
      lastErr = e;
      await sleep(800 * (i + 1));
    }
  }
  throw lastErr;
}

async function getJSON(url, init) {
  const res = await fetchWithRetry(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function getText(url, init) {
  const res = await fetchWithRetry(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    }),
  );
  return out;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", laquo: '«', raquo: '»', ndash: '–', mdash: '—', hellip: '…' };
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function stripHtml(html) {
  if (!html) return '';
  return decodeEntities(
    String(html)
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(p|div|li|h\d|tr)>/gi, ' ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(s, n = DESCRIPTION_MAX) {
  if (!s) return '';
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const sp = cut.lastIndexOf(' ');
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut) + '…';
}

/** Format a Date as local wall-clock time in Europe/Tallinn: "YYYY-MM-DDTHH:mm". */
const tzFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
function toLocal(date) {
  if (!date || Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(tzFmt.formatToParts(date).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** "2026-10-16 19:00:00" (already Tallinn wall time) -> "2026-10-16T19:00" */
function localFromNaive(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  if (m) return `${m[1]}T${m[2]}`;
  const d = String(s).match(/^(\d{4}-\d{2}-\d{2})$/);
  return d ? d[1] : null;
}

/** Convert a local wall-clock string back to a Date (approximate, for window checks). */
function localToDate(s) {
  if (!s) return null;
  return new Date(s.length === 10 ? `${s}T12:00:00+03:00` : `${s}:00+02:00`);
}

function slugKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[«»"'„“”’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .slice(0, 60);
}

// ---------------------------------------------------------------------------
// Taxonomy
// ---------------------------------------------------------------------------

export const CATEGORIES = [
  'music', 'theatre', 'comedy', 'exhibition', 'film', 'lecture', 'party', 'family',
  'sport', 'festival', 'food', 'dance', 'community', 'business', 'tour', 'market', 'other',
];

const CAT_EXACT = {
  // Piletilevi keys
  theatre: 'theatre', drama: 'theatre', puppet_theater: 'theatre', musical: 'theatre', performance: 'theatre',
  summerplay: 'theatre', opera_and_operetta: 'theatre', ballet: 'dance', show: 'theatre', circus: 'family',
  comedy: 'comedy', crime_comedy: 'comedy', stand_up_comedy: 'comedy', standup: 'comedy',
  exhibition: 'exhibition', museums: 'exhibition', muuseum: 'exhibition', museum: 'exhibition', art: 'exhibition',
  excursions: 'tour', excursion: 'tour', tour: 'tour', tours: 'tour',
  music: 'music', classical: 'music', rock: 'music', jazz_and_blues: 'music', jazz: 'music', pop: 'music',
  concert: 'music', concerts: 'music', folk: 'music', metal: 'music', electronic: 'party', hiphop: 'music',
  festival: 'festival', festivals: 'festival',
  sports: 'sport', sport: 'sport', football: 'sport', basketball: 'sport', hockey: 'sport', fitness: 'sport',
  food_and_drink: 'food', food: 'food', drinks: 'food', wine: 'food',
  dance: 'dance',
  lecture: 'lecture', lectures: 'lecture', education: 'lecture', course: 'lecture', courses: 'lecture',
  workshop: 'lecture', workshops: 'lecture', training: 'lecture', seminar: 'lecture', conference: 'business',
  business: 'business', networking: 'business', tech: 'business', technology: 'business',
  family: 'family', children: 'family', kids: 'family',
  party: 'party', club: 'party', nightlife: 'party', clubbing: 'party',
  cinema: 'film', film: 'film', movie: 'film',
  market: 'market', fair: 'market',
  spirituality: 'community', wellness: 'community', health: 'community', charity: 'community', community: 'community',
  various: 'other', other: 'other',
  // Tartu Kultuuriaken (Estonian)
  'näitus/muuseum': 'exhibition', kogukond: 'community', muu: 'other', koolitus: 'lecture', koolivaheaeg: 'family',
  teater: 'theatre', rahvakultuur: 'community', muusika: 'music', loodus: 'tour', 'pidu/klubi': 'party', toit: 'food',
  'mess/laat': 'market', kirjandus: 'lecture', 'noortepealinn tartu': 'community', tants: 'dance',
  // more Piletilevi keys
  poff: 'film', documentary: 'film', monoplay: 'theatre', christmas: 'family', biathlon: 'sport', martial_arts: 'sport',
  boxing: 'sport', icehockey: 'sport', exercise: 'sport', adventure: 'tour', heavy: 'music', traditional: 'music',
  meditative: 'community', hingele: 'community', beauty: 'other', ukraine: 'community', gift_card: 'other',
};

/** Things that are sold as "events" but are not: gift cards, recordings, e-books. */
const NOT_AN_EVENT = /kinkepilet|kinkekaart|gift ?card|подарочн|в записи|\bebook\b|e-raamat|salvestus|recording\b/i;

const CAT_RULES = [
  [/theat|teater|drama|opera|operet|musical|stage|lavastus|spektakl|театр/i, 'theatre'],
  [/comedy|stand.?up|komöödia|комеди|юмор|huumor/i, 'comedy'],
  [/exhib|museum|muuseum|näitus|gallery|galerii|выстав|музей/i, 'exhibition'],
  [/film|cinema|kino|movie|кино|фильм/i, 'film'],
  [/lectur|loeng|talk|course|kursus|koolitus|workshop|töötuba|seminar|лекци|курс|мастер/i, 'lecture'],
  [/party|club|pidu|klubi|dj|rave|techno|вечерин|клуб/i, 'party'],
  [/family|kids|child|laste|pere|детск|семей/i, 'family'],
  [/sport|run|jooks|yoga|jooga|fitness|спорт|йога/i, 'sport'],
  [/festival|фестивал/i, 'festival'],
  [/food|drink|toit|söök|wine|vein|beer|õlu|еда|вино|гастро/i, 'food'],
  [/dance|tants|ballet|танц|балет/i, 'dance'],
  [/conference|business|network|äri|startup|конферен|бизнес/i, 'business'],
  [/tour|excurs|ekskurs|matk|hike|walk|экскурс|поход/i, 'tour'],
  [/market|fair|laat|mess|turg|ярмарк|рынок/i, 'market'],
  [/music|muusika|concert|kontsert|jazz|rock|pop|choir|koor|orchestr|orkest|музык|концерт|rock|metal|rap|hip/i, 'music'],
  [/community|kogukond|meetup|social|charity|volunteer|сообщест/i, 'community'],
];

const unknownCategoryKeys = new Map();

function mapCategory(key) {
  if (!key) return null;
  const k = String(key).toLowerCase().trim();
  if (CAT_EXACT[k]) return CAT_EXACT[k];
  for (const [re, cat] of CAT_RULES) if (re.test(k)) return cat;
  unknownCategoryKeys.set(k, (unknownCategoryKeys.get(k) || 0) + 1);
  return null;
}

function categoriesFrom(keys, fallbackText = '') {
  const set = new Set();
  for (const k of keys || []) {
    const c = mapCategory(k);
    if (c) set.add(c);
  }
  if (set.size === 0 && fallbackText) {
    for (const [re, cat] of CAT_RULES) {
      if (re.test(fallbackText)) { set.add(cat); break; }
    }
  }
  if (set.size === 0) set.add('other');
  // "other" only when nothing else matched
  if (set.size > 1) set.delete('other');
  return [...set];
}

// ---------------------------------------------------------------------------
// Language detection (which languages the event text appears in)
// ---------------------------------------------------------------------------

const ET_WORDS = /\b(ja|ning|on|ei|kui|mis|ka|või|oma|see|kes|ning|kõik|üks|kaks|kell|tasuta|pilet|piletid|kontsert|etendus|lastele|õhtu|näitus|loeng|töötuba|algus|toimub|koos|iga|meie|teie|saab|olla|ole|ole|ära|seda|selle|kus|nii|veel|aga|siis|ainult|uus|päev|nädal|kuu|aasta)\b/gi;
const EN_WORDS = /\b(the|and|of|with|for|you|your|is|are|this|that|will|from|our|all|free|tickets?|event|evening|night|join|us|we|at|in|on|to|by|about|more|new|day|week|year|music|live|show|party|talk|how|what|who)\b/gi;
const RU_WORDS = /[а-яё]{3,}/gi;

function detectLangs(text, fallback = 'et') {
  const t = (text || '').slice(0, 1500);
  const letters = t.match(/\p{L}/gu)?.length || 1;
  const cyr = (t.match(/[а-яёА-ЯЁ]/g) || []).length;
  const et = (t.match(ET_WORDS) || []).length;
  const en = (t.match(EN_WORDS) || []).length;
  const ru = (t.match(RU_WORDS) || []).length;
  const langs = [];
  if (cyr / letters > 0.15 || ru >= 3) langs.push('ru');
  const latinWords = (t.match(/\b[a-zõäöüšž]{2,}\b/gi) || []).length || 1;
  const etScore = et / latinWords;
  const enScore = en / latinWords;
  const hasEtChars = /[õäöü]/i.test(t);
  if (etScore >= 0.08 || (hasEtChars && etScore >= 0.03 && enScore < 0.12)) langs.push('et');
  if (enScore >= 0.1 || (!langs.length && en >= 2 && enScore > etScore)) langs.push('en');
  if (!langs.length) langs.push(hasEtChars ? 'et' : (en >= 1 && et === 0 ? 'en' : fallback));
  return langs;
}

// ---------------------------------------------------------------------------
// City / county normalisation
// ---------------------------------------------------------------------------

const CITY_ALIASES = {
  tallinn: 'Tallinn', таллинн: 'Tallinn', таллин: 'Tallinn', tallinna: 'Tallinn',
  tartu: 'Tartu', тарту: 'Tartu',
  pärnu: 'Pärnu', parnu: 'Pärnu', пярну: 'Pärnu',
  narva: 'Narva', нарва: 'Narva',
  'kohtla-järve': 'Kohtla-Järve', jõhvi: 'Jõhvi', viljandi: 'Viljandi', rakvere: 'Rakvere', haapsalu: 'Haapsalu',
  kuressaare: 'Kuressaare', võru: 'Võru', valga: 'Valga', paide: 'Paide', keila: 'Keila', maardu: 'Maardu',
  sillamäe: 'Sillamäe', rapla: 'Rapla', jõgeva: 'Jõgeva', põlva: 'Põlva', kärdla: 'Kärdla', elva: 'Elva',
  saue: 'Saue', tapa: 'Tapa', otepää: 'Otepää', türi: 'Türi', põltsamaa: 'Põltsamaa', viimsi: 'Viimsi',
};

function normCity(s) {
  if (!s) return null;
  const k = String(s).trim().toLowerCase().replace(/\s+linn$/, '');
  return CITY_ALIASES[k] || String(s).trim();
}

/** Extract city + county from a Fienta/Google style address. */
function parseAddress(addr) {
  if (!addr) return {};
  const m = addr.match(/(\d{5})\s+([^,]+?),\s*([^,]+maakond)/i);
  if (m) return { city: normCity(m[2]), county: m[3].trim() };
  const m2 = addr.match(/,\s*([^,\d]+?),\s*([^,]+maakond)/i);
  if (m2) return { city: normCity(m2[1]), county: m2[2].trim() };
  const known = Object.keys(CITY_ALIASES).find((c) => new RegExp(`\\b${c}\\b`, 'i').test(addr));
  return known ? { city: CITY_ALIASES[known] } : {};
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

const sourceStats = {};

async function withStats(name, fn) {
  const t0 = Date.now();
  try {
    const events = await fn();
    sourceStats[name] = { ok: true, count: events.length, ms: Date.now() - t0 };
    console.log(`[${name}] ${events.length} events in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    return events;
  } catch (e) {
    sourceStats[name] = { ok: false, count: 0, error: String(e.message || e), ms: Date.now() - t0 };
    console.error(`[${name}] FAILED: ${e.message || e}`);
    return [];
  }
}

// --- Piletilevi -------------------------------------------------------------

async function loadCache(name) {
  try { return JSON.parse(await fs.readFile(path.join(CACHE_DIR, name), 'utf8')); } catch { return {}; }
}
async function saveCache(name, obj) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(path.join(CACHE_DIR, name), JSON.stringify(obj));
}

function priceFromPrices(prices) {
  if (!Array.isArray(prices) || !prices.length) return null;
  const nums = prices.map((p) => Number(p.price ?? p.amount ?? p.value ?? p.min ?? NaN)).filter((n) => Number.isFinite(n) && n >= 0);
  if (!nums.length) return null;
  return Math.min(...nums);
}

async function fetchPiletilevi() {
  const base = 'https://www.piletilevi.ee/api/v1/events';
  const first = await getJSON(`${base}?language=et&pageSize=100&page=1`);
  const pages = [first];
  const totalPages = Number(first.totalPages) || 1;
  const rest = await mapLimit(Array.from({ length: totalPages - 1 }, (_, i) => i + 2), 4, (p) =>
    getJSON(`${base}?language=et&pageSize=100&page=${p}`).catch((e) => { console.warn(`[piletilevi] page ${p}: ${e.message}`); return { items: [] }; }),
  );
  pages.push(...rest);
  const items = pages.flatMap((p) => p.items || []);

  // Detail cache: descriptions + prices for events starting within 120 days.
  const cacheName = 'piletilevi-details.json';
  const cache = await loadCache(cacheName);
  const cutoff = NOW.getTime() + 120 * DAY;
  const maxDetailAge = 14 * DAY;
  const need = items.filter((it) => {
    if (it.status === 'CANCELLED') return false;
    const start = new Date(it.eventStartAt).getTime();
    if (!(start < cutoff)) return false;
    const c = cache[it.id];
    return !c || NOW.getTime() - (c.fetchedAt || 0) > maxDetailAge;
  }).slice(0, 900);
  console.log(`[piletilevi] ${items.length} listed, fetching ${need.length} details`);
  let fetched = 0;
  await mapLimit(need, 5, async (it) => {
    try {
      const d = await getJSON(`https://www.piletilevi.ee/api/v1/events/${it.id}?language=et`);
      const prices = (d.prices || []).map((p) => ({ price: p.price ?? p.amount ?? p.value, name: p.name ?? p.title }));
      cache[it.id] = {
        fetchedAt: NOW.getTime(),
        description: truncate(stripHtml(d.description || ''), 600),
        priceInfo: truncate(stripHtml(d.priceInfo || ''), 200),
        priceFrom: priceFromPrices(d.prices),
        tags: (d.tags || []).map((t) => t.name || t.key || t).filter(Boolean).slice(0, 8),
        locationType: d.locationType || null,
      };
      fetched++;
    } catch (e) {
      cache[it.id] = cache[it.id] || { fetchedAt: NOW.getTime(), description: '', error: String(e.message) };
    }
  });
  // prune cache entries for events no longer listed
  const listedIds = new Set(items.map((i) => i.id));
  for (const id of Object.keys(cache)) if (!listedIds.has(id)) delete cache[id];
  await saveCache(cacheName, cache);
  console.log(`[piletilevi] fetched ${fetched} details, cache size ${Object.keys(cache).length}`);

  return items
    .filter((it) => it.status !== 'CANCELLED')
    .filter((it) => !(it.categories || []).some((x) => x.key === 'gift_card'))
    .filter((it) => !it.venue?.country || it.venue.country === 'EE')
    .map((it) => {
      const c = cache[it.id] || {};
      const img = it.imageData?.find((i) => i.type === 'DESKTOP') || it.imageData?.[0];
      const venueName = it.venue?.nameOverride || it.venue?.name || '';
      const catKeys = (it.categories || []).map((x) => x.key);
      const text = `${it.name} ${c.description || ''}`;
      const start = toLocal(new Date(it.eventStartAt));
      const end = toLocal(new Date(it.eventEndAt));
      return {
        id: `pl-${it.id}`,
        source: 'piletilevi',
        title: it.name,
        description: truncate(c.description || ''),
        start, end,
        venue: venueName.replace(/,\s*(Tallinn|Tartu|Pärnu|Narva)\s*$/i, ''),
        city: normCity(it.venue?.city) || null,
        country: it.venue?.country || 'EE',
        categories: categoriesFrom(catKeys, it.name),
        rawCategories: catKeys,
        langs: detectLangs(text, 'et'),
        url: `https://www.piletilevi.ee/piletid/${it.id}/${it.sluggedName}`,
        ticketUrl: `https://www.piletilevi.ee/piletid/${it.id}/${it.sluggedName}`,
        image: img ? `https://www.piletilevi.ee/i/width=480/images/${img.imageId}` : null,
        priceFrom: c.priceFrom ?? null,
        priceText: c.priceFrom != null ? `${c.priceFrom} €` : (c.priceInfo || null),
        free: c.priceFrom === 0,
        online: c.locationType === 'ONLINE' || /\bonline\b|veebis|онлайн/i.test(venueName),
        organizer: it.promoter?.companyName || null,
        tags: c.tags || [],
      };
    });
}

// --- Fienta ---------------------------------------------------------------

function parseFientaPrice(s) {
  if (!s) return { priceFrom: null, free: false };
  if (/free|tasuta|бесплатно/i.test(s)) return { priceFrom: 0, free: true };
  const m = s.replace(',', '.').match(/(\d+(?:\.\d+)?)/);
  return { priceFrom: m ? Number(m[1]) : null, free: false };
}

async function fetchFienta() {
  const base = 'https://fienta.com/api/v1/public/events?country=EE&per_page=100';
  const first = await getJSON(`${base}&page=1`);
  const last = Number(first.pagination?.last_page) || 1;
  const pages = [first, ...(await mapLimit(Array.from({ length: last - 1 }, (_, i) => i + 2), 4, (p) =>
    getJSON(`${base}&page=${p}`).catch((e) => { console.warn(`[fienta] page ${p}: ${e.message}`); return { events: [] }; })))];
  const items = pages.flatMap((p) => p.events || []);
  return items
    .filter((e) => e.is_public !== false && e.event_status !== 'cancelled')
    .map((e) => {
      const desc = stripHtml(e.description || '');
      const text = `${e.title} ${desc}`;
      const { city, county } = parseAddress(e.address);
      const price = parseFientaPrice(e.price_from_string);
      const online = e.attendance_mode === 'online' || /\b(online|онлайн|veebis|veebi|zoom)\b/i.test(e.venue || '');
      return {
        id: `fi-${e.id}`,
        source: 'fienta',
        title: e.title,
        description: truncate(desc),
        start: localFromNaive(e.starts_at),
        end: localFromNaive(e.ends_at),
        venue: e.venue || (online ? 'Online' : ''),
        address: e.address || null,
        city: city || (online ? null : null),
        county: county || null,
        country: 'EE',
        categories: categoriesFrom(e.categories, e.title),
        rawCategories: e.categories || [],
        langs: detectLangs(text, 'et'),
        url: e.url,
        ticketUrl: e.buy_tickets_url || e.url,
        image: e.image_small_url || e.image_url || null,
        priceFrom: price.priceFrom,
        priceText: e.price_from_string || null,
        free: price.free,
        online,
        organizer: e.organizer_name || null,
        tags: [],
      };
    });
}

// --- Tartu Kultuuriaken ---------------------------------------------------

async function fetchTartu() {
  const data = await getJSON('https://kultuuriaken.tartu.ee/api/events');
  const list = data.list || data || [];
  const out = [];
  for (const it of list) {
    const desc = stripHtml(it.summary || it.content || '');
    const text = `${it.title} ${desc}`;
    const cats = categoriesFrom(it.categories, it.title);
    const langs = detectLangs(text, 'et');
    const priceText = typeof it.price === 'string' ? it.price : (it.price?.text || it.price?.price || null);
    const free = /tasuta|free|бесплатно/i.test(`${priceText || ''} ${it.ticket_info || ''}`) || it.ticket_availability === 'free';
    const tg = (it.target_groups || []);
    if (tg.includes('lapsed') && !cats.includes('family') && !tg.includes('täiskasvanud')) cats.push('family');
    const occurrences = (it.events || []).slice(0, 60);
    occurrences.forEach((o, idx) => {
      const startD = new Date((o.start || 0) * 1000);
      const endD = o.end ? new Date(o.end * 1000) : null;
      if (endD && endD < WINDOW_START) return;
      if (startD > WINDOW_END) return;
      // Very long runs (exhibitions) are capped visually; keep real end.
      out.push({
        id: `tk-${it.id}-${idx}`,
        source: 'tartu',
        title: it.title.trim(),
        description: truncate(desc),
        start: toLocal(startD),
        end: endD ? toLocal(endD) : null,
        venue: o.name || '',
        address: o.location_string || null,
        city: normCity(o.municipality?.replace(/\s+linn$/, '')) || (o.location_string?.includes('Tartu') ? 'Tartu' : null),
        county: o.province || null,
        country: 'EE',
        categories: cats,
        rawCategories: it.categories || [],
        langs,
        url: o.link || it.additional_info_link || `https://kultuuriaken.tartu.ee/et/syndmus/${it.id}`,
        ticketUrl: it.ticket_link || null,
        image: it.images?.[0] || null,
        priceFrom: free ? 0 : (priceText ? (Number(String(priceText).match(/\d+(?:[.,]\d+)?/)?.[0]?.replace(',', '.')) || null) : null),
        priceText: priceText || (free ? 'Tasuta' : null),
        free,
        online: /online|veebis|онлайн/i.test(`${o.name} ${o.location_string}`),
        organizer: it.organizer_info?.organizer_name || null,
        tags: tg,
      });
    });
  }
  return out;
}

// --- Eventbrite -------------------------------------------------------------

function extractLdJson(html) {
  const blocks = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
  const out = [];
  for (const b of blocks) {
    try { out.push(JSON.parse(b[1])); } catch { /* ignore */ }
  }
  return out;
}

async function fetchEventbrite() {
  const seen = new Map();
  const lists = ['https://www.eventbrite.com/d/estonia/events/', 'https://www.eventbrite.com/d/estonia--tallinn/events/', 'https://www.eventbrite.com/d/estonia--tartu/events/'];
  for (const base of lists) {
    for (let page = 1; page <= 12; page++) {
      let html;
      try { html = await getText(`${base}?page=${page}`); } catch (e) { console.warn(`[eventbrite] ${base} p${page}: ${e.message}`); break; }
      const ld = extractLdJson(html).find((j) => j.itemListElement);
      const els = ld?.itemListElement || [];
      if (!els.length) break;
      let added = 0;
      for (const el of els) {
        const it = el.item || el;
        if (!it?.url || seen.has(it.url)) continue;
        seen.set(it.url, it);
        added++;
      }
      if (added === 0) break;
      await sleep(300);
    }
  }
  return [...seen.values()].map((it) => {
    const addr = it.location?.address || {};
    const text = `${it.name} ${it.description || ''}`;
    const online = /OnlineEventAttendanceMode/.test(it.eventAttendanceMode || '') || it.location?.['@type'] === 'VirtualLocation';
    const start = localFromNaive(it.startDate);
    const idm = it.url.match(/-(\d+)\/?(?:\?|$)/);
    return {
      id: `eb-${idm ? idm[1] : slugKey(it.url).replace(/\s/g, '')}`,
      source: 'eventbrite',
      title: it.name,
      description: truncate(stripHtml(it.description || '')),
      start, end: localFromNaive(it.endDate),
      venue: it.location?.name || (online ? 'Online' : ''),
      address: [addr.streetAddress, addr.postalCode, addr.addressLocality].filter(Boolean).join(', ') || null,
      city: normCity(addr.addressLocality) || null,
      county: addr.addressRegion || null,
      country: addr.addressCountry || 'EE',
      categories: categoriesFrom([], it.name),
      rawCategories: [],
      langs: detectLangs(text, 'en'),
      url: it.url.split('?')[0],
      ticketUrl: it.url.split('?')[0],
      image: it.image || null,
      priceFrom: it.offers?.lowPrice != null ? Number(it.offers.lowPrice) : null,
      priceText: it.offers?.lowPrice != null ? `${it.offers.lowPrice} ${it.offers.priceCurrency || '€'}` : null,
      free: it.offers?.lowPrice === 0 || it.offers?.lowPrice === '0' || it.offers?.lowPrice === '0.00',
      online,
      organizer: it.organizer?.name || null,
      tags: [],
      timeUnknown: start ? start.length === 10 : false,
    };
  });
}

// --- Meetup -----------------------------------------------------------------

async function fetchMeetup() {
  const locations = ['ee--Tallinn', 'ee--Tartu'];
  const seen = new Map();
  for (const loc of locations) {
    for (const src of ['EVENTS', 'EVENTS&eventType=inPerson']) {
      let html;
      try { html = await getText(`https://www.meetup.com/find/?location=${loc}&source=${src}`); } catch (e) { console.warn(`[meetup] ${loc}: ${e.message}`); continue; }
      const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
      if (!m) continue;
      let state;
      try { state = JSON.parse(m[1]).props?.pageProps?.__APOLLO_STATE__ || {}; } catch { continue; }
      const resolve = (ref) => (ref && ref.__ref ? state[ref.__ref] : ref);
      for (const [k, v] of Object.entries(state)) {
        if (!k.startsWith('Event:') || !v?.title) continue;
        if (seen.has(v.id)) continue;
        const venue = resolve(v.venue) || {};
        const group = resolve(v.group) || {};
        const imageRef = resolve(v.featuredEventPhoto) || resolve(v.image) || {};
        const image = imageRef.baseUrl && imageRef.id ? `${imageRef.baseUrl}${imageRef.id}/676x380.webp` : (imageRef.source || null);
        seen.set(v.id, { v, venue, group, image });
      }
      await sleep(300);
    }
  }
  return [...seen.values()].map(({ v, venue, group, image }) => {
    const desc = stripHtml((v.description || '').replace(/[*_#>]/g, ''));
    const text = `${v.title} ${desc}`;
    const online = v.eventType === 'ONLINE' || v.isOnline === true;
    const startD = v.dateTime ? new Date(v.dateTime) : null;
    const endD = v.endTime ? new Date(v.endTime) : null;
    return {
      id: `mu-${v.id}`,
      source: 'meetup',
      title: v.title,
      description: truncate(desc),
      start: startD ? toLocal(startD) : null,
      end: endD ? toLocal(endD) : null,
      venue: venue.name || (online ? 'Online' : ''),
      address: [venue.address, venue.city].filter(Boolean).join(', ') || null,
      city: normCity(venue.city) || (online ? null : 'Tallinn'),
      country: venue.country?.toUpperCase() || 'EE',
      categories: [...new Set([...categoriesFrom([], v.title), 'community'])].filter((c, _, a) => !(c === 'other' && a.length > 1)),
      rawCategories: [],
      langs: detectLangs(text, 'en'),
      url: v.eventUrl || `https://www.meetup.com/${group.urlname}/events/${v.id}/`,
      ticketUrl: v.eventUrl || null,
      image,
      priceFrom: v.feeSettings?.amount != null ? Number(v.feeSettings.amount) : (v.isFree === false ? null : 0),
      priceText: v.feeSettings?.amount ? `${v.feeSettings.amount} ${v.feeSettings.currency || '€'}` : 'Free',
      free: !v.feeSettings?.amount,
      online,
      organizer: group.name || null,
      tags: [],
    };
  });
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

const SOURCE_PRIORITY = { piletilevi: 0, fienta: 1, tartu: 2, eventbrite: 3, meetup: 4 };

function dedupe(events) {
  const byKey = new Map();
  for (const e of events) {
    const key = `${slugKey(e.title).split(' ').slice(0, 6).join(' ')}|${(e.start || '').slice(0, 13)}`;
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, e); continue; }
    const keep = SOURCE_PRIORITY[prev.source] <= SOURCE_PRIORITY[e.source] ? prev : e;
    const drop = keep === prev ? e : prev;
    keep.image ||= drop.image;
    keep.description ||= drop.description;
    keep.city ||= drop.city;
    keep.priceText ||= drop.priceText;
    if (keep.priceFrom == null) keep.priceFrom = drop.priceFrom;
    keep.ticketUrl ||= drop.ticketUrl;
    keep.categories = [...new Set([...keep.categories, ...drop.categories])].filter((c, _, a) => !(c === 'other' && a.length > 1));
    keep.langs = [...new Set([...keep.langs, ...drop.langs])];
    keep.altUrls = [...new Set([...(keep.altUrls || []), drop.url])];
    keep.sources = [...new Set([...(keep.sources || [keep.source]), drop.source])];
    byKey.set(key, keep);
  }
  return [...byKey.values()];
}

function inWindow(e) {
  if (!e.start) return false;
  const s = localToDate(e.start);
  const en = e.end ? localToDate(e.end) : s;
  if (!s || Number.isNaN(s.getTime())) return false;
  if (s > WINDOW_END) return false;
  return (en || s) >= WINDOW_START;
}

function finalize(e) {
  const s = localToDate(e.start);
  const en = e.end ? localToDate(e.end) : null;
  const durationDays = s && en ? (en - s) / DAY : 0;
  const out = {
    id: e.id,
    src: e.sources || [e.source],
    t: e.title,
    d: e.description || '',
    s: e.start,
    e: e.end || null,
    v: e.venue || '',
    a: e.address || null,
    c: e.city || null,
    co: e.county || null,
    cat: e.categories,
    l: e.langs,
    u: e.url,
    tu: e.ticketUrl && e.ticketUrl !== e.url ? e.ticketUrl : null,
    img: e.image,
    p: e.priceFrom,
    pt: e.priceText,
    f: !!e.free,
    on: !!e.online,
    org: e.organizer || null,
    ong: durationDays > 3,
    tbd: !!e.timeUnknown,
  };
  if (e.altUrls?.length) out.alt = e.altUrls;
  return out;
}

async function main() {
  console.log(`Fetching events at ${NOW.toISOString()}`);
  const results = await Promise.all([
    withStats('piletilevi', fetchPiletilevi),
    withStats('fienta', fetchFienta),
    withStats('tartu', fetchTartu),
    withStats('eventbrite', fetchEventbrite),
    withStats('meetup', fetchMeetup),
  ]);
  const all = results.flat().filter((e) => e.title && !NOT_AN_EVENT.test(e.title) && inWindow(e));
  const merged = dedupe(all).map(finalize).sort((a, b) => (a.s < b.s ? -1 : a.s > b.s ? 1 : 0));

  const cities = {};
  const cats = {};
  const langs = {};
  for (const e of merged) {
    if (e.c) cities[e.c] = (cities[e.c] || 0) + 1;
    for (const c of e.cat) cats[c] = (cats[c] || 0) + 1;
    for (const l of e.l) langs[l] = (langs[l] || 0) + 1;
  }
  const out = {
    generatedAt: NOW.toISOString(),
    count: merged.length,
    sources: sourceStats,
    cities: Object.fromEntries(Object.entries(cities).sort((a, b) => b[1] - a[1])),
    categories: cats,
    langs,
    events: merged,
  };
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(out));
  await fs.writeFile(path.join(DATA_DIR, 'meta.json'), JSON.stringify({
    generatedAt: out.generatedAt, count: out.count, sources: sourceStats, cities: out.cities, categories: cats, langs,
    unknownCategoryKeys: Object.fromEntries([...unknownCategoryKeys.entries()].sort((a, b) => b[1] - a[1]).slice(0, 80)),
  }, null, 2));
  const kb = Math.round((await fs.stat(OUT_FILE)).size / 1024);
  console.log(`Wrote ${merged.length} events (${all.length} before dedupe) to data/events.json (${kb} KB)`);
  console.log('Cities:', Object.entries(cities).slice(0, 12).map(([k, v]) => `${k}=${v}`).join(', '));
  console.log('Categories:', Object.entries(cats).map(([k, v]) => `${k}=${v}`).join(', '));
  console.log('Langs:', langs);
  if (unknownCategoryKeys.size) console.log('Unmapped category keys:', [...unknownCategoryKeys.entries()].slice(0, 30).map(([k, v]) => `${k}(${v})`).join(', '));

  const okSources = Object.values(sourceStats).filter((s) => s.ok).length;
  if (okSources === 0) { console.error('All sources failed'); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
