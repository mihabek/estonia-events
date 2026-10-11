/* Shared cinema-schedule fetcher. Works in the browser (live, thanks to CORS on the cinema APIs)
 * and in Node (scripts/fetch-cinema.mjs). Sets globalThis.CinemaSources.
 *
 * Both sources run the Markus Cinema platform and expose the same public JSON:
 *   /xml/TheatreAreas/            areas, e.g. "Tallinn - Kõik kinod", "Tartu - Apollo Kino Tasku"
 *   /xml/Schedule/?area=&nrOfDays= showtimes
 *   /xml/Events/                  film details (synopsis, directors, trailer)
 */
(function (root) {
  'use strict';

  const SOURCES = [
    { key: 'apollo', base: 'https://www.apollokino.ee', label: 'Apollo Kino' },
    { key: 'artis', base: 'https://www.kino.ee', label: 'Kino Artis', defaultCity: 'Tallinn' },
  ];

  const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const truncate = (s, n) => (s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + '…' : s);
  const https = (u) => (u ? String(u).replace(/^http:\/\//, 'https://') : null);

  async function fetchMarkus(src, getJSON, days) {
    const { key, base, defaultCity } = src;
    const [areas, events] = await Promise.all([
      getJSON(`${base}/xml/TheatreAreas/`).catch(() => []),
      getJSON(`${base}/xml/Events/`).catch(() => []),
    ]);
    const cityByTheatre = {};
    const cityAreas = [];
    const covered = new Set();
    for (const a of areas) {
      const m = String(a.Name).match(/^(.+?)\s*-\s*(.+)$/);
      if (!m) continue;
      if (/Kõik kinod|All cinemas/i.test(m[2])) { cityAreas.push({ id: a.ID, city: m[1].trim() }); covered.add(m[1].trim()); }
      else cityByTheatre[m[2].trim()] = m[1].trim();
    }
    for (const a of areas) {
      const m = String(a.Name).match(/^(.+?)\s*-\s*(.+)$/);
      if (m && !/Kõik kinod|All cinemas/i.test(m[2]) && !covered.has(m[1].trim())) { cityAreas.push({ id: a.ID, city: m[1].trim() }); covered.add(m[1].trim()); }
    }
    const urls = cityAreas.length ? cityAreas.map((a) => `${base}/xml/Schedule/?area=${a.id}&nrOfDays=${days}`) : [`${base}/xml/Schedule/?nrOfDays=${days}`];
    const schedules = await Promise.all(urls.map((u) => getJSON(u).catch(() => ({ Shows: [] }))));

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
        if (!cinemas[cid]) cinemas[cid] = { n: s.Theatre, c: cityByTheatre[s.Theatre] || defaultCity || null, src: key };
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
            img: https((s.Images && s.Images.EventMediumImagePortrait) || (ev.Images && ev.Images.EventMediumImagePortrait) || null),
            u: s.EventURL || ev.EventURL || null,
            syn: truncate(strip(ev.ShortSynopsis || ev.Synopsis || ''), 260),
            dir: (ev.Directors || []).map((d) => `${d.FirstName || ''} ${d.LastName || ''}`.trim()).filter(Boolean).slice(0, 2),
            trailer: ((ev.Videos || []).find((v) => v.MediaResourceFormat === 'YouTubeVideo') || {}).Location || null,
            ty: s.EventType && s.EventType !== 'Movie' ? s.EventType : null,
          };
        }
        shows.push({
          m: mid,
          c: cid,
          s: String(s.dttmShowStart).slice(0, 16),
          l: (s.SpokenLanguage && s.SpokenLanguage.ISOTwoLetterCode) || null,
          sub: [s.SubtitleLanguage1 && s.SubtitleLanguage1.ISOTwoLetterCode, s.SubtitleLanguage2 && s.SubtitleLanguage2.ISOTwoLetterCode].filter(Boolean),
          f: s.PresentationMethod || null,
          x: s.EventSeries || null,
          u: s.ShowURL || null,
        });
      }
    }
    return { cinemas, movies, shows };
  }

  /**
   * Fetch all sources. getJSON(url) -> Promise<any>. Returns the data/cinema.json shape.
   */
  async function fetchAll(getJSON, { days = 31 } = {}) {
    const sources = {};
    const out = { generatedAt: new Date().toISOString(), sources, cinemas: {}, movies: {}, shows: [] };
    await Promise.all(SOURCES.map(async (src) => {
      try {
        const r = await fetchMarkus(src, getJSON, days);
        Object.assign(out.cinemas, r.cinemas);
        Object.assign(out.movies, r.movies);
        out.shows.push(...r.shows);
        sources[src.key] = { ok: r.shows.length > 0, label: src.label, shows: r.shows.length, movies: Object.keys(r.movies).length, cinemas: Object.keys(r.cinemas).length };
      } catch (e) {
        sources[src.key] = { ok: false, label: src.label, error: String((e && e.message) || e) };
      }
    }));
    out.shows.sort((a, b) => (a.s < b.s ? -1 : a.s > b.s ? 1 : 0));
    return out;
  }

  root.CinemaSources = { SOURCES, fetchAll };
})(typeof globalThis !== 'undefined' ? globalThis : window);
