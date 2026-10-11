/* Events in Estonia – static front-end. Reads data/events.json, filters client-side. */
(() => {
  'use strict';

  const I18N = {
    en: {
      title: 'Events in Estonia', search: 'Search', searchPlaceholder: 'Search events, venues, artists…',
      anyCity: 'All cities', otherCity: 'Other places', anyLang: 'Any language', langEt: 'Estonian', langRu: 'Russian', langEn: 'English',
      from: 'From', to: 'To', freeOnly: 'Free only', includeOnline: 'Include online', showOngoing: 'Show long-running (exhibitions, courses)',
      reset: 'Reset filters', loadMore: 'Load more', updated: 'Updated', events: 'events', noResults: 'Nothing found. Try fewer filters.',
      ongoingBox: 'Ongoing & long-running', timeTba: 'time TBA', allDay: 'all day', until: 'until', online: 'online', free: 'Free', fromPrice: 'from',
      footer: "Data is collected automatically several times a day from public event listings. Always check the organiser's page for the final details.",
      sourcesLabel: 'Sources',
      d: { any: 'Any date', today: 'Today', tomorrow: 'Tomorrow', weekend: 'This weekend', week: 'Next 7 days', month: 'Next 30 days', custom: 'Pick dates' },
      c: { music: 'Music', theatre: 'Theatre', comedy: 'Comedy', exhibition: 'Exhibitions', film: 'Film', lecture: 'Lectures & courses', party: 'Parties & clubs', family: 'Kids & family', sport: 'Sport', festival: 'Festivals', food: 'Food & drink', dance: 'Dance', community: 'Meetups & community', business: 'Business & tech', tour: 'Tours', market: 'Markets', other: 'Other' },
      weekdays: undefined,
    },
    et: {
      title: 'Sündmused Eestis', search: 'Otsi', searchPlaceholder: 'Otsi sündmusi, kohti, esinejaid…',
      anyCity: 'Kõik linnad', otherCity: 'Mujal', anyLang: 'Mis tahes keel', langEt: 'Eesti keel', langRu: 'Vene keel', langEn: 'Inglise keel',
      from: 'Alates', to: 'Kuni', freeOnly: 'Ainult tasuta', includeOnline: 'Ka veebis', showOngoing: 'Näita pikaajalisi (näitused, kursused)',
      reset: 'Tühista filtrid', loadMore: 'Näita rohkem', updated: 'Uuendatud', events: 'sündmust', noResults: 'Midagi ei leitud. Proovi vähem filtreid.',
      ongoingBox: 'Käimasolevad ja pikaajalised', timeTba: 'aeg täpsustamisel', allDay: 'terve päev', until: 'kuni', online: 'veebis', free: 'Tasuta', fromPrice: 'alates',
      footer: 'Andmed kogutakse automaatselt mitu korda päevas avalikest sündmuste kalendritest. Kontrolli lõplikku infot alati korraldaja lehelt.',
      sourcesLabel: 'Allikad',
      d: { any: 'Mis tahes aeg', today: 'Täna', tomorrow: 'Homme', weekend: 'Nädalavahetus', week: '7 päeva', month: '30 päeva', custom: 'Vali kuupäevad' },
      c: { music: 'Muusika', theatre: 'Teater', comedy: 'Komöödia', exhibition: 'Näitused', film: 'Film', lecture: 'Loengud ja kursused', party: 'Peod ja klubid', family: 'Lastele ja peredele', sport: 'Sport', festival: 'Festivalid', food: 'Toit ja jook', dance: 'Tants', community: 'Kogukond ja kohtumised', business: 'Äri ja tehnoloogia', tour: 'Ekskursioonid', market: 'Laadad', other: 'Muu' },
    },
    ru: {
      title: 'События в Эстонии', search: 'Поиск', searchPlaceholder: 'Искать события, места, артистов…',
      anyCity: 'Все города', otherCity: 'Другие места', anyLang: 'Любой язык', langEt: 'Эстонский', langRu: 'Русский', langEn: 'Английский',
      from: 'С', to: 'По', freeOnly: 'Только бесплатные', includeOnline: 'Включая онлайн', showOngoing: 'Показывать длительные (выставки, курсы)',
      reset: 'Сбросить фильтры', loadMore: 'Показать ещё', updated: 'Обновлено', events: 'событий', noResults: 'Ничего не найдено. Попробуйте убрать фильтры.',
      ongoingBox: 'Текущие и длительные', timeTba: 'время уточняется', allDay: 'весь день', until: 'до', online: 'онлайн', free: 'Бесплатно', fromPrice: 'от',
      footer: 'Данные собираются автоматически несколько раз в день из открытых афиш. Всегда проверяйте детали на странице организатора.',
      sourcesLabel: 'Источники',
      d: { any: 'Любая дата', today: 'Сегодня', tomorrow: 'Завтра', weekend: 'Выходные', week: '7 дней', month: '30 дней', custom: 'Выбрать даты' },
      c: { music: 'Музыка', theatre: 'Театр', comedy: 'Комедия', exhibition: 'Выставки', film: 'Кино', lecture: 'Лекции и курсы', party: 'Вечеринки и клубы', family: 'Детям и семьям', sport: 'Спорт', festival: 'Фестивали', food: 'Еда и напитки', dance: 'Танцы', community: 'Встречи и сообщества', business: 'Бизнес и IT', tour: 'Экскурсии', market: 'Ярмарки', other: 'Другое' },
    },
  };
  const LOCALES = { en: 'en-GB', et: 'et-EE', ru: 'ru-RU' };
  const CATS = ['music', 'theatre', 'comedy', 'party', 'exhibition', 'film', 'lecture', 'community', 'family', 'sport', 'festival', 'food', 'dance', 'business', 'tour', 'market', 'other'];
  const MAIN_CITIES = ['Tallinn', 'Tartu', 'Pärnu', 'Narva'];
  const SOURCE_NAMES = { piletilevi: 'Piletilevi', fienta: 'Fienta', tartu: 'Kultuuriaken', eventbrite: 'Eventbrite', meetup: 'Meetup' };
  const CAT_ICON = { music: '🎵', theatre: '🎭', comedy: '😂', exhibition: '🖼️', film: '🎬', lecture: '🎓', party: '🪩', family: '🧸', sport: '🏃', festival: '🎪', food: '🍽️', dance: '💃', community: '🤝', business: '💼', tour: '🧭', market: '🛍️', other: '✨' };
  const PAGE = 60;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // --- state ---------------------------------------------------------------
  const state = {
    ui: detectUiLang(), q: '', city: '', lang: '', date: 'any', from: '', to: '',
    cats: new Set(), free: false, online: false, ongoing: false, src: new Set(), shown: PAGE,
  };
  let DATA = { events: [] };
  let filtered = [];

  function detectUiLang() {
    const saved = localStorage.getItem('ui');
    if (saved && I18N[saved]) return saved;
    const nav = (navigator.language || 'en').slice(0, 2);
    return I18N[nav] ? nav : 'en';
  }
  const T = () => I18N[state.ui];

  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    if (p.get('ui') && I18N[p.get('ui')]) state.ui = p.get('ui');
    state.q = p.get('q') || '';
    state.city = p.get('city') || '';
    state.lang = p.get('lang') || '';
    state.date = p.get('d') || 'any';
    state.from = p.get('from') || '';
    state.to = p.get('to') || '';
    state.cats = new Set((p.get('cat') || '').split(',').filter(Boolean));
    state.src = new Set((p.get('src') || '').split(',').filter(Boolean));
    state.free = p.get('free') === '1';
    state.online = p.get('online') === '1';
    state.ongoing = p.get('ongoing') === '1';
  }
  function writeHash() {
    const p = new URLSearchParams();
    if (state.ui !== detectUiLang()) p.set('ui', state.ui);
    if (state.q) p.set('q', state.q);
    if (state.city) p.set('city', state.city);
    if (state.lang) p.set('lang', state.lang);
    if (state.date !== 'any') p.set('d', state.date);
    if (state.date === 'custom') { if (state.from) p.set('from', state.from); if (state.to) p.set('to', state.to); }
    if (state.cats.size) p.set('cat', [...state.cats].join(','));
    if (state.src.size) p.set('src', [...state.src].join(','));
    if (state.free) p.set('free', '1');
    if (state.online) p.set('online', '1');
    if (state.ongoing) p.set('ongoing', '1');
    const h = p.toString();
    history.replaceState(null, '', h ? '#' + h : location.pathname);
  }

  // --- dates ---------------------------------------------------------------
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  function todayStr() { return ymd(new Date()); }

  function dateRange() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const t = ymd(today);
    switch (state.date) {
      case 'today': return [t, t];
      case 'tomorrow': { const x = ymd(addDays(today, 1)); return [x, x]; }
      case 'weekend': {
        const dow = today.getDay(); // 0 Sun .. 6 Sat
        const start = dow === 6 || dow === 0 ? today : addDays(today, 6 - dow);
        const end = start.getDay() === 0 ? start : addDays(start, 1);
        return [ymd(start), ymd(end)];
      }
      case 'week': return [t, ymd(addDays(today, 6))];
      case 'month': return [t, ymd(addDays(today, 29))];
      case 'custom': return [state.from || t, state.to || '9999-12-31'];
      default: return [t, '9999-12-31'];
    }
  }

  // --- filtering -----------------------------------------------------------
  function norm(s) { return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, ''); }

  function applyFilters() {
    const [from, to] = dateRange();
    const q = norm(state.q).trim();
    const words = q ? q.split(/\s+/).filter(Boolean) : [];
    const today = todayStr();
    filtered = DATA.events.filter((e) => {
      const sDay = e.s.slice(0, 10);
      const eDay = (e.e || e.s).slice(0, 10);
      if (eDay < today) return false;
      if (!(eDay >= from && sDay <= to)) return false;
      if (e.ong && !state.ongoing) return false;
      if (e.on && !state.online) return false;
      if (state.free && !e.f) return false;
      if (state.city) {
        if (state.city === '__other') { if (MAIN_CITIES.includes(e.c)) return false; }
        else if (e.c !== state.city) return false;
      }
      if (state.lang && !e.l.includes(state.lang)) return false;
      if (state.cats.size && !e.cat.some((c) => state.cats.has(c))) return false;
      if (state.src.size && !e.src.some((s) => state.src.has(s))) return false;
      if (words.length) {
        const hay = e._h || (e._h = norm(`${e.t} ${e.v} ${e.c || ''} ${e.org || ''} ${e.d}`));
        for (const w of words) if (!hay.includes(w)) return false;
      }
      return true;
    });
  }

  // --- rendering -----------------------------------------------------------
  function fmtDayHeader(dayStr) {
    const d = new Date(dayStr + 'T12:00:00');
    const today = todayStr();
    const label = new Intl.DateTimeFormat(LOCALES[state.ui], { weekday: 'long', day: 'numeric', month: 'long' }).format(d);
    if (dayStr === today) return `${T().d.today} · ${label}`;
    if (dayStr === ymd(addDays(new Date(), 1))) return `${T().d.tomorrow} · ${label}`;
    return label;
  }
  function fmtShort(dayStr) {
    return new Intl.DateTimeFormat(LOCALES[state.ui], { day: 'numeric', month: 'short' }).format(new Date(dayStr + 'T12:00:00'));
  }

  function card(e) {
    const t = T();
    const hhmm = e.s.slice(11, 16);
    const time = e.tbd || e.s.length === 10 ? `<span>${t.timeTba}</span>`
      : hhmm === '00:00' ? `<span>${t.allDay}</span>` : `<b>${hhmm}</b>`;
    let when = time;
    if (e.ong) {
      when = `<span>${fmtShort(e.s.slice(0, 10))} – ${e.e ? fmtShort(e.e.slice(0, 10)) : '…'}</span>`;
    } else if (e.e && e.e.slice(0, 10) !== e.s.slice(0, 10)) {
      when += `<span>${t.until} ${fmtShort(e.e.slice(0, 10))}</span>`;
    }
    const where = [e.v, e.c].filter(Boolean).join(' · ');
    const price = e.f ? `<span class="tag free">${t.free}</span>`
      : e.p != null ? `<span class="tag price">${t.fromPrice} ${e.p} €</span>`
      : e.pt ? `<span class="tag price">${esc(e.pt.slice(0, 24))}</span>` : '';
    const cats = e.cat.slice(0, 2).map((c) => `<span class="tag">${CAT_ICON[c] || ''} ${t.c[c] || c}</span>`).join('');
    const langs = e.l.map((l) => `<span class="tag lang">${l.toUpperCase()}</span>`).join('');
    const src = e.src.map((s) => `<span class="tag src">${SOURCE_NAMES[s] || s}</span>`).join('');
    const online = e.on ? `<span class="tag online">${t.online}</span>` : '';
    const img = e.img ? `<img loading="lazy" src="${esc(e.img)}" alt="" onerror="this.remove()">` : (CAT_ICON[e.cat[0]] || '🎫');
    const url = e.tu || e.u;
    return `<a class="card" href="${esc(url)}" target="_blank" rel="noopener">
      <div class="img">${img}</div>
      <div class="body">
        <div class="when">${when}${online}</div>
        <div class="title">${esc(e.t)}</div>
        <div class="where" title="${esc(where)}">${esc(where)}</div>
        ${e.d ? `<div class="desc">${esc(e.d)}</div>` : ''}
        <div class="meta">${price}${cats}${langs}${src}</div>
      </div></a>`;
  }

  function render() {
    const t = T();
    const res = $('results');
    const list = filtered.slice(0, state.shown);
    $('status').textContent = `${filtered.length.toLocaleString(LOCALES[state.ui])} ${t.events}`;
    if (!filtered.length) {
      res.innerHTML = `<div class="empty">${t.noResults}</div>`;
      $('more').hidden = true;
      return;
    }
    const ongoing = list.filter((e) => e.ong);
    const dated = list.filter((e) => !e.ong);
    let html = '';
    if (ongoing.length) {
      html += `<details class="ongoing-box"><summary>${t.ongoingBox} (${filtered.filter((e) => e.ong).length})</summary><div class="grid" style="margin-top:10px">${ongoing.map(card).join('')}</div></details>`;
    }
    let day = null;
    let buf = [];
    const flush = () => { if (day) html += `<div class="day"><h2>${fmtDayHeader(day)}</h2><span class="n">${buf.length}</span></div><div class="grid">${buf.join('')}</div>`; buf = []; };
    for (const e of dated) {
      const d = e.s.slice(0, 10);
      if (d !== day) { flush(); day = d; }
      buf.push(card(e));
    }
    flush();
    res.innerHTML = html;
    $('more').hidden = filtered.length <= state.shown;
  }

  function update(resetPage = true) {
    if (resetPage) state.shown = PAGE;
    applyFilters();
    render();
    writeHash();
  }

  // --- UI building ----------------------------------------------------------
  function buildStatic() {
    const t = T();
    document.documentElement.lang = state.ui;
    document.title = t.title;
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t[el.dataset.i18n] ?? el.textContent; });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t[el.dataset.i18nPlaceholder]; });
    document.querySelectorAll('.ui-lang button').forEach((b) => b.classList.toggle('on', b.dataset.ui === state.ui));

    // dates
    $('dates').innerHTML = Object.entries(t.d).map(([k, v]) => `<button class="chip${state.date === k ? ' on' : ''}" data-date="${k}">${v}</button>`).join('');
    $('customDates').hidden = state.date !== 'custom';
    $('from').value = state.from; $('to').value = state.to;

    // categories with counts
    const counts = DATA.categories || {};
    $('cats').innerHTML = CATS.map((c) => `<button class="chip${state.cats.has(c) ? ' on' : ''}" data-cat="${c}">${CAT_ICON[c]} ${t.c[c]}${counts[c] ? ` <span class="n">${counts[c]}</span>` : ''}</button>`).join('');

    // cities
    const cityCounts = DATA.cities || {};
    const opts = [`<option value="">${t.anyCity}</option>`];
    for (const c of MAIN_CITIES) opts.push(`<option value="${c}"${state.city === c ? ' selected' : ''}>${c}${cityCounts[c] ? ` (${cityCounts[c]})` : ''}</option>`);
    const others = Object.entries(cityCounts).filter(([c, n]) => !MAIN_CITIES.includes(c) && n >= 8).slice(0, 25);
    for (const [c, n] of others) opts.push(`<option value="${esc(c)}"${state.city === c ? ' selected' : ''}>${esc(c)} (${n})</option>`);
    opts.push(`<option value="__other"${state.city === '__other' ? ' selected' : ''}>${t.otherCity}</option>`);
    $('city').innerHTML = opts.join('');
    $('lang').value = state.lang;
    $('q').value = state.q;
    $('free').checked = state.free; $('online').checked = state.online; $('ongoing').checked = state.ongoing;

    // sources
    const srcs = Object.entries(DATA.sources || {}).filter(([, v]) => v.count > 0).map(([k]) => k);
    $('sources').innerHTML = srcs.map((s) => `<button class="chip${state.src.has(s) ? ' on' : ''}" data-src="${s}" title="${esc(s)}">${SOURCE_NAMES[s] || s}</button>`).join('');

    if (DATA.generatedAt) {
      const d = new Date(DATA.generatedAt);
      $('updated').textContent = `${t.updated} ${new Intl.DateTimeFormat(LOCALES[state.ui], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d)}`;
      const stats = Object.entries(DATA.sources || {}).map(([k, v]) => `${SOURCE_NAMES[k] || k}: ${v.ok ? v.count : '⚠︎'}`).join(' · ');
      $('sourceStats').textContent = `${t.sourcesLabel}: ${stats}`;
    }
  }

  function bind() {
    document.querySelectorAll('.ui-lang button').forEach((b) => b.addEventListener('click', () => {
      state.ui = b.dataset.ui; localStorage.setItem('ui', state.ui); buildStatic(); update(false);
    }));
    let timer;
    $('q').addEventListener('input', (e) => { clearTimeout(timer); timer = setTimeout(() => { state.q = e.target.value; update(); }, 150); });
    $('city').addEventListener('change', (e) => { state.city = e.target.value; update(); });
    $('lang').addEventListener('change', (e) => { state.lang = e.target.value; update(); });
    $('dates').addEventListener('click', (e) => {
      const b = e.target.closest('[data-date]'); if (!b) return;
      state.date = b.dataset.date;
      $('dates').querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === b));
      $('customDates').hidden = state.date !== 'custom';
      update();
    });
    $('from').addEventListener('change', (e) => { state.from = e.target.value; update(); });
    $('to').addEventListener('change', (e) => { state.to = e.target.value; update(); });
    $('cats').addEventListener('click', (e) => {
      const b = e.target.closest('[data-cat]'); if (!b) return;
      const c = b.dataset.cat;
      if (state.cats.has(c)) state.cats.delete(c); else state.cats.add(c);
      b.classList.toggle('on', state.cats.has(c));
      update();
    });
    $('sources').addEventListener('click', (e) => {
      const b = e.target.closest('[data-src]'); if (!b) return;
      const s = b.dataset.src;
      if (state.src.has(s)) state.src.delete(s); else state.src.add(s);
      b.classList.toggle('on', state.src.has(s));
      update();
    });
    for (const k of ['free', 'online', 'ongoing']) $(k).addEventListener('change', (e) => { state[k] = e.target.checked; update(); });
    $('reset').addEventListener('click', () => {
      Object.assign(state, { q: '', city: '', lang: '', date: 'any', from: '', to: '', cats: new Set(), src: new Set(), free: false, online: false, ongoing: false });
      buildStatic(); update();
    });
    $('more').addEventListener('click', () => { state.shown += PAGE; update(false); });
    $('brand').addEventListener('click', (e) => { e.preventDefault(); $('reset').click(); window.scrollTo({ top: 0 }); });
    window.addEventListener('hashchange', () => { readHash(); buildStatic(); update(); });
  }

  async function init() {
    readHash();
    buildStatic();
    bind();
    $('status').textContent = '…';
    try {
      const res = await fetch('data/events.json', { cache: 'no-cache' });
      DATA = await res.json();
      DATA.events.sort((a, b) => (a.s < b.s ? -1 : a.s > b.s ? 1 : 0));
    } catch (e) {
      $('status').textContent = 'Could not load data/events.json';
      return;
    }
    const repo = location.hostname.endsWith('github.io') ? `https://github.com/${location.hostname.split('.')[0]}/${location.pathname.split('/')[1] || ''}` : null;
    if (repo) $('repoLink').href = repo;
    buildStatic();
    update();
  }

  init();
})();
