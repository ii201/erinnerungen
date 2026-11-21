/*
 * Erinnerungen – eine kleine Erinnerungs-App, die komplett im Browser läuft.
 * Die Daten liegen im localStorage dieses Browsers (nichts wird an einen Server geschickt).
 * Datenmodell (version 1) ist bewusst schlicht gehalten, damit später eine Cloud-Synchronisation
 * (Variante B) oder ein Export in andere Tools (Variante C) einfach möglich ist.
 */
(() => {
  'use strict';

  /* =====================================================================
   * Grundlagen
   * ===================================================================== */
  const STORE_KEY = 'erinnerungen-app-v1';
  const DAY = 86400000;
  const BACKUP_INTERVAL_DAYS = 7;

  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pad = (n) => String(n).padStart(2, '0');
  const nowIso = () => new Date().toISOString();
  const uid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

  const svg = (p) => `<svg viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
  const ICON = {
    sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
    calendar: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
    list: svg('<path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>'),
    doneAll: svg('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.8"/>'),
    check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
    bell: svg('<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'),
    note: svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
    star: svg('<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z"/>'),
    settings: svg('<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>'),
    upload: svg('<path d="M12 15V3M7 8l5-5 5 5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>'),
    download: svg('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>'),
    close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
    clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
    search: svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'),
  };

  const ui = {
    view: 'today',
    query: '',
    selectedId: null,
    alertIds: [],
    editingNoteId: null,
    storageOk: true,
    backupBannerHidden: false,
    lastMinute: '',
    imp: null,
    toastTimer: null,
  };

  /* =====================================================================
   * Speicher
   * ===================================================================== */
  function defaults() {
    return {
      app: 'erinnerungen',
      version: 1,
      tasks: [],
      deleted: {}, // id -> Löschzeitpunkt (damit gelöschte Einträge bei der Synchronisation nicht zurückkommen)
      settings: { defaultTime: '08:00', summaryEnabled: true, summaryTime: '08:00', sound: true, hideNotifBanner: false },
      meta: { lastBackup: null, lastSummaryDate: null },
    };
  }

  function normalizeDeleted(obj) {
    const out = {};
    const cutoff = Date.now() - 180 * DAY;
    if (obj && typeof obj === 'object') {
      for (const [id, at] of Object.entries(obj)) {
        const iso = validIso(at);
        if (iso && Date.parse(iso) > cutoff) out[id] = iso;
      }
    }
    return out;
  }

  function validIso(v) {
    if (!v) return null;
    const d = new Date(v);
    return isNaN(d) ? null : d.toISOString();
  }

  function normalizeTask(t) {
    const notes = Array.isArray(t.notes) ? t.notes : [];
    return {
      id: t.id || uid(),
      title: String(t.title || '').trim() || '(ohne Titel)',
      remindAt: validIso(t.remindAt),
      notifiedFor: validIso(t.notifiedFor),
      important: !!t.important,
      done: !!t.done,
      doneAt: validIso(t.doneAt),
      notes: notes
        .filter((n) => n && String(n.text || '').trim())
        .map((n) => ({ id: n.id || uid(), at: validIso(n.at) || nowIso(), text: String(n.text).trim() }))
        .sort((a, b) => a.at.localeCompare(b.at)),
      createdAt: validIso(t.createdAt) || nowIso(),
      updatedAt: validIso(t.updatedAt) || nowIso(),
    };
  }

  function normalize(d) {
    const base = defaults();
    if (!d || typeof d !== 'object') return base;
    return {
      app: 'erinnerungen',
      version: 1,
      tasks: Array.isArray(d.tasks) ? d.tasks.map(normalizeTask) : [],
      deleted: normalizeDeleted(d.deleted),
      settings: { ...base.settings, ...(d.settings || {}) },
      meta: { ...base.meta, ...(d.meta || {}) },
    };
  }

  function load() {
    let raw = null;
    try {
      raw = localStorage.getItem(STORE_KEY);
      return raw ? normalize(JSON.parse(raw)) : defaults();
    } catch (e) {
      console.error('Laden fehlgeschlagen', e);
      // Beschädigte Daten nicht überschreiben, sondern beiseitelegen.
      try { if (raw) localStorage.setItem(`${STORE_KEY}-defekt-${Date.now()}`, raw); } catch (_) { /* egal */ }
      ui.storageOk = false;
      return defaults();
    }
  }

  let data = load();

  /* ---------- Farbschema ---------- */
  const THEMES = [
    { key: 'messing', name: 'Graphit & Messing', desc: 'Warm und edel, mit Serifen-Überschriften', sw: ['#1b1a17', '#9a7b4f', '#f3f1ec'] },
    { key: 'marine', name: 'Marineblau', desc: 'Klassisch, kühl und seriös', sw: ['#1d3557', '#2c64a6', '#f2f4f7'] },
  ];
  const URLP = new URLSearchParams(location.search);
  const PREVIEW = URLP.has('preview'); // Vergleichsansicht: nur anzeigen, nichts auslösen
  function applyTheme() {
    const forced = URLP.get('theme');
    const key = THEMES.some((t) => t.key === forced) ? forced : data.settings.theme;
    document.documentElement.dataset.theme = THEMES.some((t) => t.key === key) ? key : 'marine';
  }
  applyTheme();

  function save(opts = {}) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
      ui.storageOk = true;
    } catch (e) {
      console.error('Speichern fehlgeschlagen', e);
      ui.storageOk = false;
      renderBanners();
    }
    if (!opts.noSync) scheduleSync();
  }

  let saveTimer = null;
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 400);
  }

  const findTask = (id) => data.tasks.find((t) => t.id === id);
  const touch = (t) => { t.updatedAt = nowIso(); };

  /* =====================================================================
   * Datum & Zeit
   * ===================================================================== */
  const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const timeStr = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const startOfToday = () => startOfDay(new Date()).getTime();
  const endOfToday = () => { const d = startOfDay(new Date()); d.setDate(d.getDate() + 1); return d.getTime(); };

  function defTime() {
    const [h, mi] = String(data.settings.defaultTime || '08:00').split(':').map(Number);
    return { h: h || 0, mi: mi || 0 };
  }
  function atTime(base, h, mi) { const d = new Date(base); d.setHours(h, mi, 0, 0); return d; }
  function addDays(base, n) { const d = new Date(base); d.setDate(d.getDate() + n); return d; }

  /* Uhrzeit-Auswahl: nur halbe Stunden von 06:00 bis 20:00 – kurze Liste statt freier Eingabe */
  const TIME_SLOTS = [];
  for (let m = 6 * 60; m <= 20 * 60; m += 30) TIME_SLOTS.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`);

  // Kombifeld: Klick öffnet die Halbstunden-Liste, Eintippen geht trotzdem (9 → 09:00, 930 → 09:30, 14.45 → 14:45)
  function timeInput(id, value, allowEmpty) {
    return `<input type="text" class="field time-input" id="${id}" value="${esc(value || '')}"${allowEmpty ? ' data-allow-empty="1"' : ''} inputmode="numeric" autocomplete="off" spellcheck="false" placeholder="hh:mm" aria-label="Uhrzeit">`;
  }
  function setTimeSelect(el, value) {
    if (el) el.value = value || '';
  }
  function parseTimeInput(s) {
    s = String(s || '').trim().replace(/\s*uhr$/i, '');
    if (!s) return '';
    let m = s.match(/^(\d{1,2})(?:[:.,\s](\d{1,2}))?$/);
    if (!m) { const k = s.match(/^(\d{3,4})$/); if (k) m = [null, k[1].slice(0, -2), k[1].slice(-2)]; }
    if (!m) return null;
    const h = Number(m[1]);
    const mi = m[2] == null ? 0 : Number(m[2].length === 1 ? m[2] + '0' : m[2]);
    if (h > 23 || mi > 59) return null;
    return `${pad(h)}:${pad(mi)}`;
  }

  function combine(dateVal, timeVal) {
    if (!dateVal) return null;
    const [y, m, d] = dateVal.split('-').map(Number);
    const t = timeVal ? timeVal.split(':').map(Number) : [defTime().h, defTime().mi];
    const r = new Date(y, m - 1, d, t[0] || 0, t[1] || 0, 0, 0);
    return isNaN(r) ? null : r;
  }

  const fmtWeekday = new Intl.DateTimeFormat('de-DE', { weekday: 'short' });
  const fmtLong = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  const fmtLongY = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  function dayDiff(d) { return Math.round((startOfDay(d) - startOfDay(new Date())) / DAY); }

  function dayLabel(d) {
    const diff = dayDiff(d);
    if (diff === 0) return 'Heute';
    if (diff === 1) return 'Morgen';
    if (diff === 2) return 'Übermorgen';
    if (diff === -1) return 'Gestern';
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return `${fmtWeekday.format(d)}, ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${sameYear ? '' : d.getFullYear()}`;
  }
  function longDay(d) {
    const full = (d.getFullYear() === new Date().getFullYear() ? fmtLong : fmtLongY).format(d);
    const diff = dayDiff(d);
    const rel = { 0: 'Heute', 1: 'Morgen', 2: 'Übermorgen', '-1': 'Gestern' }[diff];
    return rel ? `${rel} · ${full}` : full;
  }
  function fmtWhen(iso) { if (!iso) return ''; const d = new Date(iso); return `${dayLabel(d)}, ${timeStr(d)}`; }
  function fmtStamp(iso) { const d = new Date(iso); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}, ${timeStr(d)}`; }

  function snoozeTarget(key) {
    const now = new Date();
    const { h, mi } = defTime();
    switch (key) {
      case 'tomorrow': return atTime(addDays(now, 1), h, mi);
      case '2days': return atTime(addDays(now, 2), h, mi);
      case '1week': return atTime(addDays(now, 7), h, mi);
      default: return null;
    }
  }
  const SNOOZES = [
    { key: 'tomorrow', label: 'Morgen' },
    { key: '2days', label: 'Übermorgen' },
    { key: '1week', label: 'In 1 Woche' },
  ];

  /* =====================================================================
   * Aktionen auf Erinnerungen
   * ===================================================================== */
  function setReminder(t, date) {
    t.remindAt = date ? date.toISOString() : null;
    t.notifiedFor = null; // neuer Zeitpunkt -> wieder benachrichtigen
    touch(t);
    save();
  }

  function snooze(t, key) {
    const target = snoozeTarget(key);
    if (!target) return;
    if (t.done) { t.done = false; t.doneAt = null; }
    setReminder(t, target);
    removeAlert(t.id);
    render();
    if (ui.selectedId === t.id) renderDetail();
    toast(`Verschoben auf ${fmtWhen(t.remindAt)}`);
  }

  function toggleDone(t) {
    const before = { done: t.done, doneAt: t.doneAt, updatedAt: t.updatedAt };
    t.done = !t.done;
    t.doneAt = t.done ? nowIso() : null;
    touch(t);
    save();
    removeAlert(t.id);
    render();
    if (ui.selectedId === t.id) renderDetail();
    toast(t.done ? `„${t.title}“ erledigt` : `„${t.title}“ wieder geöffnet`, () => {
      Object.assign(t, before);
      save();
      render();
      if (ui.selectedId === t.id) renderDetail();
    });
  }

  function toggleStar(t) {
    t.important = !t.important;
    touch(t);
    save();
    render();
    if (ui.selectedId === t.id) renderDetail();
  }

  function deleteTask(t) {
    const idx = data.tasks.indexOf(t);
    if (idx < 0) return;
    data.tasks.splice(idx, 1);
    data.deleted[t.id] = nowIso();
    save();
    removeAlert(t.id);
    if (ui.selectedId === t.id) closeDetail();
    render();
    toast(`„${t.title}“ gelöscht`, () => {
      delete data.deleted[t.id];
      touch(t); // neuer als der Löschzeitpunkt -> bleibt auch nach Synchronisation erhalten
      data.tasks.splice(Math.min(idx, data.tasks.length), 0, t);
      save();
      render();
    }, 9000);
  }

  function addNote(t, text) {
    text = String(text || '').trim();
    if (!text) return;
    t.notes.push({ id: uid(), at: nowIso(), text });
    touch(t);
    save();
    render();
    renderDetail();
  }

  /* =====================================================================
   * Ansichten
   * ===================================================================== */
  const VIEWS = {
    today: { title: 'Heute', icon: ICON.sun },
    planned: { title: 'Geplant', icon: ICON.calendar },
    all: { title: 'Alle offenen', icon: ICON.list },
    done: { title: 'Erledigt', icon: ICON.doneAll },
  };

  const remindTs = (t) => (t.remindAt ? Date.parse(t.remindAt) : Infinity);
  const byRemind = (a, b) => remindTs(a) - remindTs(b) || a.createdAt.localeCompare(b.createdAt);
  const doneTs = (t) => Date.parse(t.doneAt || t.updatedAt);

  function searchTerms() {
    return ui.query.toLowerCase().split(/\s+/).filter(Boolean);
  }
  function matches(t, terms) {
    const hay = (t.title + '\n' + t.notes.map((n) => n.text).join('\n')).toLowerCase();
    return terms.every((x) => hay.includes(x));
  }

  function groupByDay(tasks, tsFn) {
    const groups = new Map();
    for (const t of tasks) {
      const d = new Date(tsFn(t));
      const k = dateKey(d);
      if (!groups.has(k)) groups.set(k, { title: longDay(d), items: [] });
      groups.get(k).items.push(t);
    }
    return [...groups.values()];
  }

  function counts() {
    const sod = startOfToday();
    const eod = endOfToday();
    let today = 0, overdue = 0, planned = 0, open = 0, done = 0;
    for (const t of data.tasks) {
      if (t.done) { done++; continue; }
      open++;
      const ts = remindTs(t);
      if (ts < sod) { overdue++; today++; } else if (ts < eod) today++; else if (ts !== Infinity) planned++;
    }
    return { today, overdue, planned, open, done };
  }

  function sectionsFor(view) {
    const sod = startOfToday();
    const eod = endOfToday();
    const open = data.tasks.filter((t) => !t.done).sort(byRemind);
    const done = data.tasks.filter((t) => t.done).sort((a, b) => doneTs(b) - doneTs(a));

    if (ui.query.trim()) {
      const terms = searchTerms();
      return [
        { title: 'Offen', items: open.filter((t) => matches(t, terms)) },
        { title: 'Erledigt', items: done.filter((t) => matches(t, terms)) },
      ];
    }

    const overdue = open.filter((t) => remindTs(t) < sod);
    switch (view) {
      case 'today':
        return [
          { title: 'Überfällig', cls: 'overdue', items: overdue },
          { title: longDay(new Date()), items: open.filter((t) => { const ts = remindTs(t); return ts >= sod && ts < eod; }) },
        ];
      case 'planned':
        return groupByDay(open.filter((t) => { const ts = remindTs(t); return ts >= eod && ts !== Infinity; }), remindTs);
      case 'all':
        return [
          { title: 'Überfällig', cls: 'overdue', items: overdue },
          ...groupByDay(open.filter((t) => { const ts = remindTs(t); return ts >= sod && ts !== Infinity; }), remindTs),
          { title: 'Ohne Termin', items: open.filter((t) => !t.remindAt) },
        ];
      case 'done':
        return groupByDay(done, doneTs).map((g) => ({ ...g, title: `Erledigt ${g.title.replace(/^(Heute|Gestern) · /, (m, p) => p.toLowerCase() + ' · ')}` }));
      default:
        return [];
    }
  }

  function isVisibleInView(t, view) {
    return sectionsFor(view).some((s) => s.items.includes(t));
  }

  function bestViewFor(t) {
    if (t.done) return 'done';
    const ts = remindTs(t);
    if (ts === Infinity) return 'all';
    return ts < endOfToday() ? 'today' : 'planned';
  }

  /* =====================================================================
   * Rendering
   * ===================================================================== */
  function highlight(text, terms) {
    if (!terms.length) return esc(text);
    const re = new RegExp(`(${terms.map(reEsc).join('|')})`, 'gi');
    return String(text).split(re).map((p, i) => (i % 2 ? `<mark>${esc(p)}</mark>` : esc(p))).join('');
  }

  function snip(text, terms) {
    const low = text.toLowerCase();
    let i = terms.length ? Math.min(...terms.map((x) => { const k = low.indexOf(x); return k < 0 ? Infinity : k; })) : 0;
    if (!isFinite(i)) i = 0;
    const start = Math.max(0, i - 30);
    return (start > 0 ? '…' : '') + text.slice(start, start + 140).replace(/\s+/g, ' ');
  }

  function taskRow(t) {
    const terms = searchTerms();
    const ts = t.remindAt ? Date.parse(t.remindAt) : null;
    let whenCls = '';
    if (ts && !t.done) {
      if (ts < startOfToday()) whenCls = 'overdue';
      else if (ts <= Date.now()) whenCls = 'due';
    }
    const meta = [];
    if (t.done) meta.push(`<span class="chip done">${ICON.check} Erledigt ${esc(fmtWhen(t.doneAt || t.updatedAt))}</span>`);
    if (ts) meta.push(`<span class="chip when ${whenCls}" title="Erinnerung">${ICON.bell} ${esc(fmtWhen(t.remindAt))}</span>`);
    if (t.notes.length) meta.push(`<span class="chip" title="Anzahl Bemerkungen">${ICON.note} ${t.notes.length}</span>`);

    let snippet = '';
    if (terms.length) {
      const n = [...t.notes].reverse().find((x) => terms.some((k) => x.text.toLowerCase().includes(k)));
      if (n) snippet = `<span class="snippet">${highlight(snip(n.text, terms), terms)}</span>`;
    } else if (t.notes.length) {
      const last = t.notes[t.notes.length - 1];
      snippet = `<span class="snippet">${esc(last.text.replace(/\s+/g, ' '))}</span>`;
    }

    return `<div class="task${t.done ? ' is-done' : ''}${whenCls ? ` is-${whenCls}` : ''}${t.id === ui.selectedId ? ' is-selected' : ''}" data-id="${esc(t.id)}">
      <button class="check" type="button" data-act="toggle" title="${t.done ? 'Wieder öffnen' : 'Als erledigt markieren'}" aria-label="${t.done ? 'Wieder öffnen' : 'Als erledigt markieren'}">${ICON.check}</button>
      <button class="task-main" type="button" data-act="open"><span class="task-title">${highlight(t.title, terms)}</span>${meta.length ? `<span class="task-meta">${meta.join('')}</span>` : ''}${snippet}</button>
      <button class="star${t.important ? ' on' : ''}" type="button" data-act="star" title="Wichtig" aria-pressed="${t.important}">${ICON.star}</button>
    </div>`;
  }

  function emptyState() {
    if (ui.query.trim()) return `<div class="empty"><div class="empty-art">${ICON.search}</div><strong>Nichts gefunden</strong>Keine Erinnerung enthält „${esc(ui.query.trim())}“.</div>`;
    const msg = {
      today: ['Für heute ist nichts fällig', 'Neue Erinnerungen oben eintragen – sie erscheinen hier am jeweiligen Tag.'],
      planned: ['Keine zukünftigen Erinnerungen', 'Alles mit einem Datum ab morgen erscheint hier.'],
      all: ['Keine offenen Erinnerungen', 'Alles erledigt. Neue Erinnerungen oben eintragen oder unten links importieren.'],
      done: ['Noch nichts erledigt', 'Erledigte Erinnerungen werden hier gesammelt und bleiben durchsuchbar.'],
    }[ui.view];
    return `<div class="empty"><div class="empty-art">${VIEWS[ui.view].icon}</div><strong>${msg[0]}</strong>${msg[1]}</div>`;
  }

  function renderNav() {
    const c = counts();
    const n = { today: c.today, planned: c.planned, all: c.open, done: c.done };
    $('#nav').innerHTML = Object.entries(VIEWS).map(([key, v]) => {
      const alert = key === 'today' && c.overdue > 0;
      return `<button type="button" data-view="${key}" class="${ui.view === key && !ui.query.trim() ? 'active' : ''}">
        <span class="ico">${v.icon}</span><span>${v.title}</span><span class="count${alert ? ' alert' : ''}" title="${alert ? `${c.overdue} überfällig` : ''}">${n[key] || ''}</span></button>`;
    }).join('');
  }

  function greeting() {
    const h = new Date().getHours();
    if (h < 5) return 'Gute Nacht';
    if (h < 11) return 'Guten Morgen';
    if (h < 18) return 'Guten Tag';
    return 'Guten Abend';
  }

  function renderStats() {
    const el = $('#stats');
    if (ui.query.trim() || ui.view !== 'today') { el.innerHTML = ''; return; }
    const c = counts();
    const sod = startOfToday();
    const doneToday = data.tasks.filter((t) => t.done && doneTs(t) >= sod).length;
    const weekEnd = endOfToday() + 7 * DAY;
    const week = data.tasks.filter((t) => !t.done && remindTs(t) >= endOfToday() && remindTs(t) < weekEnd).length;
    const total = doneToday + c.today;
    const pct = total ? doneToday / total : 0;
    const r = 19;
    const circ = 2 * Math.PI * r;
    el.innerHTML = `
      <div class="stat hero-stat">
        <svg class="ring" viewBox="0 0 46 46" aria-hidden="true"><circle class="track" cx="23" cy="23" r="${r}"/><circle class="bar" cx="23" cy="23" r="${r}" stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${(circ * (1 - pct)).toFixed(1)}"/></svg>
        <div><b>${doneToday}<small style="font-size:16px;opacity:.7"> / ${total}</small></b><span>${total && doneToday === total ? 'Alles erledigt – stark!' : 'heute erledigt'}</span></div>
      </div>
      <div class="stat${c.today - c.overdue ? '' : ' muted'}"><div><b>${c.today - c.overdue}</b><span>heute fällig</span></div></div>
      <div class="stat${c.overdue ? ' danger' : ' muted'}"><div><b>${c.overdue}</b><span>überfällig</span></div></div>
      <button type="button" class="stat${week ? '' : ' muted'}" data-view-jump="planned"><div><b>${week}</b><span>in den nächsten 7 Tagen</span></div></button>`;
  }

  function renderHeader() {
    const q = ui.query.trim();
    $('#view-eyebrow').textContent = !q && ui.view === 'today' ? greeting() : '';
    renderStats();
    if (q) {
      $('#view-title').textContent = 'Suche';
      $('#view-sub').textContent = `Ergebnisse für „${q}“ – offen und erledigt`;
    } else {
      $('#view-title').textContent = VIEWS[ui.view].title;
      $('#view-sub').textContent = {
        today: fmtLongY.format(new Date()),
        planned: 'Alle Erinnerungen ab morgen',
        all: 'Alles, was noch offen ist – mit und ohne Termin',
        done: 'Abgeschlossene Erinnerungen, neueste zuerst',
      }[ui.view];
    }
    document.title = ui.alertIds.length ? `(${ui.alertIds.length}) Erinnerung fällig – Erinnerungen` : 'Erinnerungen';
  }

  function renderList() {
    const secs = sectionsFor(ui.view).filter((s) => s.items.length);
    const el = $('#list');
    if (!secs.length) { el.innerHTML = emptyState(); return; }
    el.innerHTML = secs.map((s) => `<section class="group ${s.cls || ''}">
      <h2>${esc(s.title)} <span class="n">${s.items.length}</span></h2>
      ${s.items.map(taskRow).join('')}
    </section>`).join('');
  }

  function renderBanners() {
    const out = [];
    if (!window.isSecureContext) {
      out.push(`<div class="banner danger"><span class="grow"><b>Hinweis:</b> Die Seite ist direkt als Datei geöffnet. Pop-up-Benachrichtigungen funktionieren nur, wenn sie über eine Internetadresse (https, z. B. GitHub Pages) aufgerufen wird.</span></div>`);
    } else if (!('Notification' in window)) {
      out.push(`<div class="banner"><span class="grow">Dieser Browser unterstützt keine Windows-Benachrichtigungen. Erinnerungen erscheinen nur hier im Fenster.</span></div>`);
    } else if (Notification.permission === 'default' && !data.settings.hideNotifBanner) {
      out.push(`<div class="banner"><span class="grow"><b>Tipp: Zusätzlich Windows-Benachrichtigungen erlauben.</b> Erinnerungen poppen immer hier in der App auf. Mit Windows-Benachrichtigung bemerkst du sie auch, wenn Outlook oder ein anderes Programm im Vordergrund ist.</span><button class="btn primary" type="button" data-act="perm">Erlauben</button><button class="btn" type="button" data-act="hide-notif">Nicht nötig</button></div>`);
    } else if (Notification.permission === 'denied' && !data.settings.hideNotifBanner) {
      out.push(`<div class="banner"><span class="grow"><b>Windows-Benachrichtigungen sind blockiert.</b> Erinnerungen poppen trotzdem hier in der App auf, solange der Tab offen ist. Zum Erlauben: links neben der Adresse auf das Schloss-Symbol klicken → „Benachrichtigungen“ → „Zulassen“.</span><button class="btn" type="button" data-act="hide-notif">Ausblenden</button></div>`);
    }
    if (ghOn() && gh.state === 'error') {
      out.push(`<div class="banner danger"><span class="grow"><b>GitHub-Sicherung fehlgeschlagen:</b> ${esc(gh.msg)} Deine Daten sind weiterhin im Browser gespeichert.</span><button class="btn" type="button" data-act="gh-sync">Erneut versuchen</button><button class="btn" type="button" data-act="settings">Einstellungen</button></div>`);
    }
    if (!ui.storageOk) {
      out.push(`<div class="banner danger"><span class="grow"><b>Speichern im Browser ist fehlgeschlagen.</b> Bitte sofort eine Sicherung herunterladen, damit nichts verloren geht.</span><button class="btn" type="button" data-act="backup">Sicherung herunterladen</button></div>`);
    }
    const last = data.meta.lastBackup ? Date.parse(data.meta.lastBackup) : null;
    const ghFresh = ghOn() && gh.cfg.lastOk && Date.now() - Date.parse(gh.cfg.lastOk) < BACKUP_INTERVAL_DAYS * DAY;
    const needBackup = !ghFresh && data.tasks.length > 0 && (!last || Date.now() - last > BACKUP_INTERVAL_DAYS * DAY);
    if (needBackup && !ui.backupBannerHidden) {
      const txt = last ? `Letzte Sicherung vor ${Math.floor((Date.now() - last) / DAY)} Tagen.` : 'Es wurde noch keine Sicherung erstellt.';
      out.push(`<div class="banner"><span class="grow"><b>${txt}</b> Am bequemsten: die automatische GitHub-Sicherung in den Einstellungen einrichten. Oder eine Sicherungsdatei herunterladen.</span><button class="btn primary" type="button" data-act="settings">GitHub-Sicherung einrichten</button><button class="btn" type="button" data-act="backup">${ICON.download} Datei</button><button class="btn" type="button" data-act="backup-later">Später</button></div>`);
    }
    $('#banners').innerHTML = out.join('');
  }

  function renderFoot() {
    $('#sidebar-foot').innerHTML = `
      <button type="button" data-act="settings" id="sync-status" class="sync-status"></button>
      <button type="button" data-act="import">${ICON.upload}<span>Importieren</span></button>
      <button type="button" data-act="backup">${ICON.download}<span>Sicherung herunterladen</span></button>
      <button type="button" data-act="settings">${ICON.settings}<span>Einstellungen</span></button>`;
  }

  function render() {
    renderNav();
    renderHeader();
    renderBanners();
    renderList();
  }

  /* ---------- Detailbereich ---------- */
  // Getippte, aber noch nicht hinzugefügte Bemerkung automatisch übernehmen, damit nichts verloren geht
  function flushNoteDraft() {
    const t = findTask(ui.detailId);
    if (!t) return;
    let changed = false;
    const ed = $('#d-note-edit');
    const n = ed && t.notes.find((x) => x.id === ui.editingNoteId);
    if (n && ed.value.trim() && ed.value.trim() !== n.text) { n.text = ed.value.trim(); changed = true; }
    const ta = $('#d-note');
    if (ta && ta.value.trim()) {
      t.notes.push({ id: uid(), at: nowIso(), text: ta.value.trim() });
      ta.value = '';
      changed = true;
    }
    if (changed) { touch(t); save(); toast('Bemerkung automatisch gespeichert'); }
  }
  window.addEventListener('pagehide', flushNoteDraft);

  function openTask(id, opts = {}) {
    const t = findTask(id);
    if (!t) return;
    if (ui.detailId && ui.detailId !== id) flushNoteDraft();
    if (!ui.query.trim() && !isVisibleInView(t, ui.view)) ui.view = bestViewFor(t);
    if (ui.selectedId !== id) { ui.snoozeOpen = false; ui.calOpen = false; } // Menüs bei anderer Erinnerung zuklappen
    ui.selectedId = id;
    ui.editingNoteId = null;
    render();
    renderDetail();
    const row = document.querySelector(`.task[data-id="${CSS.escape(id)}"]`);
    if (row) row.scrollIntoView({ block: 'nearest' });
    if (opts.focusNote) setTimeout(() => $('#d-note')?.focus(), 30);
  }

  function closeDetail() {
    flushNoteDraft();
    ui.detailId = null;
    ui.selectedId = null;
    ui.editingNoteId = null;
    $('#detail').hidden = true;
    $('#detail').innerHTML = '';
    renderList();
  }

  function renderDetail() {
    const el = $('#detail');
    const t = findTask(ui.selectedId);
    if (!t) { el.hidden = true; el.innerHTML = ''; ui.detailId = null; return; }
    el.hidden = false;
    // Bereits getippten Bemerkungstext beim Neuaufbau behalten
    const draft = ui.detailId === t.id ? ($('#d-note')?.value || '') : '';

    const d = t.remindAt ? new Date(t.remindAt) : null;

    const notes = [...t.notes].reverse().map((n) => {
      if (n.id === ui.editingNoteId) {
        return `<li data-note="${esc(n.id)}">
          <div class="note-time">${esc(fmtStamp(n.at))}</div>
          <textarea class="field note-input" id="d-note-edit">${esc(n.text)}</textarea>
          <div class="row" style="margin-top:6px"><button class="btn small primary" type="button" data-act="note-save">Speichern</button><button class="btn small" type="button" data-act="note-cancel">Abbrechen</button></div>
        </li>`;
      }
      return `<li data-note="${esc(n.id)}">
        <div class="note-time">${esc(fmtStamp(n.at))}<span class="spacer"></span>
          <button type="button" data-act="note-edit">Bearbeiten</button><button type="button" data-act="note-del">Löschen</button></div>
        <div class="note-text">${esc(n.text)}</div>
      </li>`;
    }).join('');

    el.innerHTML = `
      <div class="d-head">
        <button class="check${t.done ? ' ' : ''}" type="button" data-act="toggle" title="${t.done ? 'Wieder öffnen' : 'Als erledigt markieren'}">${ICON.check}</button>
        <textarea class="d-title" id="d-title" rows="1" aria-label="Titel">${esc(t.title)}</textarea>
        <button class="star${t.important ? ' on' : ''}" type="button" data-act="star" title="Wichtig">${ICON.star}</button>
        <button class="icon-btn" type="button" data-act="close" title="Schließen (Esc)">${ICON.close}</button>
      </div>

      <section class="card">
        <h3>${ICON.bell} Erinnerung</h3>
        <div class="when-edit">
          <input class="field" type="date" id="d-date" value="${d ? dateKey(d) : ''}" aria-label="Datum">
          ${timeInput('d-time', d ? timeStr(d) : '', true)}
          ${d ? `<button class="icon-btn small" type="button" data-act="clear-remind" title="Erinnerung entfernen">${ICON.close}</button>` : ''}
          <span class="grow"></span>
          <button class="snooze-toggle${ui.snoozeOpen ? ' open' : ''}" type="button" data-act="snooze-toggle" aria-expanded="${!!ui.snoozeOpen}">${ICON.calendar}Verschieben<svg viewBox="0 0 24 24" class="caret" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>
        </div>
        ${statusLineHtml(t)}
        <div class="snooze-menu" ${ui.snoozeOpen ? '' : 'hidden'}>${snoozeMenuInner(t)}</div>
      </section>

      <section class="card">
        <h3>${ICON.note} Bemerkungen &amp; Verlauf</h3>
        <textarea class="field note-input" id="d-note" placeholder="Aktualisierung erfassen … (Strg + Enter speichert)"></textarea>
        <div class="row" style="margin-top:6px"><button class="btn small primary" type="button" data-act="note-add">Bemerkung hinzufügen</button></div>
        ${notes ? `<ul class="notes">${notes}</ul>` : '<p class="hint">Noch keine Bemerkungen. Jede Bemerkung wird mit Datum und Uhrzeit gespeichert.</p>'}
      </section>

      <div class="d-foot">
        <span class="grow">Erstellt ${esc(fmtStamp(t.createdAt))}${t.done ? ` · Erledigt ${esc(fmtStamp(t.doneAt || t.updatedAt))}` : ''}</span>
        <button class="btn small danger" type="button" data-act="delete">${ICON.trash} Löschen</button>
      </div>`;

    ui.detailId = t.id;
    if (draft) $('#d-note').value = draft;
    if (ui.editingNoteId) setTimeout(() => { const ta = $('#d-note-edit'); if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } }, 0);
  }

  const fmtMonthYear = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' });

  // Kleine Statuszeile unter Datum/Uhrzeit
  function statusLineHtml(t) {
    let text = 'Keine Erinnerung gesetzt.';
    let cls = '';
    if (t.remindAt) {
      const ts = Date.parse(t.remindAt);
      if (t.done) text = `Erinnerung war für ${fmtWhen(t.remindAt)} Uhr geplant.`;
      else if (ts < startOfToday()) { text = `Überfällig seit ${fmtWhen(t.remindAt)} Uhr`; cls = ' overdue'; }
      else if (ts <= Date.now()) text = `Fällig seit ${fmtWhen(t.remindAt)} Uhr`;
      else text = `Erinnert ${fmtWhen(t.remindAt)} Uhr`;
    }
    return `<div class="when-status${cls}" id="d-status">${esc(text)}</div>`;
  }

  function snoozeMenuInner(t) {
    const chips = SNOOZES.map((s) => {
      const x = snoozeTarget(s.key);
      return `<button type="button" data-act="snooze" data-key="${s.key}" title="${esc(fmtWhen(x.toISOString()))} Uhr">${s.label}<small>${pad(x.getDate())}.${pad(x.getMonth() + 1)}.</small></button>`;
    }).join('');
    return `<div class="snooze-chips">${chips}
        <button type="button" data-act="cal-toggle" class="cal-chip${ui.calOpen ? ' on' : ''}">${ICON.calendar}Kalender</button>
      </div>
      ${ui.calOpen ? calHtml(t) : ''}
      <p class="snooze-hint">Neuer Termin jeweils um ${esc(data.settings.defaultTime)} Uhr (Standard-Uhrzeit).</p>`;
  }

  // Monatskalender zum längerfristigen Verschieben
  function calHtml(t) {
    if (!ui.calMonth) ui.calMonth = new Date();
    const m = new Date(ui.calMonth.getFullYear(), ui.calMonth.getMonth(), 1);
    const sel = t.remindAt ? dateKey(new Date(t.remindAt)) : '';
    const todayKey = dateKey(new Date());
    const offset = (m.getDay() + 6) % 7; // Montag zuerst
    const daysInMonth = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    const weeks = Math.ceil((offset + daysInMonth) / 7);
    const start = addDays(m, -offset);
    const thisMonth = new Date(); thisMonth.setDate(1); thisMonth.setHours(0, 0, 0, 0);
    let cells = '';
    for (let i = 0; i < weeks * 7; i++) {
      const day = addDays(start, i);
      const key = dateKey(day);
      const cls = [
        day.getMonth() !== m.getMonth() ? 'other' : '',
        key === todayKey ? 'today' : '',
        key === sel ? 'sel' : '',
        (i % 7) >= 5 ? 'we' : '',
      ].filter(Boolean).join(' ');
      const past = key < todayKey;
      cells += `<button type="button" class="${cls}" data-act="cal-pick" data-date="${key}"${past ? ' disabled' : ''} title="${esc(fmtLongY.format(day))}">${day.getDate()}</button>`;
    }
    return `<div class="cal">
      <div class="cal-head">
        <button type="button" class="icon-btn small" data-act="cal-prev" title="Vorheriger Monat"${m <= thisMonth ? ' disabled' : ''}><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg></button>
        <b>${esc(fmtMonthYear.format(m))}</b>
        <button type="button" class="icon-btn small" data-act="cal-next" title="Nächster Monat"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button>
      </div>
      <div class="cal-grid cal-wd"><span>Mo</span><span>Di</span><span>Mi</span><span>Do</span><span>Fr</span><span>Sa</span><span>So</span></div>
      <div class="cal-grid">${cells}</div>
    </div>`;
  }

  function renderSnoozeMenu(t) {
    const menu = $('#detail .snooze-menu');
    if (menu) menu.innerHTML = snoozeMenuInner(t);
  }

  function updateDetailStatus(t) {
    // kleine Aktualisierung ohne kompletten Neuaufbau (z. B. während Datumseingabe)
    const el = $('#d-status');
    if (el) el.outerHTML = statusLineHtml(t);
    if (ui.snoozeOpen) renderSnoozeMenu(t);
  }

  /* =====================================================================
   * Toast
   * ===================================================================== */
  function toast(msg, undoFn, ms = 5000) {
    const el = $('#toast');
    el.innerHTML = `<span>${esc(msg)}</span>${undoFn ? '<button type="button">Rückgängig</button>' : ''}`;
    el.classList.add('show');
    clearTimeout(ui.toastTimer);
    const hide = () => el.classList.remove('show');
    if (undoFn) el.querySelector('button').onclick = () => { undoFn(); hide(); };
    ui.toastTimer = setTimeout(hide, ms);
  }

  /* =====================================================================
   * Benachrichtigungen & Pop-ups
   * ===================================================================== */
  let swReg = null;
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('sw.js').then((r) => { swReg = r; }).catch((e) => console.warn('Service Worker nicht verfügbar', e));
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'notification-action') handleNotifAction(e.data.action, e.data.id);
    });
  }

  async function requestPermission() {
    if (!('Notification' in window)) return;
    try { await Notification.requestPermission(); } catch (_) { /* ignorieren */ }
    renderBanners();
    if ($('#dlg-settings').open) renderSettings();
    if (Notification.permission === 'granted') notify('Benachrichtigungen sind aktiv', { body: 'So sehen deine Erinnerungen aus.', tag: 'welcome' });
  }

  async function notify(title, opts = {}) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return false;
    const base = {
      body: opts.body || '',
      tag: opts.tag || undefined,
      renotify: !!opts.tag,
      requireInteraction: true, // bleibt stehen, bis man reagiert – wie bei To Do
      icon: 'icon.svg',
      data: { id: opts.id || null },
    };
    try {
      const reg = swReg || (navigator.serviceWorker && await navigator.serviceWorker.getRegistration());
      if (reg && reg.showNotification) {
        const o = { ...base };
        if (opts.id) o.actions = [{ action: 'done', title: 'Erledigt' }, { action: 'snooze', title: 'Morgen erinnern' }];
        await reg.showNotification(title, o);
        return true;
      }
    } catch (e) { console.warn('showNotification fehlgeschlagen, nutze Fallback', e); }
    try {
      const n = new Notification(title, base);
      n.onclick = () => { window.focus(); if (opts.id) openTask(opts.id); n.close(); };
      return true;
    } catch (e) { console.warn('Notification fehlgeschlagen', e); return false; }
  }

  async function closeSystemNotification(id) {
    try {
      const reg = swReg || (navigator.serviceWorker && await navigator.serviceWorker.getRegistration());
      if (!reg || !reg.getNotifications) return;
      (await reg.getNotifications({ tag: `task-${id}` })).forEach((n) => n.close());
    } catch (_) { /* egal */ }
  }

  function handleNotifAction(action, id) {
    const t = id && findTask(id);
    if (!t) { window.focus(); return; }
    if (action === 'done') { if (!t.done) toggleDone(t); }
    else if (action === 'snooze') snooze(t, 'tomorrow');
    else openTask(id);
  }

  /* ---------- Ton ---------- */
  let audioCtx = null;
  function unlockAudio() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (_) { /* ohne Ton */ }
  }
  document.addEventListener('pointerdown', unlockAudio);
  document.addEventListener('keydown', unlockAudio);

  function chime() {
    if (!data.settings.sound || !audioCtx || audioCtx.state !== 'running') return;
    const t0 = audioCtx.currentTime;
    [784, 1047, 1319].forEach((f, i) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      const t = t0 + i * 0.16;
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
      o.connect(g).connect(audioCtx.destination);
      o.start(t);
      o.stop(t + 0.75);
    });
  }

  /* ---------- Pop-up im Fenster ---------- */
  function removeAlert(id) {
    const i = ui.alertIds.indexOf(id);
    if (i >= 0) ui.alertIds.splice(i, 1);
    closeSystemNotification(id);
    if ($('#dlg-alert').open) renderAlert();
    renderHeader();
  }

  function renderAlert() {
    ui.alertIds = ui.alertIds.filter((id) => { const t = findTask(id); return t && !t.done; });
    const dlg = $('#dlg-alert');
    if (!ui.alertIds.length) { if (dlg.open) dlg.close(); return; }
    dlg.querySelector('h2').textContent = ui.alertIds.length === 1 ? 'Erinnerung' : `${ui.alertIds.length} Erinnerungen`;
    $('#alert-body').innerHTML = ui.alertIds.map((id) => {
      const t = findTask(id);
      const last = t.notes[t.notes.length - 1];
      return `<div class="alert-item" data-id="${esc(t.id)}">
        <div class="alert-title">${t.important ? '★ ' : ''}${esc(t.title)}</div>
        <div class="alert-when">${esc(fmtWhen(t.remindAt))} Uhr</div>
        ${last ? `<div class="alert-note">Letzte Bemerkung (${esc(fmtStamp(last.at))}): ${esc(last.text)}</div>` : ''}
        <div class="alert-actions">
          <button class="btn primary small" type="button" data-act="a-done">${ICON.check} Erledigt</button>
          <button class="btn small" type="button" data-act="a-snooze" data-key="tomorrow">Morgen</button>
          <button class="btn small" type="button" data-act="a-snooze" data-key="2days">Übermorgen</button>
          <button class="btn small" type="button" data-act="a-snooze" data-key="1week">In 1 Woche</button>
          <button class="btn small" type="button" data-act="a-open">Öffnen / Bemerkung</button>
        </div>
      </div>`;
    }).join('');
    if (!dlg.open) dlg.showModal();
  }

  function fireReminders(list) {
    for (const t of list) if (!ui.alertIds.includes(t.id)) ui.alertIds.push(t.id);
    renderAlert();
    renderHeader();
    chime();
    if (list.length <= 3) {
      list.forEach((t) => {
        const last = t.notes[t.notes.length - 1];
        notify(t.title, { id: t.id, tag: `task-${t.id}`, body: `Erinnerung · ${fmtWhen(t.remindAt)} Uhr${last ? `\n${last.text.slice(0, 120)}` : ''}` });
      });
    } else {
      notify(`${list.length} Erinnerungen fällig`, { tag: 'sammel', body: list.slice(0, 5).map((t) => `• ${t.title}`).join('\n') });
    }
  }

  function checkDue() {
    const now = Date.now();
    const fresh = [];
    for (const t of data.tasks) {
      if (t.done || !t.remindAt) continue;
      if (Date.parse(t.remindAt) <= now && t.notifiedFor !== t.remindAt) {
        t.notifiedFor = t.remindAt;
        fresh.push(t);
      }
    }
    if (fresh.length) {
      save();
      fireReminders(fresh.sort(byRemind));
    }
  }

  function dailySummary() {
    const s = data.settings;
    if (!s.summaryEnabled) return;
    const now = new Date();
    const key = dateKey(now);
    if (data.meta.lastSummaryDate === key) return;
    const [h, mi] = String(s.summaryTime || '08:00').split(':').map(Number);
    if (now < atTime(now, h || 0, mi || 0)) return;
    data.meta.lastSummaryDate = key;
    save();
    const c = counts();
    if (!c.today) return;
    const list = data.tasks.filter((t) => !t.done && remindTs(t) < endOfToday()).sort(byRemind);
    const head = `Heute: ${c.today} Erinnerung${c.today === 1 ? '' : 'en'}${c.overdue ? ` (${c.overdue} überfällig)` : ''}`;
    notify(head, { tag: 'tagesuebersicht', body: list.slice(0, 6).map((t) => `• ${t.title}`).join('\n') + (list.length > 6 ? `\n… und ${list.length - 6} weitere` : '') });
    toast(head);
  }

  function tick(force) {
    checkDue();
    dailySummary();
    const now = new Date();
    const m = dateKey(now) + timeStr(now);
    if (force === true || m !== ui.lastMinute) {
      const dayChanged = ui.lastMinute && ui.lastMinute.slice(0, 10) !== m.slice(0, 10);
      ui.lastMinute = m;
      render();
      if (dayChanged) setAddDefaults();
    }
  }

  /* =====================================================================
   * Sicherung & Export
   * ===================================================================== */
  function download(name, content, type) {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  function exportBackup() {
    data.meta.lastBackup = nowIso();
    save();
    download(`erinnerungen-sicherung-${dateKey(new Date())}.json`, JSON.stringify({ ...data, exportedAt: nowIso() }, null, 2), 'application/json');
    renderBanners();
    if ($('#dlg-settings').open) renderSettings();
    toast('Sicherung heruntergeladen – am besten auf OneDrive oder einem Laufwerk ablegen.');
  }

  function exportCSV() {
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Titel', 'Erinnerung Datum', 'Erinnerung Uhrzeit', 'Wichtig', 'Erledigt', 'Erledigt am', 'Bemerkungen', 'Erstellt am'];
    const rows = [...data.tasks].sort(byRemind).map((t) => {
      const d = t.remindAt ? new Date(t.remindAt) : null;
      return [
        t.title,
        d ? `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}` : '',
        d ? timeStr(d) : '',
        t.important ? 'Ja' : 'Nein',
        t.done ? 'Ja' : 'Nein',
        t.done ? fmtStamp(t.doneAt || t.updatedAt) : '',
        t.notes.map((n) => `[${fmtStamp(n.at)}] ${n.text}`).join('\n'),
        fmtStamp(t.createdAt),
      ].map(q).join(';');
    });
    download(`erinnerungen-${dateKey(new Date())}.csv`, '﻿' + [head.map(q).join(';'), ...rows].join('\r\n'), 'text/csv;charset=utf-8');
  }

  /* =====================================================================
   * Import
   * ===================================================================== */
  /* =====================================================================
   * Automatische Sicherung auf GitHub (privates Repository)
   * Die Erinnerungen werden als JSON-Datei über die GitHub-API gespeichert.
   * Jede Sicherung ist ein Commit -> komplette Versionsgeschichte gratis.
   * ===================================================================== */
  const GH_KEY = 'erinnerungen-github-v1';
  const gh = { cfg: loadGh(), busy: false, again: false, timer: null, lastSig: null, state: 'off', msg: '' };

  function loadGh() {
    const base = { repo: '', token: '', path: 'erinnerungen.json', lastOk: null };
    try { return { ...base, ...JSON.parse(localStorage.getItem(GH_KEY) || '{}') }; } catch (_) { return base; }
  }
  function saveGh() { try { localStorage.setItem(GH_KEY, JSON.stringify(gh.cfg)); } catch (_) { /* egal */ } }
  const ghOn = () => !!(gh.cfg.repo && gh.cfg.token);
  if (ghOn()) gh.state = 'idle';

  const syncSig = (tasks, deleted) => JSON.stringify([tasks.map((t) => `${t.id}|${t.updatedAt}`).sort(), Object.entries(deleted || {}).sort()]);

  function b64enc(s) {
    const bytes = new TextEncoder().encode(s);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function b64dec(b) {
    const bin = atob(String(b || '').replace(/\s/g, ''));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  }

  async function ghFetch(method, body) {
    const path = gh.cfg.path.split('/').map(encodeURIComponent).join('/');
    const url = `https://api.github.com/repos/${gh.cfg.repo}/contents/${path}`;
    try {
      return await fetch(url, {
        method,
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${gh.cfg.token}`,
          Accept: 'application/vnd.github+json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (_) {
      throw new Error('GitHub ist nicht erreichbar – keine Internetverbindung oder vom Firmennetz blockiert.');
    }
  }

  async function ghError(res) {
    let m = '';
    try { m = (await res.json()).message || ''; } catch (_) { /* egal */ }
    if (res.status === 401) return 'Der Zugangsschlüssel (Token) ist ungültig oder abgelaufen.';
    if (res.status === 403) return `Keine Berechtigung – der Token braucht „Contents: Read and write“ für dieses Repository. ${m}`;
    if (res.status === 404) return 'Repository nicht gefunden – Namen prüfen (Format: benutzer/repository) und ob der Token Zugriff darauf hat.';
    return `GitHub meldet Fehler ${res.status}: ${m}`;
  }

  function mergeRemote(remote) {
    const before = syncSig(data.tasks, data.deleted);
    const deleted = { ...remote.deleted };
    for (const [id, at] of Object.entries(data.deleted)) if (!deleted[id] || at > deleted[id]) deleted[id] = at;
    const map = new Map(data.tasks.map((t) => [t.id, t]));
    const longAgo = Date.now() - 60 * 60000;
    for (const r of remote.tasks) {
      const cur = map.get(r.id);
      if (!cur) {
        // z. B. nach Zurücksetzen des Browsers: alte Erinnerungen nicht alle auf einmal aufpoppen lassen
        if (r.remindAt && Date.parse(r.remindAt) < longAgo) r.notifiedFor = r.remindAt;
        map.set(r.id, r);
      } else if (r.updatedAt > cur.updatedAt) {
        if (cur.notifiedFor && cur.notifiedFor === r.remindAt) r.notifiedFor = cur.notifiedFor;
        map.set(r.id, r);
      }
    }
    data.tasks = [...map.values()].filter((t) => !(deleted[t.id] && deleted[t.id] >= t.updatedAt));
    data.deleted = deleted;
    if (syncSig(data.tasks, data.deleted) !== before) {
      save({ noSync: true });
      render();
      if (ui.selectedId && !findTask(ui.selectedId)) closeDetail();
      else if (ui.selectedId && !$('#detail').contains(document.activeElement)) renderDetail();
    }
  }

  async function ghSync(force) {
    if (!ghOn()) return;
    if (gh.busy) { gh.again = true; return; }
    if (!force && syncSig(data.tasks, data.deleted) === gh.lastSig) return;
    gh.busy = true;
    gh.state = 'busy';
    renderSyncStatus();
    try {
      let ok = false;
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        const res = await ghFetch('GET');
        let remote = null;
        let sha;
        if (res.status === 200) {
          const j = await res.json();
          sha = j.sha;
          try { remote = normalize(JSON.parse(b64dec(j.content))); } catch (_) { throw new Error('Die Sicherungsdatei auf GitHub ist beschädigt.'); }
        } else if (res.status !== 404) throw new Error(await ghError(res));

        const remoteSig = remote ? syncSig(remote.tasks, remote.deleted) : null;
        if (remote) mergeRemote(remote);
        const mergedSig = syncSig(data.tasks, data.deleted);
        if (mergedSig === remoteSig) { gh.lastSig = mergedSig; ok = true; break; }

        const payload = { app: 'erinnerungen', version: 1, exportedAt: nowIso(), tasks: data.tasks, deleted: data.deleted };
        const put = await ghFetch('PUT', {
          message: `Sicherung ${fmtStamp(nowIso())} – ${data.tasks.length} Erinnerungen`,
          content: b64enc(JSON.stringify(payload, null, 1)),
          ...(sha ? { sha } : {}),
        });
        if (put.status === 409 || put.status === 422) continue; // zwischenzeitlich geändert -> neu laden und zusammenführen
        if (!put.ok) throw new Error(await ghError(put));
        gh.lastSig = mergedSig;
        ok = true;
      }
      if (!ok) throw new Error('Die Datei auf GitHub wurde gleichzeitig geändert. Neuer Versuch folgt automatisch.');
      gh.cfg.lastOk = nowIso();
      saveGh();
      gh.state = 'ok';
      gh.msg = '';
    } catch (e) {
      console.warn('GitHub-Sicherung', e);
      gh.state = 'error';
      gh.msg = e.message;
    } finally {
      gh.busy = false;
      renderSyncStatus();
      renderBanners();
      if (gh.again) { gh.again = false; scheduleSync(1500); }
    }
  }

  function scheduleSync(ms = 4000) {
    if (!ghOn()) return;
    clearTimeout(gh.timer);
    gh.timer = setTimeout(() => ghSync(false), ms);
  }

  function parseRepo(v) {
    const s = String(v || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
    return /^[\w.-]+\/[\w.-]+$/.test(s) ? s : null;
  }

  function syncLabel() {
    if (!ghOn()) return { cls: 'off', text: 'GitHub-Sicherung einrichten' };
    if (gh.state === 'busy') return { cls: 'busy', text: 'Wird gesichert …' };
    if (gh.state === 'error') return { cls: 'error', text: 'Sicherung fehlgeschlagen' };
    if (gh.cfg.lastOk) {
      const d = new Date(gh.cfg.lastOk);
      return { cls: 'ok', text: `Gesichert · ${dayDiff(d) === 0 ? timeStr(d) + ' Uhr' : dayLabel(d)}` };
    }
    return { cls: 'busy', text: 'Verbinde …' };
  }

  function renderSyncStatus() {
    const s = syncLabel();
    const el = $('#sync-status');
    if (el) {
      el.className = `sync-status ${s.cls}`;
      el.innerHTML = `<span class="sync-dot"></span><span>${esc(s.text)}</span>`;
      el.title = gh.state === 'error' ? gh.msg : 'Automatische Sicherung auf GitHub';
    }
    const st = $('#gh-state');
    if (st) st.innerHTML = ghStateHtml();
  }

  function ghStateHtml() {
    if (!ghOn()) return '<span class="status-pill">nicht eingerichtet</span>';
    if (gh.state === 'error') return `<span class="status-pill bad">Fehler</span> <span class="hint">${esc(gh.msg)}</span>`;
    if (gh.state === 'busy') return '<span class="status-pill">wird gesichert …</span>';
    return `<span class="status-pill ok">aktiv</span> <span class="hint">Letzte Sicherung: ${gh.cfg.lastOk ? esc(fmtStamp(gh.cfg.lastOk)) : '–'}</span>`;
  }

  const IMPORT_FIELDS = [
    { key: 'title', label: 'Titel / Betreff *', re: /^(betreff|subject|titel|title|aufgabe|task|name|erinnerung)$/i },
    { key: 'notes', label: 'Bemerkung / Notizen', re: /^(notizen|notes|beschreibung|description|body|bemerkung(en)?|text|inhalt|details)$/i },
    { key: 'remDate', label: 'Erinnerungsdatum', re: /(erinnerungsdatum|reminder ?date|erinnerung datum)/i },
    { key: 'remTime', label: 'Erinnerungszeit', re: /(erinnerungszeit|reminder ?time|erinnerung uhrzeit)/i },
    { key: 'dueDate', label: 'Fälligkeitsdatum', re: /(fällig|due ?date|^due$|fälligkeit|^datum$|^date$)/i },
    { key: 'doneDate', label: 'Erledigt am', re: /(erledigt am|date ?completed|completed ?date|abgeschlossen am)/i },
    { key: 'status', label: 'Status / Erledigt', re: /^(status|erledigt|completed|done|% erledigt|% complete)$/i },
    { key: 'priority', label: 'Priorität / Wichtig', re: /(priorität|priority|wichtig|importance)/i },
  ];

  function parseDateFlexible(s) {
    s = String(s || '').trim();
    if (!s) return null;
    let m, y, mo, d, h = null, mi = null;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{2}))?/))) {
      if (/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(s)) {
        const dt = new Date(s);
        if (!isNaN(dt)) return { y: dt.getFullYear(), mo: dt.getMonth() + 1, d: dt.getDate(), h: dt.getHours(), mi: dt.getMinutes() };
      }
      y = +m[1]; mo = +m[2]; d = +m[3];
      if (m[4] != null) { h = +m[4]; mi = +m[5]; }
    } else if ((m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})?(?:[,\s]+(\d{1,2})[:.](\d{2}))?/))) {
      d = +m[1]; mo = +m[2]; y = m[3] ? +m[3] : new Date().getFullYear();
      if (m[4] != null) { h = +m[4]; mi = +m[5]; }
    } else if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[,\s]+(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?)?/))) {
      const a = +m[1], b = +m[2];
      if (a > 12) { d = a; mo = b; } else { mo = a; d = b; } // Outlook (englisch): Monat/Tag/Jahr
      y = +m[3];
      if (m[4] != null) {
        h = +m[4]; mi = +m[5];
        if (m[6]) { const pm = /p/i.test(m[6]); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
      }
    } else return null;
    if (y < 100) y += 2000;
    if (y < 1971 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    if (h != null && (h > 23 || mi > 59)) { h = null; mi = null; }
    return { y, mo, d, h, mi };
  }

  function parseTimeFlexible(s) {
    const m = String(s || '').match(/(\d{1,2})[:.](\d{2})(?::\d{2})?\s*([AaPp][Mm])?/);
    if (!m) return null;
    let h = +m[1];
    const mi = +m[2];
    if (m[3]) { const pm = /p/i.test(m[3]); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
    if (h > 23 || mi > 59) return null;
    return { h, mi };
  }

  function candidateFromFields(f) {
    const title = String(f.title || '').replace(/\s+/g, ' ').trim();
    if (!title) return null;
    let remind = null;
    const rd = parseDateFlexible(f.remDate);
    if (rd) {
      const tm = parseTimeFlexible(f.remTime) || (rd.h != null ? { h: rd.h, mi: rd.mi } : defTime());
      remind = new Date(rd.y, rd.mo - 1, rd.d, tm.h, tm.mi);
    }
    if (!remind) {
      const dd = parseDateFlexible(f.dueDate);
      if (dd) {
        const tm = dd.h != null && (dd.h || dd.mi) ? { h: dd.h, mi: dd.mi } : defTime();
        remind = new Date(dd.y, dd.mo - 1, dd.d, tm.h, tm.mi);
      }
    }
    const dn = parseDateFlexible(f.doneDate);
    const done = /erledigt|abgeschlossen|completed|^done$|^100|^ja$|^yes$|^true$|^x$|^wahr$/i.test(String(f.status || '').trim()) || !!dn;
    const doneAt = done ? (dn ? new Date(dn.y, dn.mo - 1, dn.d, dn.h ?? 12, dn.mi ?? 0).toISOString() : nowIso()) : null;
    const noteText = String(f.notes || '').replace(/\r\n/g, '\n').trim();
    return {
      title,
      remindAt: remind && !isNaN(remind) ? remind.toISOString() : null,
      done,
      doneAt,
      important: /hoch|high|wichtig|important|^ja$|^yes$|^true$/i.test(String(f.priority || '').trim()),
      notes: noteText ? [{ text: noteText, at: nowIso() }] : [],
    };
  }

  function parseCSV(text) {
    const first = text.split(/\r?\n/, 1)[0];
    const cnt = (ch) => first.split(ch).length - 1;
    const delim = ['\t', ';', ','].reduce((a, b) => (cnt(b) > cnt(a) ? b : a));
    const rows = [];
    let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
        else f += c;
      } else if (c === '"' && f === '') q = true;
      else if (c === delim) { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(f); rows.push(row); row = []; f = '';
      } else f += c;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows.filter((r) => r.some((x) => x.trim() !== ''));
  }

  function autoMap(headers) {
    const used = new Set();
    const map = {};
    for (const fld of IMPORT_FIELDS) {
      let idx = -1;
      if (fld.key === 'status') idx = headers.findIndex((h, i) => !used.has(i) && /^status$/i.test(h.trim()));
      if (idx < 0) idx = headers.findIndex((h, i) => !used.has(i) && fld.re.test(h.trim()));
      map[fld.key] = idx;
      if (idx >= 0) used.add(idx);
    }
    if (map.title < 0) map.title = 0;
    return map;
  }

  function fromGraph(it) {
    if (!it || typeof it !== 'object' || !it.title) return null;
    const g = (dt) => {
      if (!dt || !dt.dateTime) return null;
      let s = String(dt.dateTime).replace(/(\.\d{3})\d+/, '$1');
      if (!/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(s) && (!dt.timeZone || /^(utc|gmt)$/i.test(dt.timeZone))) s += 'Z';
      const d = new Date(s);
      return isNaN(d) ? null : d;
    };
    let remind = it.isReminderOn !== false ? g(it.reminderDateTime) : null;
    if (!remind) {
      const due = g(it.dueDateTime);
      if (due) { const { h, mi } = defTime(); remind = new Date(due.getFullYear(), due.getMonth(), due.getDate(), h, mi); }
    }
    let body = it.body && it.body.content ? String(it.body.content) : '';
    if (it.body && /html/i.test(it.body.contentType || '')) {
      const tmp = document.createElement('div');
      tmp.innerHTML = body.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n');
      body = tmp.textContent || '';
    }
    body = body.replace(/\r\n/g, '\n').trim();
    const created = g({ dateTime: it.createdDateTime, timeZone: 'UTC' });
    const done = it.status === 'completed';
    const doneAt = done ? (g(it.completedDateTime) || new Date()) : null;
    return {
      title: String(it.title).trim(),
      remindAt: remind ? remind.toISOString() : null,
      done,
      doneAt: doneAt ? doneAt.toISOString() : null,
      important: it.importance === 'high',
      notes: body ? [{ text: body, at: (created || new Date()).toISOString() }] : [],
      createdAt: created ? created.toISOString() : undefined,
    };
  }

  function fromTextLine(line) {
    let s = line.replace(/^\s*(?:[-*•–○●☐☑✓✔]|\[[ xX]?\]|\d+[.)])\s+/, '').trim();
    if (!s) return null;
    const done = /^\s*(?:\[[xX]\]|☑|✓|✔)/.test(line);
    let remind = null;
    const dm = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2}(?!\d))?/);
    if (dm) {
      const p = parseDateFlexible(dm[0]);
      if (p) {
        const tm = s.match(/(\d{1,2}):(\d{2})(?:\s*Uhr)?/);
        const t = tm ? { h: +tm[1], mi: +tm[2] } : defTime();
        if (t.h <= 23 && t.mi <= 59) {
          remind = new Date(p.y, p.mo - 1, p.d, t.h, t.mi);
          s = s.replace(dm[0], ' ');
          if (tm) s = s.replace(tm[0], ' ');
        }
      }
    }
    s = s.replace(/\s{2,}/g, ' ').replace(/(?:\s+(?:am|um|bis|ab|-|–|,))+\s*$/i, '').replace(/[\s,;:–-]+$/, '').trim();
    return { title: s || line.trim(), remindAt: remind ? remind.toISOString() : null, done, doneAt: done ? nowIso() : null, important: false, notes: [] };
  }

  async function readFileText(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf);
    if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch (_) { return new TextDecoder('windows-1252').decode(buf); } // ältere Outlook-Exporte (ANSI)
  }

  function analyzeImport(text, fileName = '') {
    const s = ui.imp;
    s.error = '';
    const trimmed = String(text || '').replace(/^﻿/, '').trim();
    if (!trimmed) { s.error = 'Es wurde nichts eingefügt oder ausgewählt.'; return; }

    if (/^[[{]/.test(trimmed)) {
      let j;
      try { j = JSON.parse(trimmed); } catch (_) { s.error = 'Die JSON-Daten konnten nicht gelesen werden. Bitte die komplette Antwort kopieren.'; return; }
      if (j && j.app === 'erinnerungen' && Array.isArray(j.tasks)) {
        s.step = 'backup';
        s.backup = normalize(j);
        s.backupDate = j.exportedAt || j.meta?.lastBackup || null;
        return;
      }
      const items = Array.isArray(j) ? j : Array.isArray(j?.value) ? j.value : Array.isArray(j?.tasks) ? j.tasks : null;
      if (!items) { s.error = 'In den JSON-Daten wurden keine Aufgaben gefunden.'; return; }
      if (items.length && items.every((x) => x && x.displayName && !x.title)) {
        s.error = 'Das sind die To-Do-Listen, nicht die Aufgaben. Bitte im Graph Explorer zusätzlich die Aufgaben einer Liste abrufen (siehe Anleitung unten).';
        return;
      }
      s.kind = 'json';
      s.cands = items.map(fromGraph).filter(Boolean);
      s.more = !!j?.['@odata.nextLink'];
      s.step = 'preview';
      return;
    }

    const rows = parseCSV(trimmed);
    const looksCsv = /\.csv$/i.test(fileName) || (rows.length >= 2 && rows[0].length >= 2 &&
      rows.filter((r) => r.length === rows[0].length).length >= rows.length * 0.8 &&
      rows[0].some((h) => IMPORT_FIELDS.some((f) => f.re.test(h.trim()))));
    if (looksCsv && rows.length >= 2) {
      s.kind = 'csv';
      s.headers = rows[0].map((h) => h.trim());
      s.rows = rows.slice(1);
      s.mapping = autoMap(s.headers);
      buildCsvCands();
      s.step = 'preview';
      return;
    }

    s.kind = 'text';
    s.cands = trimmed.split(/\r?\n/).map(fromTextLine).filter(Boolean);
    s.step = 'preview';
  }

  function buildCsvCands() {
    const s = ui.imp;
    const get = (row, key) => (s.mapping[key] >= 0 ? row[s.mapping[key]] ?? '' : '');
    s.cands = s.rows.map((r) => {
      const f = {};
      IMPORT_FIELDS.forEach((x) => { f[x.key] = get(r, x.key); });
      return candidateFromFields(f);
    }).filter(Boolean);
  }

  const taskSig = (t) => `${t.title.trim().toLowerCase()}|${t.remindAt || ''}`;

  function commitImport() {
    const s = ui.imp;
    const existing = new Set(data.tasks.map(taskSig));
    let added = 0, skipped = 0;
    for (const c of s.cands) {
      if (!s.includeDone && c.done) continue;
      const t = normalizeTask({ ...c, id: uid(), createdAt: c.createdAt || nowIso(), updatedAt: nowIso() });
      if (existing.has(taskSig(t))) { skipped++; continue; }
      // Vergangene Erinnerungen nicht alle auf einmal aufpoppen lassen – sie stehen unter „Überfällig“.
      if (t.remindAt && Date.parse(t.remindAt) <= Date.now()) t.notifiedFor = t.remindAt;
      data.tasks.push(t);
      existing.add(taskSig(t));
      added++;
    }
    save();
    $('#dlg-import').close();
    render();
    toast(`${added} Erinnerung${added === 1 ? '' : 'en'} importiert${skipped ? ` · ${skipped} bereits vorhanden, übersprungen` : ''}`);
  }

  function restoreBackup(mode) {
    const incoming = ui.imp.backup;
    if (mode === 'replace') {
      if (!confirm(`Alle aktuellen Erinnerungen (${data.tasks.length}) werden durch die Sicherung (${incoming.tasks.length}) ersetzt. Fortfahren?`)) return;
      const keep = new Set(incoming.tasks.map((t) => t.id));
      const now = nowIso();
      data.tasks.forEach((t) => { if (!keep.has(t.id)) data.deleted[t.id] = now; });
      incoming.tasks.forEach((t) => { t.updatedAt = now; delete data.deleted[t.id]; });
      data.tasks = incoming.tasks;
      data.settings = { ...data.settings, ...incoming.settings };
    } else {
      for (const t of incoming.tasks) {
        const cur = findTask(t.id);
        if (!cur) data.tasks.push(t);
        else if (t.updatedAt > cur.updatedAt) Object.assign(cur, t);
      }
    }
    // Bereits vergangene Erinnerungen nicht erneut aufpoppen lassen
    data.tasks.forEach((t) => { if (t.remindAt && Date.parse(t.remindAt) <= Date.now()) t.notifiedFor = t.remindAt; });
    save();
    $('#dlg-import').close();
    closeDetail();
    render();
    toast(mode === 'replace' ? 'Sicherung wiederhergestellt' : 'Sicherung zusammengeführt');
  }

  function openImport() {
    ui.imp = { step: 1, includeDone: true, error: '' };
    renderImport();
    $('#dlg-import').showModal();
  }

  function renderImport() {
    const s = ui.imp;
    const body = $('#imp-body');
    const foot = $('#imp-foot');

    if (s.step === 1) {
      body.innerHTML = `
        <p class="hint">Möglich sind: CSV-Export aus Outlook (Ordner „Aufgaben“), JSON aus dem Microsoft Graph Explorer (To Do), eine Sicherungsdatei dieser App oder einfacher Text mit einer Erinnerung pro Zeile.</p>
        <label class="file-drop"><input type="file" id="imp-file" accept=".csv,.json,.txt,text/csv,application/json,text/plain">${ICON.upload}<span>Datei auswählen oder hierher ziehen</span></label>
        <div class="or">– oder Text bzw. JSON hier einfügen –</div>
        <textarea class="field" id="imp-text" placeholder="Angebot Müller nachfassen 24.11.2026 09:00&#10;Rechnung Firma X prüfen 25.11.2026&#10;Lieferschein ablegen"></textarea>
        ${s.error ? `<div class="error">${esc(s.error)}</div>` : ''}
        <details class="howto">
          <summary>Wie bekomme ich meine Erinnerungen aus Microsoft To Do heraus?</summary>
          <p><b>Weg 1 – klassisches Outlook (am einfachsten, falls vorhanden):</b> To-Do-Aufgaben erscheinen in Outlook im Bereich „Aufgaben“.</p>
          <ol>
            <li>Outlook öffnen → <i>Datei</i> → <i>Öffnen und Exportieren</i> → <i>Importieren/Exportieren</i>.</li>
            <li><i>In Datei exportieren</i> → <i>Kommagetrennte Werte (CSV)</i>.</li>
            <li>Den Ordner <i>Aufgaben</i> (bzw. die gewünschte To-Do-Liste) auswählen und speichern.</li>
            <li>Die CSV-Datei hier oben auswählen. Die Spalten werden automatisch erkannt.</li>
          </ol>
          <p><b>Weg 2 – Microsoft Graph Explorer (nur im Browser):</b></p>
          <ol>
            <li><code>developer.microsoft.com/graph/graph-explorer</code> öffnen und mit dem Firmenkonto anmelden.</li>
            <li>Abfrage <code>GET https://graph.microsoft.com/v1.0/me/todo/lists</code> ausführen und bei der gewünschten Liste die <code>id</code> kopieren.<br>(Fragt der Explorer nach der Berechtigung „Tasks.Read“, zustimmen. Blockiert die Firmen-IT das, bleibt Weg 1 oder 3.)</li>
            <li>Abfrage <code>GET https://graph.microsoft.com/v1.0/me/todo/lists/<i>ID</i>/tasks?$top=999</code> ausführen.</li>
            <li>Die komplette Antwort (Response preview) kopieren und hier einfügen. Für jede Liste wiederholen.</li>
          </ol>
          <p><b>Weg 3 – von Hand:</b> Erinnerungen als Text einfügen, eine pro Zeile. Datum (<code>24.11.2026</code>) und Uhrzeit (<code>09:00</code>) in der Zeile werden automatisch erkannt.</p>
        </details>`;
      foot.innerHTML = `<button class="btn" type="button" data-act="imp-cancel">Abbrechen</button><button class="btn primary" type="button" data-act="imp-next">Weiter</button>`;
      return;
    }

    if (s.step === 'backup') {
      body.innerHTML = `
        <p>Sicherungsdatei${s.backupDate ? ` vom <b>${esc(fmtStamp(s.backupDate))}</b>` : ''} mit <b>${s.backup.tasks.length}</b> Erinnerungen erkannt.</p>
        <p class="hint"><b>Zusammenführen</b> ergänzt fehlende Einträge und übernimmt neuere Stände – nichts geht verloren.<br><b>Alles ersetzen</b> stellt exakt den Stand der Sicherung wieder her (aktuelle Daten werden überschrieben).</p>`;
      foot.innerHTML = `<button class="btn" type="button" data-act="imp-back">Zurück</button><span class="grow"></span>
        <button class="btn danger" type="button" data-act="imp-replace">Alles ersetzen</button>
        <button class="btn primary" type="button" data-act="imp-merge">Zusammenführen</button>`;
      return;
    }

    // Vorschau
    const total = s.cands.length;
    const nDone = s.cands.filter((c) => c.done).length;
    const toImport = s.includeDone ? total : total - nDone;
    const mapping = s.kind === 'csv' ? `
      <p class="hint">Spalten wurden automatisch zugeordnet – bei Bedarf anpassen. Ohne Erinnerungsdatum wird das Fälligkeitsdatum mit der Standard-Uhrzeit (${esc(data.settings.defaultTime)} Uhr) verwendet.</p>
      <div class="map-grid">${IMPORT_FIELDS.map((f) => `<label>${esc(f.label)}<select data-map="${f.key}">
        <option value="-1">– nicht verwenden –</option>
        ${s.headers.map((h, i) => `<option value="${i}" ${s.mapping[f.key] === i ? 'selected' : ''}>${esc(h || `Spalte ${i + 1}`)}</option>`).join('')}
      </select></label>`).join('')}</div>` : '';
    const kindLabel = { csv: 'CSV-Datei', json: 'Microsoft-To-Do-Daten (Graph)', text: 'Text (eine Erinnerung pro Zeile)' }[s.kind];
    body.innerHTML = `
      <p>Erkannt: <b>${kindLabel}</b> – <b>${total}</b> Einträge (${total - nDone} offen, ${nDone} erledigt).</p>
      ${s.more ? '<p class="error">Achtung: Die Antwort enthält „@odata.nextLink“ – es gibt weitere Aufgaben. Im Graph Explorer zusätzlich die nextLink-Adresse abrufen und danach auch importieren.</p>' : ''}
      ${mapping}
      <label class="set-row"><input type="checkbox" id="imp-done" ${s.includeDone ? 'checked' : ''}> Bereits erledigte Einträge mit importieren (erscheinen unter „Erledigt“)</label>
      <table class="preview"><thead><tr><th>Titel</th><th>Erinnerung</th><th>Status</th><th>Bemerkung</th></tr></thead><tbody>
        ${s.cands.slice(0, 100).map((c) => `<tr><td>${c.important ? '★ ' : ''}${esc(c.title)}</td><td>${c.remindAt ? esc(fmtWhen(c.remindAt)) : '<span class="hint">–</span>'}</td><td>${c.done ? 'erledigt' : 'offen'}</td><td class="note">${esc(c.notes[0]?.text || '')}</td></tr>`).join('')}
      </tbody></table>
      ${total > 100 ? `<p class="hint">… und ${total - 100} weitere.</p>` : ''}
      ${!total ? '<p class="error">Keine Einträge mit Titel gefunden. Bitte die Spaltenzuordnung prüfen.</p>' : ''}
      <p class="hint">Bereits vorhandene Erinnerungen (gleicher Titel und Zeitpunkt) werden übersprungen. Vergangene Erinnerungen landen unter „Überfällig“, ohne einzeln aufzupoppen.</p>`;
    foot.innerHTML = `<button class="btn" type="button" data-act="imp-back">Zurück</button><span class="grow"></span>
      <button class="btn primary" type="button" data-act="imp-commit" ${toImport ? '' : 'disabled'}>${toImport} Erinnerung${toImport === 1 ? '' : 'en'} importieren</button>`;
  }

  /* =====================================================================
   * Einstellungen
   * ===================================================================== */
  function renderSettings() {
    const s = data.settings;
    let perm = '<span class="status-pill bad">nicht unterstützt</span>';
    if (!window.isSecureContext) perm = '<span class="status-pill bad">nur über https möglich</span>';
    else if ('Notification' in window) {
      perm = { granted: '<span class="status-pill ok">aktiv</span>', denied: '<span class="status-pill bad">blockiert</span>', default: '<span class="status-pill">noch nicht erlaubt</span>' }[Notification.permission];
    }
    const last = data.meta.lastBackup ? fmtStamp(data.meta.lastBackup) : 'noch nie';
    $('#settings-body').innerHTML = `
      <div class="set-section">
        <h3>Farbschema</h3>
        <div class="theme-grid">${THEMES.map((th) => `
          <button type="button" class="theme-opt${document.documentElement.dataset.theme === th.key ? ' on' : ''}" data-act="theme" data-theme-key="${th.key}">
            <span class="swatches">${th.sw.map((c) => `<i style="background:${c}"></i>`).join('')}</span>
            <span><b>${esc(th.name)}</b><br><small>${esc(th.desc)}</small></span>
          </button>`).join('')}
        </div>
      </div>
      <div class="set-section">
        <h3>Pop-ups &amp; Windows-Benachrichtigungen ${perm}</h3>
        <p class="hint">Erinnerungen poppen hier in der App als Fenster mit Ton auf. Dafür muss die Seite in einem Tab geöffnet bleiben (Tipp: Rechtsklick auf den Tab → „Anheften“). Sind Windows-Benachrichtigungen erlaubt, erscheint zusätzlich unten rechts ein Hinweis, auch wenn ein anderes Programm im Vordergrund ist. Verpasste Erinnerungen erscheinen beim nächsten Öffnen sofort.</p>
        <div class="set-row">
          ${'Notification' in window && Notification.permission === 'default' && window.isSecureContext ? '<button class="btn primary" type="button" data-act="perm">Benachrichtigungen erlauben</button>' : ''}
          <button class="btn" type="button" data-act="test-now">Test-Pop-up jetzt</button>
          <button class="btn" type="button" data-act="test-1min">Test-Erinnerung in 1 Minute</button>
        </div>
        <p class="hint"><b>Edge:</b> Einstellungen → „System und Leistung“ → bei „Schlafende Registerkarten“ diese Seite zu „Diese Websites niemals in den Ruhezustand versetzen“ hinzufügen.<br>
        <b>Chrome:</b> Einstellungen → „Leistung“ → „Arbeitsspeicher-Sparmodus“ → bei „Diese Websites immer aktiv lassen“ diese Seite hinzufügen.</p>
      </div>
      <div class="set-section">
        <h3>Erinnerungen</h3>
        <div class="set-row"><label for="s-deftime">Standard-Uhrzeit (z. B. für „Morgen“ oder Termine ohne Uhrzeit)</label>${timeInput('s-deftime', s.defaultTime, false)}</div>
        <div class="set-row"><label for="s-sound">Ton abspielen, wenn eine Erinnerung fällig wird</label><input type="checkbox" id="s-sound" ${s.sound ? 'checked' : ''}></div>
        <div class="set-row"><label for="s-summary">Tagesübersicht anzeigen (einmal am Tag, beim ersten Öffnen ab dieser Uhrzeit)</label><input type="checkbox" id="s-summary" ${s.summaryEnabled ? 'checked' : ''}>${timeInput('s-sumtime', s.summaryTime, false)}</div>
      </div>
      <div class="set-section">
        <h3>Automatische Sicherung auf GitHub</h3>
        <div class="set-row" id="gh-state">${ghStateHtml()}</div>
        <p class="hint">Nach jeder Änderung werden die Erinnerungen automatisch in ein <b>privates</b> GitHub-Repository gesichert, mit kompletter Versionsgeschichte. Wird der Browser zurückgesetzt, genügt es, hier dieselben Daten erneut einzutragen: Alles kommt zurück.</p>
        <div class="set-row"><label for="gh-repo">Repository (benutzer/name)</label><input class="field wide" id="gh-repo" placeholder="z. B. ii201/erinnerungen-daten" value="${esc(gh.cfg.repo)}" autocomplete="off" spellcheck="false"></div>
        <div class="set-row"><label for="gh-token">Zugangsschlüssel (Token)</label><input class="field wide" id="gh-token" type="password" placeholder="${gh.cfg.token ? 'gespeichert – nur zum Ändern neu eingeben' : 'github_pat_…'}" autocomplete="off" spellcheck="false"></div>
        <div class="set-row">
          <button class="btn primary" type="button" data-act="gh-connect">${ghOn() ? 'Speichern &amp; synchronisieren' : 'Verbinden'}</button>
          ${ghOn() ? '<button class="btn" type="button" data-act="gh-sync">Jetzt synchronisieren</button><button class="btn danger" type="button" data-act="gh-disconnect">Trennen</button>' : ''}
        </div>
        <details class="howto">
          <summary>So erstellst du den Zugangsschlüssel (einmalig, ca. 2 Minuten)</summary>
          <ol>
            <li>Auf <code>github.com</code> anmelden → oben rechts Profilbild → <i>Settings</i> → ganz unten <i>Developer settings</i>.</li>
            <li><i>Personal access tokens</i> → <i>Fine-grained tokens</i> → <i>Generate new token</i>.</li>
            <li>Name z. B. „Erinnerungen“, Ablaufdatum möglichst lang wählen.</li>
            <li><i>Repository access</i>: <b>Only select repositories</b> → das private Daten-Repository auswählen.</li>
            <li><i>Permissions</i> → <i>Repository permissions</i> → <b>Contents: Read and write</b>.</li>
            <li><i>Generate token</i> → Schlüssel kopieren und oben einfügen → <i>Verbinden</i>.</li>
          </ol>
          <p class="hint">Der Schlüssel wird nur in diesem Browser gespeichert und darf ausschließlich dieses eine Repository lesen und schreiben. Er ist nicht in Sicherungsdateien enthalten.</p>
        </details>
      </div>
      <div class="set-section">
        <h3>Sicherungsdatei &amp; Export</h3>
        <p class="hint">Zusätzlich oder alternativ: eine Datei herunterladen. Letzte Sicherungsdatei: <b>${esc(last)}</b>.</p>
        <div class="set-row">
          <button class="btn primary" type="button" data-act="backup">${ICON.download} Sicherung herunterladen</button>
          <button class="btn" type="button" data-act="import">${ICON.upload} Importieren / Wiederherstellen</button>
          <button class="btn" type="button" data-act="csv">Als Excel-Tabelle (CSV) exportieren</button>
        </div>
      </div>`;
  }

  /* =====================================================================
   * Hinzufügen-Leiste
   * ===================================================================== */
  function setAddDefaults() {
    const now = new Date();
    let day = null;
    if (ui.view === 'today' || ui.view === 'done') day = now;
    else if (ui.view === 'planned') day = addDays(now, 1);
    $('#add-date').value = day ? dateKey(day) : '';
    let t = defTime();
    if (day && dayDiff(day) === 0 && atTime(now, t.h, t.mi) <= now) {
      const nh = new Date(now.getTime() + 60 * 60000);
      t = { h: nh.getHours(), mi: 0 };
      if (nh.getDate() !== now.getDate()) t = { h: 23, mi: 59 };
    }
    setTimeSelect($('#add-time'), day ? `${pad(t.h)}:${pad(t.mi)}` : '');
  }

  $('#add-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const title = $('#add-title').value.trim();
    if (!title) { $('#add-title').focus(); return; }
    const when = combine($('#add-date').value, $('#add-time').value);
    const t = normalizeTask({ id: uid(), title, remindAt: when ? when.toISOString() : null });
    data.tasks.push(t);
    save();
    $('#add-title').value = '';
    if (ui.query) { ui.query = ''; $('#search').value = ''; }
    render();
    if (!isVisibleInView(t, ui.view)) {
      toast(`Hinzugefügt${t.remindAt ? ` für ${fmtWhen(t.remindAt)} Uhr` : ''} – zu finden unter „${VIEWS[bestViewFor(t)].title}“`);
    }
    $('#add-title').focus();
  });

  $('#add-date').addEventListener('change', () => {
    if ($('#add-date').value && !$('#add-time').value) setTimeSelect($('#add-time'), data.settings.defaultTime);
  });

  /* =====================================================================
   * Ereignisse
   * ===================================================================== */
  function animateList() {
    const l = $('#list');
    l.classList.remove('anim');
    void l.offsetWidth; // Animation neu starten
    l.classList.add('anim');
    clearTimeout(ui.animTimer);
    ui.animTimer = setTimeout(() => l.classList.remove('anim'), 600);
  }

  function switchView(v) {
    ui.view = v;
    ui.query = '';
    $('#search').value = '';
    render();
    animateList();
    setAddDefaults();
  }

  $('#nav').addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (b) switchView(b.dataset.view);
  });

  $('#stats').addEventListener('click', (e) => {
    const b = e.target.closest('[data-view-jump]');
    if (b) switchView(b.dataset.viewJump);
  });

  $('#search').addEventListener('input', (e) => {
    ui.query = e.target.value;
    render();
  });

  $('#list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    const row = e.target.closest('.task');
    if (!b || !row) return;
    const t = findTask(row.dataset.id);
    if (!t) return;
    if (b.dataset.act === 'toggle') {
      if (t.done || row.classList.contains('completing')) toggleDone(t);
      else { row.classList.add('completing'); setTimeout(() => toggleDone(t), 420); } // kurze Abhak-Animation
    } else if (b.dataset.act === 'star') toggleStar(t);
    else if (b.dataset.act === 'open') {
      if (ui.selectedId === t.id) closeDetail(); else openTask(t.id);
    }
  });

  // Globale Knöpfe (Banner, Sidebar, Einstellungen)
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    switch (b.dataset.act) {
      case 'perm': requestPermission(); break;
      case 'backup': exportBackup(); break;
      case 'backup-later': ui.backupBannerHidden = true; renderBanners(); break;
      case 'hide-notif': data.settings.hideNotifBanner = true; save({ noSync: true }); renderBanners(); break;
      case 'theme':
        data.settings.theme = b.dataset.themeKey;
        save({ noSync: true });
        applyTheme();
        if ($('#dlg-settings').open) renderSettings();
        break;
      case 'gh-sync': ghSync(true); break;
      case 'gh-connect': {
        const repo = parseRepo($('#gh-repo').value);
        const token = $('#gh-token').value.trim();
        if (!repo) { toast('Bitte das Repository im Format benutzer/name angeben.'); $('#gh-repo').focus(); break; }
        if (!token && !gh.cfg.token) { toast('Bitte den Zugangsschlüssel (Token) einfügen.'); $('#gh-token').focus(); break; }
        if (repo !== gh.cfg.repo) gh.cfg.lastOk = null;
        gh.cfg.repo = repo;
        if (token) gh.cfg.token = token;
        saveGh();
        gh.lastSig = null;
        renderSettings();
        ghSync(true).then(() => {
          if (gh.state === 'ok') toast('Verbunden – deine Erinnerungen werden ab jetzt automatisch auf GitHub gesichert.');
          if ($('#dlg-settings').open) renderSettings();
        });
        break;
      }
      case 'gh-disconnect':
        if (!confirm('GitHub-Sicherung trennen? Die Daten bleiben im Browser und auf GitHub erhalten, es wird nur nicht mehr synchronisiert.')) break;
        gh.cfg.token = '';
        gh.cfg.lastOk = null;
        gh.state = 'off';
        saveGh();
        renderSettings();
        renderSyncStatus();
        renderBanners();
        break;
      case 'csv': exportCSV(); break;
      case 'import': if ($('#dlg-settings').open) $('#dlg-settings').close(); openImport(); break;
      case 'settings': renderSettings(); $('#dlg-settings').showModal(); break;
      case 'settings-close': $('#dlg-settings').close(); break;
      case 'test-now': {
        const ok = notify('Test-Erinnerung', { body: 'Wenn du das siehst, funktionieren die Pop-ups. 👍', tag: 'test' });
        chime();
        Promise.resolve(ok).then((r) => { if (!r) toast('Keine Windows-Benachrichtigung möglich – bitte Berechtigung prüfen.'); });
        break;
      }
      case 'test-1min': {
        const t = normalizeTask({ id: uid(), title: 'Test-Erinnerung (kann gelöscht werden)', remindAt: new Date(Date.now() + 60000).toISOString() });
        data.tasks.push(t);
        save();
        render();
        toast('Test-Erinnerung angelegt – in einer Minute sollte sie aufpoppen. Gern solange einen anderen Tab öffnen.');
        $('#dlg-settings').close();
        break;
      }
      default: break;
    }
  });

  // Detailbereich
  const detail = $('#detail');
  detail.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const t = findTask(ui.selectedId);
    if (!t) return;
    switch (b.dataset.act) {
      case 'toggle': toggleDone(t); break;
      case 'star': toggleStar(t); break;
      case 'close': closeDetail(); break;
      case 'clear-remind': setReminder(t, null); render(); renderDetail(); break;
      case 'snooze': ui.snoozeOpen = false; ui.calOpen = false; snooze(t, b.dataset.key); break;
      case 'cal-toggle':
        ui.calOpen = !ui.calOpen;
        if (ui.calOpen) ui.calMonth = t.remindAt && Date.parse(t.remindAt) > Date.now() ? new Date(t.remindAt) : new Date();
        renderSnoozeMenu(t);
        break;
      case 'cal-prev':
      case 'cal-next':
        ui.calMonth = new Date(ui.calMonth.getFullYear(), ui.calMonth.getMonth() + (b.dataset.act === 'cal-next' ? 1 : -1), 1);
        renderSnoozeMenu(t);
        break;
      case 'cal-pick': {
        const when = combine(b.dataset.date, data.settings.defaultTime);
        if (!when) break;
        if (t.done) { t.done = false; t.doneAt = null; }
        setReminder(t, when);
        ui.snoozeOpen = false;
        ui.calOpen = false;
        removeAlert(t.id);
        render();
        renderDetail();
        toast(`Verschoben auf ${fmtWhen(t.remindAt)} Uhr`);
        break;
      }
      case 'snooze-toggle': {
        ui.snoozeOpen = !ui.snoozeOpen;
        const menu = detail.querySelector('.snooze-menu');
        if (menu) menu.hidden = !ui.snoozeOpen;
        b.classList.toggle('open', ui.snoozeOpen);
        b.setAttribute('aria-expanded', String(ui.snoozeOpen));
        break;
      }
      case 'note-add': { const v = $('#d-note').value; $('#d-note').value = ''; addNote(t, v); setTimeout(() => $('#d-note')?.focus(), 0); break; }
      case 'note-edit': ui.editingNoteId = b.closest('[data-note]').dataset.note; renderDetail(); break;
      case 'note-cancel': ui.editingNoteId = null; renderDetail(); break;
      case 'note-save': {
        const n = t.notes.find((x) => x.id === ui.editingNoteId);
        const val = $('#d-note-edit').value.trim();
        if (n) { if (val) n.text = val; else t.notes.splice(t.notes.indexOf(n), 1); touch(t); save(); }
        ui.editingNoteId = null;
        render();
        renderDetail();
        break;
      }
      case 'note-del': {
        const id = b.closest('[data-note]').dataset.note;
        const idx = t.notes.findIndex((x) => x.id === id);
        if (idx < 0) break;
        const [removed] = t.notes.splice(idx, 1);
        touch(t); save(); render(); renderDetail();
        toast('Bemerkung gelöscht', () => { t.notes.splice(idx, 0, removed); touch(t); save(); render(); renderDetail(); });
        break;
      }
      case 'delete': deleteTask(t); break;
      default: break;
    }
  });

  let listTimer = null;
  detail.addEventListener('input', (e) => {
    const t = findTask(ui.selectedId);
    if (!t) return;
    if (e.target.id === 'd-title') {
      t.title = e.target.value.replace(/\n/g, ' ');
      touch(t);
      saveSoon();
      clearTimeout(listTimer);
      listTimer = setTimeout(renderList, 300);
    }
  });
  detail.addEventListener('focusout', (e) => {
    if (e.target.id === 'd-title') {
      const t = findTask(ui.selectedId);
      if (t) { t.title = t.title.trim() || '(ohne Titel)'; e.target.value = t.title; save(); renderList(); }
    }
  });
  detail.addEventListener('change', (e) => {
    const t = findTask(ui.selectedId);
    if (!t) return;
    if (e.target.id === 'd-date' || e.target.id === 'd-time') {
      const dv = $('#d-date').value;
      let tv = $('#d-time').value;
      if (dv && !tv) { tv = data.settings.defaultTime; setTimeSelect($('#d-time'), tv); }
      setReminder(t, dv ? combine(dv, tv) : null);
      updateDetailStatus(t);
      render();
    }
  });
  detail.addEventListener('keydown', (e) => {
    if (e.target.id === 'd-title' && e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
    if (e.target.id === 'd-note' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const t = findTask(ui.selectedId);
      if (t) { const v = e.target.value; e.target.value = ''; addNote(t, v); setTimeout(() => $('#d-note')?.focus(), 0); }
    }
    if (e.target.id === 'd-note-edit' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      detail.querySelector('[data-act="note-save"]')?.click();
    }
  });

  // Pop-up-Dialog
  const dlgAlert = $('#dlg-alert');
  dlgAlert.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'alert-close') {
      ui.alertIds.slice().forEach((id) => closeSystemNotification(id));
      ui.alertIds = [];
      dlgAlert.close();
      renderHeader();
      return;
    }
    const item = b.closest('.alert-item');
    const t = item && findTask(item.dataset.id);
    if (!t) return;
    if (b.dataset.act === 'a-done') toggleDone(t);
    else if (b.dataset.act === 'a-snooze') snooze(t, b.dataset.key);
    else if (b.dataset.act === 'a-open') {
      removeAlert(t.id);
      if (dlgAlert.open && !ui.alertIds.length) dlgAlert.close();
      openTask(t.id, { focusNote: true });
    }
  });
  dlgAlert.addEventListener('close', () => { ui.alertIds = []; renderHeader(); });

  // Einstellungen
  $('#dlg-settings').addEventListener('change', (e) => {
    const s = data.settings;
    switch (e.target.id) {
      case 's-deftime': if (e.target.value) s.defaultTime = e.target.value; break;
      case 's-sound': s.sound = e.target.checked; if (s.sound) { unlockAudio(); setTimeout(chime, 50); } break;
      case 's-summary': s.summaryEnabled = e.target.checked; break;
      case 's-sumtime': if (e.target.value) { s.summaryTime = e.target.value; data.meta.lastSummaryDate = null; } break;
      default: return;
    }
    save();
    setAddDefaults();
  });

  // Import-Dialog
  const dlgImport = $('#dlg-import');
  dlgImport.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    switch (b.dataset.act) {
      case 'imp-cancel': dlgImport.close(); break;
      case 'imp-next': analyzeImport($('#imp-text').value); renderImport(); break;
      case 'imp-back': ui.imp = { step: 1, includeDone: ui.imp.includeDone, error: '' }; renderImport(); break;
      case 'imp-commit': commitImport(); break;
      case 'imp-merge': restoreBackup('merge'); break;
      case 'imp-replace': restoreBackup('replace'); break;
      default: break;
    }
  });
  dlgImport.addEventListener('change', async (e) => {
    if (e.target.id === 'imp-file' && e.target.files[0]) {
      const file = e.target.files[0];
      try { analyzeImport(await readFileText(file), file.name); }
      catch (err) { ui.imp.error = `Datei konnte nicht gelesen werden: ${err.message}`; }
      renderImport();
    } else if (e.target.id === 'imp-done') {
      ui.imp.includeDone = e.target.checked;
      renderImport();
    } else if (e.target.dataset.map) {
      ui.imp.mapping[e.target.dataset.map] = Number(e.target.value);
      buildCsvCands();
      renderImport();
    }
  });

  /* ---------- Uhrzeit-Kombifeld (Liste + freie Eingabe) ---------- */
  const timePop = $('#time-pop');
  const tp = { input: null, idx: -1, nav: false };
  const tpItems = () => [...timePop.querySelectorAll('button')];
  const tpOpen = () => { try { return timePop.matches(':popover-open'); } catch (_) { return !timePop.hidden; } };

  function tpHighlight(i, scroll) {
    const items = tpItems();
    if (!items.length) return;
    tp.idx = Math.max(0, Math.min(items.length - 1, i));
    items.forEach((b, k) => b.classList.toggle('active', k === tp.idx));
    if (scroll) {
      const el = items[tp.idx];
      timePop.scrollTop = el.offsetTop - timePop.clientHeight / 2 + el.offsetHeight / 2;
    }
  }

  function openTimePop(input) {
    tp.input = input;
    tp.nav = false;
    const cur = parseTimeInput(input.value) || '';
    const list = [...TIME_SLOTS];
    if (cur && !list.includes(cur)) { list.push(cur); list.sort(); }
    timePop.innerHTML = list.map((v) => `<button type="button" role="option" data-v="${v}" class="${v === cur ? 'on' : ''}">${v} Uhr</button>`).join('');
    const r = input.getBoundingClientRect();
    const h = Math.min(264, list.length * 34 + 10);
    const below = window.innerHeight - r.bottom > h + 8;
    timePop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 150))}px`;
    timePop.style.top = `${below ? r.bottom + 4 : Math.max(8, r.top - h - 4)}px`;
    timePop.style.minWidth = `${Math.max(r.width, 120)}px`;
    try { if (tpOpen()) timePop.hidePopover(); timePop.showPopover(); } catch (_) { timePop.hidden = false; }
    let idx = list.indexOf(cur);
    if (idx < 0) idx = list.indexOf(data.settings.defaultTime);
    tpHighlight(idx < 0 ? 0 : idx, true);
  }

  function closeTimePop() {
    try { if (tpOpen()) timePop.hidePopover(); } catch (_) { timePop.hidden = true; }
    tp.input = null;
  }

  function pickTime(v) {
    const inp = tp.input;
    if (!inp) return;
    inp.value = v;
    closeTimePop();
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  }

  timePop.addEventListener('mousedown', (e) => e.preventDefault()); // Fokus im Eingabefeld behalten
  timePop.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (b) pickTime(b.dataset.v);
  });

  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (!el.matches || !el.matches('.time-input')) return;
    el.dataset.prev = el.value;
    openTimePop(el);
    setTimeout(() => { try { el.select(); } catch (_) { /* egal */ } }, 0); // Eintippen ersetzt den alten Wert
  });
  document.addEventListener('click', (e) => {
    if (e.target.matches && e.target.matches('.time-input') && tp.input !== e.target) openTimePop(e.target);
  });
  document.addEventListener('focusout', (e) => {
    if (e.target === tp.input) closeTimePop();
  });
  document.addEventListener('input', (e) => {
    if (e.target !== tp.input) return;
    tp.nav = false;
    const v = parseTimeInput(e.target.value);
    const i = v ? tpItems().findIndex((b) => b.dataset.v >= v) : -1;
    if (i >= 0) tpHighlight(i, true);
  });
  document.addEventListener('keydown', (e) => {
    const el = e.target;
    if (!el.matches || !el.matches('.time-input')) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!tpOpen()) openTimePop(el);
      tp.nav = true;
      tpHighlight(tp.idx + (e.key === 'ArrowDown' ? 1 : -1), true);
    } else if (e.key === 'Enter') {
      e.preventDefault(); // im Eingabeformular nicht abschicken
      if (tp.nav && tpItems()[tp.idx]) { pickTime(tpItems()[tp.idx].dataset.v); return; }
      closeTimePop();
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (e.key === 'Escape' && tpOpen()) {
      e.preventDefault();
      e.stopPropagation();
      closeTimePop();
    } else if (e.key === 'Tab') closeTimePop();
  }, true);

  // Jede Änderung eines Uhrzeit-Feldes zuerst prüfen und vereinheitlichen (vor allen anderen Listenern)
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!el.matches || !el.matches('.time-input')) return;
    const v = parseTimeInput(el.value);
    if (v === null || (v === '' && !el.dataset.allowEmpty)) {
      el.value = el.dataset.prev || '';
      e.stopImmediatePropagation();
      toast('Uhrzeit nicht erkannt – z. B. 9, 930, 9:15 oder 14.45 eingeben.');
      return;
    }
    el.value = v;
    if (v === (el.dataset.prev || '')) { e.stopImmediatePropagation(); return; }
    el.dataset.prev = v;
  }, true);

  // Tastatur
  document.addEventListener('keydown', (e) => {
    const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
    if (e.key === '/' && !inField && !document.querySelector('dialog[open]')) { e.preventDefault(); $('#search').focus(); }
    else if (e.key === 'n' && !inField && !e.ctrlKey && !e.metaKey && !document.querySelector('dialog[open]')) { e.preventDefault(); $('#add-title').focus(); }
    else if (e.key === 'Escape' && !document.querySelector('dialog[open]')) {
      if (document.activeElement === $('#search') && ui.query) { ui.query = ''; $('#search').value = ''; render(); }
      else if (ui.selectedId) closeDetail();
    }
  });

  // Andere Tabs mit derselben App synchron halten
  window.addEventListener('storage', (e) => {
    if (e.key !== STORE_KEY) return;
    data = load();
    applyTheme();
    render();
    if (ui.selectedId && !ui.editingNoteId && !detail.contains(document.activeElement)) renderDetail();
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) tick(true);
    else if (gh.timer) { clearTimeout(gh.timer); ghSync(false); } // beim Wegklicken ausstehende Änderungen sofort sichern
  });
  window.addEventListener('focus', () => tick(true));

  /* =====================================================================
   * Start
   * ===================================================================== */
  function handleHash() {
    const h = location.hash.slice(1);
    if (!h) return;
    const p = new URLSearchParams(h);
    history.replaceState(null, '', location.pathname + location.search);
    const id = p.get('task');
    if (id) handleNotifAction(p.get('action') || 'open', id);
  }

  renderFoot();
  render();
  setAddDefaults();
  renderSyncStatus();
  if (PREVIEW) return; // Vergleichsansicht: keine Pop-ups, keine Synchronisation

  try { navigator.storage?.persist?.(); } catch (_) { /* optional */ }
  handleHash();
  tick(true);
  setInterval(tick, 15000);
  ghSync(true); // beim Start Stand von GitHub holen und zusammenführen
  setInterval(() => ghSync(true), 10 * 60000);
})();
