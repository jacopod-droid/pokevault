/* PokéVault TCG – estensione: carte giapponesi, set personalizzati, caricamento carte robusto.
   Da includere in index.html con:  <script src="pokevault-extra.js"></script>  (subito prima di </body>) */
(() => {
  'use strict';
  const TCGDEX = 'https://api.tcgdex.net/v2';
  const CUSTOM_KEY = 'pokevault_custom_sets_v1';
  const $ = id => document.getElementById(id);
  const esc = s => escapeHTML(s);
  let region = 'west', jpSets = [], customSets = [], searchResults = [];

  // ---------- Utilità ----------
  const ph = (t = '?') => 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 350"><rect width="250" height="350" rx="14" fill="#94a3b8"/><rect x="12" y="12" width="226" height="326" rx="8" fill="#cbd5e1"/><text x="125" y="195" font-size="64" text-anchor="middle" fill="#64748b">${t}</text></svg>`);
  const imgs = base => base ? { small: base + '/low.webp', large: base + '/high.webp' } : { small: ph(), large: ph() };
  // Foto di riserva se un'immagine non si carica
  document.addEventListener('error', e => {
    const i = e.target;
    if (i && i.tagName === 'IMG' && !i.hasAttribute('onerror') && !i.dataset.fb) { i.dataset.fb = 1; i.src = ph(); }
  }, true);

  const idb = () => new Promise((res, rej) => { const r = indexedDB.open('pokevault_cache', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  async function kvGet(k) { try { const db = await idb(); return await new Promise(res => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(); }); } catch { return; } }
  async function kvSet(k, v) { try { const db = await idb(); await new Promise(res => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = res; }); } catch {} }
  async function kvDel(k) { try { const db = await idb(); await new Promise(res => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').delete(k); t.oncomplete = res; t.onerror = res; }); } catch {} }

  async function getJson(url, tries = 3) {
    let err;
    for (let i = 0; i < tries; i++) {
      const c = new AbortController(), t = setTimeout(() => c.abort(), 25000);
      try { const r = await fetch(url, { signal: c.signal }); clearTimeout(t); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
      catch (e) { clearTimeout(t); err = e; await new Promise(r => setTimeout(r, 800 * (i + 1))); }
    }
    throw err;
  }
  const num = c => parseInt(String(c.number).replace(/\D/g, ''), 10) || 9999;
  const sortCards = a => a.sort((x, y) => num(x) - num(y) || String(x.number).localeCompare(String(y.number)));

  // ---------- Carte dei set (occidentali + giapponesi) ----------
  async function westCards(id) {
    const key = 'w:' + id, c = await kvGet(key);
    if (c && c.length && !isStale(key, c.length)) return c;
    let cards = [];
    try { // paginazione: i set con più di 250 carte erano troncati
      for (let p = 1; p <= 6; p++) {
        const j = await getJson(`${API_BASE}/cards?q=set.id:${id}&orderBy=number&pageSize=250&page=${p}&select=id,name,number,rarity,artist,images,set`);
        cards = cards.concat(j.data || []);
        if (!(j.data || []).length || cards.length >= (j.totalCount || 0)) break;
      }
    } catch (e) { console.warn(e); }
    if (!cards.length) { // riserva: TCGdex (inglese)
      try { const j = await getJson(`${TCGDEX}/en/sets/${id}`, 2); cards = (j.cards || []).map(c => ({ id: id + '-' + c.localId, name: c.name, number: c.localId, rarity: '', images: imgs(c.image) })); } catch {}
    }
    if (!cards.length) { if (c && c.length) return c; throw new Error('vuoto'); }
    cards = sortCards(cards); kvSet(key, cards); stamp(key); return cards;
  }
  async function jpCards(setId) {
    const c = await kvGet(setId);
    if (c && c.length && !isStale(setId, c.length)) return c;
    const j = await getJson(`${TCGDEX}/ja/sets/${encodeURIComponent(setId.slice(3))}`);
    const cards = sortCards((j.cards || []).map(c => ({ id: 'jp:' + c.id, name: c.name || ('#' + c.localId), number: c.localId, rarity: '', images: imgs(c.image) })));
    if (!cards.length) { if (c && c.length) return c; throw new Error('vuoto'); }
    kvSet(setId, cards); stamp(setId); return cards;
  }
  loadCardsForSet = async function (setId) {
    const loader = $('setCardsLoader');
    $('setCardsGrid').innerHTML = ''; loader.classList.remove('hidden'); currentSetCards = [];
    try { currentSetCards = setId.startsWith('jp:') ? await jpCards(setId) : await westCards(setId); }
    catch (e) { showToast('Carte non disponibili ora: premi «↻ Ricarica».', 'error'); }
    finally { loader.classList.add('hidden'); }
  };
  window.pvReload = async () => {
    if (!currentSet || currentSet.custom) return;
    await kvDel(currentSet.id.startsWith('jp:') ? currentSet.id : 'w:' + currentSet.id);
    await loadCardsForSet(currentSet.id); updateSetDetailHeaderStats(); renderSetCardsGrid();
  };

  // ---------- Set giapponesi ----------
  const SPECIAL = /promo|deck|starter|box|collection|campaign|gift|special|classic|\bvs\b|pack|half|premium|prerelease|scenario|movie|theme|kit|master|trainer|concept/i;
  const isSpecial = s => SPECIAL.test(s.name || '') || /promo|(^|[-_])p$/i.test(s.id) || (s.total && s.total < 35);
  const ico = u => u ? u + '.png' : '';
  function registerSeries() {
    const bases = [...new Set(jpSets.map(s => s.base))];
    bases.forEach(b => ['Set principali', 'Set speciali'].forEach(k => {
      const key = `🇯🇵 ${b} · ${k}`;
      if (!SERIES_ORDER.includes(key)) SERIES_ORDER.push(key);
      SERIES_LABELS[key] = key;
    }));
  }
  async function loadJp() {
    if (jpSets.length) return;
    const cached = await kvGet('jp_sets');
    if (cached && cached.d && cached.d.length && Date.now() - cached.t < 6048e5) { jpSets = cached.d; return registerSeries(); }
    const list = await getJson(`${TCGDEX}/ja/series`);
    const res = await Promise.all(list.map(async (s, i) => {
      try {
        const d = await getJson(`${TCGDEX}/ja/series/${s.id}`, 2); let date = '';
        try { if (d.firstSet && d.firstSet.id) date = (await getJson(`${TCGDEX}/ja/sets/${d.firstSet.id}`, 1)).releaseDate || ''; } catch {}
        return { i, name: d.name || s.name || s.id, date, sets: d.sets || [] };
      } catch { return null; }
    }));
    const out = [];
    res.filter(Boolean).sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.i - b.i).forEach(s => {
      s.sets.forEach(x => {
        const total = (x.cardCount && (x.cardCount.total || x.cardCount.official)) || 0;
        const set = { id: 'jp:' + x.id, name: x.name, base: s.name, total, printedTotal: (x.cardCount && x.cardCount.official) || total, releaseDate: '', images: { symbol: ico(x.symbol || x.logo), logo: ico(x.logo) } };
        set.series = `🇯🇵 ${s.name} · ${isSpecial(set) ? 'Set speciali' : 'Set principali'}`;
        out.push(set);
      });
    });
    if (!out.length) throw new Error('nessun set');
    jpSets = out; kvSet('jp_sets', { t: Date.now(), d: out }); registerSeries();
  }

  const _render = renderSeriesDirectory;
  renderSeriesDirectory = function () {
    const saved = allSets; allSets = region === 'jp' ? jpSets : saved;
    try { _render(); } finally { allSets = saved; }
  };
  const _open = openSetDetail;
  openSetDetail = function (id) {
    $('regionBar').classList.add('hidden');
    $('customToolbar').classList.toggle('hidden', !id.startsWith('custom:'));
    if (id.startsWith('custom:')) return openCustom(id);
    const saved = allSets; allSets = saved.concat(jpSets);
    const p = _open(id); allSets = saved; return p;
  };
  const _close = closeSetDetail;
  closeSetDetail = function () {
    const was = currentSet && currentSet.custom;
    _close(); $('regionBar').classList.remove('hidden'); $('customToolbar').classList.add('hidden');
    if (was) { $('setsDirectoryView').classList.add('hidden'); $('customSetsView').classList.remove('hidden'); renderCustom(); }
  };

  // ---------- Barra sezioni ----------
  const ON = 'bg-pokeBlue text-white shadow-sm', OFF = 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700';
  function paintBar() { document.querySelectorAll('#regionBar button').forEach(b => b.className = 'flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition ' + (b.dataset.r === region ? ON : OFF)); }
  window.pvRegion = async r => {
    region = r; paintBar();
    if (currentSet) { currentSet = null; currentSetCards = []; $('setDetailView').classList.add('hidden'); $('customToolbar').classList.add('hidden'); }
    $('customSetsView').classList.toggle('hidden', r !== 'custom');
    $('setsDirectoryView').classList.toggle('hidden', r === 'custom');
    if (r === 'custom') return renderCustom();
    if (r === 'jp' && !jpSets.length) {
      $('setsLoader').classList.remove('hidden');
      try { await loadJp(); } catch (e) { showToast('Impossibile caricare i set giapponesi (TCGdex). Riprova.', 'error'); }
      finally { $('setsLoader').classList.add('hidden'); }
    }
    renderSeriesDirectory();
  };

  // ---------- Set personalizzati ----------
  const saveCustom = () => { try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(customSets)); } catch { showToast('Errore salvataggio set personalizzati.', 'error'); } };
  const toCard = c => ({ id: c.id, name: c.name, number: c.number || '—', rarity: c.rarity || '', images: { small: c.image || ph(), large: c.image || ph() } });
  const getCS = () => currentSet && customSets.find(c => c.id === currentSet.id);
  const inp = 'px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-pokeBlue';

  function renderCustom() {
    const tile = cs => {
      const t = cs.cards.length, n = cs.cards.filter(c => ownedCardsMap[c.id]).length, p = t ? Math.round(n / t * 100) : 0;
      const th = cs.cards.slice(0, 3).map(c => `<img src="${esc(c.image || ph())}" loading="lazy" alt="" class="w-1/3 aspect-[2.5/3.5] object-contain rounded">`).join('');
      return `<button onclick="openSetDetail('${cs.id}')" class="text-left bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 hover:border-pokeBlue hover:shadow-md transition space-y-3">
        <div class="flex gap-1.5 min-h-[60px] bg-slate-100 dark:bg-slate-800 rounded-xl p-1.5">${th || '<span class="m-auto text-xs text-slate-400">Set vuoto</span>'}</div>
        <div><h4 class="text-sm font-extrabold text-slate-900 dark:text-white truncate">${esc(cs.name)}</h4><p class="text-[11px] text-slate-500 dark:text-slate-400 truncate">${esc(cs.description || '')}</p></div>
        <div class="space-y-1"><div class="flex justify-between text-[11px] font-bold"><span class="text-emerald-600 dark:text-emerald-400">${n} / ${t}</span><span class="text-slate-500">${p}%</span></div>
        <div class="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden"><div class="h-full bg-emerald-500 rounded-full" style="width:${p}%"></div></div></div></button>`;
    };
    $('customSetsView').innerHTML = `
      <div class="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm space-y-3">
        <div><h2 class="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white">Set Personalizzati</h2>
        <p class="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">Crea i tuoi set (es. «Pikachu da collezione», «Carte Art Rare») e aggiungi carte occidentali, giapponesi o manuali.</p></div>
        <form onsubmit="pvCreateSet(event)" class="flex flex-col sm:flex-row gap-2">
          <input id="csName" required maxlength="60" placeholder="Nome del set" class="${inp} sm:w-64">
          <input id="csDesc" maxlength="120" placeholder="Descrizione (opzionale)" class="${inp} flex-1">
          <button class="px-4 py-2 rounded-xl text-sm font-bold bg-pokeRed hover:bg-red-600 text-white shadow-md transition">+ Crea set</button>
        </form>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">${customSets.map(tile).join('') || '<p class="col-span-full text-center text-sm text-slate-500 dark:text-slate-400 py-10">Nessun set personalizzato: creane uno qui sopra.</p>'}</div>`;
  }
  window.pvCreateSet = e => {
    e.preventDefault();
    const name = $('csName').value.trim(); if (!name) return;
    customSets.push({ id: 'custom:' + Date.now().toString(36), name, description: $('csDesc').value.trim(), createdAt: Date.now(), cards: [] });
    saveCustom(); renderCustom(); showToast(`Set «${name}» creato!`, 'success');
  };
  function openCustom(id) {
    const cs = customSets.find(c => c.id === id); if (!cs) return;
    currentSet = { id: cs.id, name: cs.name, series: 'Set Personalizzati', total: cs.cards.length, printedTotal: cs.cards.length, releaseDate: '', images: { symbol: ph('🧩') }, custom: true };
    setDetailFilter = 'all'; $('setCardSearchInput').value = '';
    $('setsDirectoryView').classList.add('hidden'); $('customSetsView').classList.add('hidden'); $('setDetailView').classList.remove('hidden');
    $('detailSetSymbol').src = ph('🧩'); $('detailSetSeries').textContent = 'Set Personalizzato';
    $('detailSetName').textContent = cs.name; $('detailSetMeta').textContent = `${cs.description ? cs.description + ' • ' : ''}${cs.cards.length} carte`;
    currentSetCards = cs.cards.map(toCard);
    updateSetDetailFilterButtons(); updateSetDetailHeaderStats(); renderSetCardsGrid(); window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  const _grid = renderSetCardsGrid;
  renderSetCardsGrid = function () {
    _grid();
    if (!currentSet || !currentSet.custom) return;
    $('setCardsGrid').querySelectorAll(':scope > div').forEach(w => {
      const b = w.querySelector('button[onclick^="quickToggleCardFlag"]'); if (!b) return;
      const m = b.getAttribute('onclick').match(/'([^']+)'/); if (!m) return;
      const x = document.createElement('button');
      x.textContent = '✕'; x.title = 'Rimuovi dal set'; x.className = 'absolute top-3 left-3 z-20 w-7 h-7 rounded-full bg-red-600 text-white text-xs font-bold shadow-md';
      x.onclick = ev => { ev.stopPropagation(); removeCard(m[1]); }; w.appendChild(x);
    });
  };
  function refreshCustom() {
    const cs = getCS(); if (!cs) return;
    currentSetCards = cs.cards.map(toCard);
    $('detailSetMeta').textContent = `${cs.description ? cs.description + ' • ' : ''}${cs.cards.length} carte`;
    updateSetDetailHeaderStats(); renderSetCardsGrid();
  }
  function addCard(c) {
    const cs = getCS(); if (!cs) return;
    if (c.src && cs.cards.some(x => x.src === c.src)) return showToast('Carta già presente nel set.', 'info');
    cs.cards.push({ id: cs.id + '#' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), src: c.src || '', name: c.name, number: c.number, image: c.image, rarity: c.rarity || '' });
    saveCustom(); refreshCustom(); showToast(`«${c.name}» aggiunta al set!`, 'success');
  }
  function removeCard(cid) {
    const cs = getCS(); if (!cs || !confirm('Rimuovere questa carta dal set?')) return;
    cs.cards = cs.cards.filter(c => c.id !== cid); delete ownedCardsMap[cid];
    saveCustom(); saveCollectionToStorage(); refreshCustom();
  }
  window.pvDeleteSet = () => {
    const cs = getCS(); if (!cs || !confirm(`Eliminare il set «${cs.name}» e le sue carte flaggate?`)) return;
    cs.cards.forEach(c => delete ownedCardsMap[c.id]);
    customSets = customSets.filter(c => c.id !== cs.id); saveCustom(); saveCollectionToStorage(); closeSetDetail();
  };

  // ---------- Ricerca / aggiunta carte ----------
  window.pvOpenAdd = () => { $('csAddModal').classList.remove('hidden'); $('csAddModal').classList.add('flex'); $('csQuery').focus(); };
  window.pvCloseAdd = () => { $('csAddModal').classList.add('hidden'); $('csAddModal').classList.remove('flex'); };
  window.pvSearch = async e => {
    e.preventDefault();
    const q = $('csQuery').value.trim(), box = $('csResults'); if (!q) return;
    box.innerHTML = '<p class="col-span-full text-center text-sm text-slate-500 py-6">Ricerca in corso…</p>';
    try {
      if ($('csSource').value === 'jp') {
        const j = await getJson(`${TCGDEX}/ja/cards?name=${encodeURIComponent(q)}`, 2);
        searchResults = (Array.isArray(j) ? j : []).slice(0, 48).map(c => { const im = imgs(c.image); return { src: 'jp:' + c.id, name: c.name, number: c.localId, set: '🇯🇵 ' + c.id.split('-')[0], thumb: im.small, image: im.large }; });
      } else {
        const j = await getJson(`${API_BASE}/cards?q=${encodeURIComponent(`name:"${q}*"`)}&pageSize=48&orderBy=-set.releaseDate&select=id,name,number,rarity,images,set`, 2);
        searchResults = (j.data || []).map(c => ({ src: c.id, name: c.name, number: c.number, rarity: c.rarity, set: c.set ? c.set.name : '', thumb: c.images.small, image: c.images.large || c.images.small }));
      }
    } catch { searchResults = []; showToast('Ricerca non riuscita, riprova.', 'error'); }
    box.innerHTML = searchResults.length ? searchResults.map((r, i) => `<button type="button" onclick="pvPick(${i})" class="text-left bg-slate-50 dark:bg-slate-800 rounded-xl p-2 border border-slate-200 dark:border-slate-700 hover:border-pokeBlue transition">
      <img src="${esc(r.thumb)}" loading="lazy" alt="" class="w-full aspect-[2.5/3.5] object-contain rounded-lg"><p class="text-[11px] font-extrabold truncate mt-1 text-slate-900 dark:text-white">${esc(r.name)}</p><p class="text-[10px] text-slate-500 truncate">#${esc(r.number)} • ${esc(r.set)}</p></button>`).join('')
      : '<p class="col-span-full text-center text-sm text-slate-500 py-6">Nessun risultato.</p>';
  };
  window.pvPick = i => { const r = searchResults[i]; if (r) addCard(r); };
  window.pvManual = e => {
    e.preventDefault();
    addCard({ src: 'manual:' + Date.now(), name: $('cmName').value.trim(), number: $('cmNumber').value.trim(), image: $('cmImage').value.trim() || ph() });
    e.target.reset();
  };

  // ---------- Backup con set personalizzati ----------
  exportCollection = function () {
    try {
      const blob = new Blob([JSON.stringify({ version: 3, exportedAt: new Date().toISOString(), cards: ownedCardsMap, customSets, overrides: ov, manualSets: manual }, null, 2)], { type: 'application/json' });
      const u = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = u; a.download = `pokellector-backup-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(u);
      showToast('Backup JSON scaricato con successo!', 'success');
    } catch { showToast('Errore durante l\'esportazione JSON.', 'error'); }
  };
  const _imp = importCollection;
  importCollection = function (ev) {
    const f = ev.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try { const p = JSON.parse(r.result); if (p && Array.isArray(p.customSets)) { customSets = p.customSets; saveCustom(); } if (p && Array.isArray(p.manualSets)) { manual = p.manualSets; saveManual(); } if (p && p.overrides) { ov = Object.assign({ sets: {}, cards: {} }, p.overrides); saveOv(); } } catch {}
      _imp({ target: { files: [f], value: '' } }); ev.target.value = '';
    };
    r.readAsText(f);
  };

  // ---------- Modifica nomi e immagini (set e carte) ----------
  let ov = { sets: {}, cards: {} }, ed = null;
  const saveOv = () => kvSet('overrides', ov);
  function applySet(s) {
    if (s._on === undefined) { s._on = s.name; s._ol = s.images && s.images.symbol; }
    const o = ov.sets[s.id] || {};
    s.name = o.name || s._on; s.images = Object.assign({}, s.images, { symbol: o.logo || s._ol });
  }
  const applyAllSets = () => allSets.concat(jpSets).forEach(applySet);
  function applyCards(a) { a.forEach(c => { const o = ov.cards[c.id]; if (o) { if (o.name) c.name = o.name; if (o.image) c.images = { small: o.image, large: o.image }; } }); }
  const findCustomCard = id => { for (const cs of customSets) { const c = cs.cards.find(x => x.id === id); if (c) return { cs, c }; } return null; };

  const _r2 = renderSeriesDirectory;
  renderSeriesDirectory = function () { applyAllSets(); _r2(); };
  const _o2 = openSetDetail;
  openSetDetail = function (id) {
    applyAllSets();
    const r = _o2(id);
    if (id.startsWith('custom:')) { const cs = customSets.find(c => c.id === id); if (cs && cs.logo) { currentSet.images.symbol = cs.logo; $('detailSetSymbol').src = cs.logo; } }
    return r;
  };
  const _lc = loadCardsForSet;
  loadCardsForSet = async function (id) { await _lc(id); applyCards(currentSetCards); };

  const fileToData = (f, max) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => {
      const im = new Image();
      im.onload = () => {
        const k = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement('canvas');
        c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        res(f.type === 'image/png' ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', .82));
      };
      im.onerror = rej; im.src = r.result;
    };
    r.onerror = rej; r.readAsDataURL(f);
  });
  const setImg = v => { ed.image = v; $('edPrev').src = v || ph(); };
  async function takeFile(f) {
    if (!f.type.startsWith('image/')) return showToast('Il file non è un\'immagine.', 'error');
    try { setImg(await fileToData(f, ed.type === 'set' ? 240 : 500)); $('edUrl').value = ''; } catch { showToast('Immagine non leggibile.', 'error'); }
  }
  function closeEdit() { $('editModal').classList.add('hidden'); $('editModal').classList.remove('flex'); }
  window.pvEditClose = closeEdit;
  window.pvEdit = type => {
    let name, img, canReset = true;
    if (type === 'set') { if (!currentSet) return; name = currentSet.name; img = currentSet.images && currentSet.images.symbol; canReset = !currentSet.custom; }
    else { const c = currentModalCardObj; if (!c) return; name = c.name; img = c.images && (c.images.large || c.images.small); canReset = !findCustomCard(c.id); }
    ed = { type, image: img || '' };
    $('edTitle').textContent = type === 'set' ? 'Modifica set' : 'Modifica carta';
    $('edName').value = name; $('edUrl').value = /^https?:/.test(ed.image) ? ed.image : ''; $('edPrev').src = ed.image || ph();
    $('edReset').classList.toggle('hidden', !canReset);
    $('editModal').classList.remove('hidden'); $('editModal').classList.add('flex'); $('edName').focus();
  };
  function afterCardEdit() {
    if (currentSet) { if (currentSet.custom) refreshCustom(); else { applyCards(currentSetCards); updateSetDetailHeaderStats(); renderSetCardsGrid(); } }
    if (!$('viewCollection').classList.contains('hidden')) renderOwnedCollection();
  }
  function syncSetHeader() {
    Object.values(ownedCardsMap).forEach(c => { if (c.setId === currentSet.id) c.setName = currentSet.name; });
    saveCollectionToStorage();
    $('detailSetName').textContent = currentSet.name; $('detailSetSymbol').src = (currentSet.images && currentSet.images.symbol) || ph();
  }
  window.pvEditSave = e => {
    e.preventDefault();
    const name = $('edName').value.trim(), img = ed.image; if (!name) return;
    if (ed.type === 'set') {
      const cs = currentSet.custom && getCS();
      if (cs) { cs.name = name; if (img) cs.logo = img; saveCustom(); currentSet.name = name; currentSet.images.symbol = img || ph('🧩'); }
      else { ov.sets[currentSet.id] = { name, logo: img }; saveOv(); applySet(currentSet); }
      syncSetHeader();
    } else {
      const c = currentModalCardObj, f = findCustomCard(c.id);
      if (f) { f.c.name = name; f.c.image = img; saveCustom(); } else { ov.cards[c.id] = { name, image: img }; saveOv(); }
      c.name = name; c.images = { small: img || ph(), large: img || ph() };
      if (ownedCardsMap[c.id]) { ownedCardsMap[c.id].name = name; ownedCardsMap[c.id].image = img; saveCollectionToStorage(); }
      $('modalCardTitle').textContent = name; $('modalCardImage').src = img || ph();
      afterCardEdit();
    }
    closeEdit(); showToast('Modifiche salvate!', 'success');
  };
  window.pvEditReset = async () => {
    if (ed.type === 'set') { delete ov.sets[currentSet.id]; saveOv(); applySet(currentSet); syncSetHeader(); }
    else {
      const id = currentModalCardObj.id; delete ov.cards[id]; saveOv();
      if (currentSet && !currentSet.custom) {
        await loadCardsForSet(currentSet.id);
        const o = currentSetCards.find(x => x.id === id);
        if (o) {
          currentModalCardObj = o; $('modalCardTitle').textContent = o.name; $('modalCardImage').src = o.images.large || o.images.small;
          if (ownedCardsMap[id]) { ownedCardsMap[id].name = o.name; ownedCardsMap[id].image = o.images.large || o.images.small; saveCollectionToStorage(); }
        }
        updateSetDetailHeaderStats(); renderSetCardsGrid();
      } else showToast('Apri il set di origine e ricarica per vedere l\'originale.', 'info');
    }
    closeEdit(); showToast('Ripristinato l\'originale.', 'info');
  };

  async function initEdit() {
    const m = document.createElement('div');
    m.id = 'editModal'; m.className = 'fixed inset-0 z-[60] hidden items-center justify-center bg-slate-950/75 backdrop-blur-sm p-4 overflow-y-auto';
    m.innerHTML = `<form onsubmit="pvEditSave(event)" class="bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden my-auto">
      <div class="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/60">
        <h2 id="edTitle" class="text-lg font-extrabold text-slate-900 dark:text-white">Modifica</h2>
        <button type="button" onclick="pvEditClose()" class="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-lg leading-none">✕</button></div>
      <div class="p-6 space-y-4">
        <div><label class="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1">Nome</label><input id="edName" required maxlength="80" class="${inp} w-full"></div>
        <div id="edDrop" class="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-2xl p-4 text-center cursor-pointer hover:border-pokeBlue transition">
          <img id="edPrev" alt="" class="mx-auto max-h-44 object-contain rounded-lg mb-2">
          <p class="text-xs font-semibold text-slate-600 dark:text-slate-300">Trascina qui un'immagine oppure clicca per sceglierla</p></div>
        <input type="file" id="edFile" accept="image/*" class="hidden">
        <input id="edUrl" placeholder="…oppure incolla l'URL di un'immagine" class="${inp} w-full">
      </div>
      <div class="px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-end gap-2">
        <button type="button" id="edReset" onclick="pvEditReset()" class="mr-auto px-3 py-2 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">↺ Originale</button>
        <button type="button" onclick="pvEditClose()" class="px-4 py-2 rounded-xl text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">Annulla</button>
        <button class="px-5 py-2 rounded-xl text-sm font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-md">Salva</button></div></form>`;
    document.body.appendChild(m);
    const dz = $('edDrop'), hi = ['border-pokeBlue', 'bg-blue-50', 'dark:bg-slate-800'];
    dz.onclick = () => $('edFile').click();
    ['dragenter', 'dragover'].forEach(t => dz.addEventListener(t, e => { e.preventDefault(); dz.classList.add(...hi); }));
    ['dragleave', 'drop'].forEach(t => dz.addEventListener(t, e => { e.preventDefault(); dz.classList.remove(...hi); }));
    dz.addEventListener('drop', e => {
      const f = e.dataTransfer.files[0]; if (f) return takeFile(f);
      const u = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || '').trim();
      if (/^https?:\/\//.test(u)) { $('edUrl').value = u; setImg(u); }
    });
    $('edFile').onchange = e => { if (e.target.files[0]) takeFile(e.target.files[0]); e.target.value = ''; };
    $('edUrl').oninput = e => { const u = e.target.value.trim(); if (/^https?:\/\//.test(u)) setImg(u); };
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeEdit(); });

    const bs = document.createElement('button');
    bs.className = 'px-3 py-1.5 rounded-xl text-xs font-bold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition';
    bs.textContent = '✏️ Modifica set'; bs.onclick = () => pvEdit('set'); $('setFilterAllBtn').parentElement.appendChild(bs);
    const bc = document.createElement('button');
    bc.className = 'px-2.5 py-1 rounded-lg text-xs font-bold bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-600 transition';
    bc.textContent = '✏️ Modifica'; bc.onclick = () => pvEdit('card'); $('modalCardTitle').parentElement.appendChild(bc);

    const saved = await kvGet('overrides');
    if (saved) { ov = Object.assign({ sets: {}, cards: {} }, saved); if (!currentSet && !$('viewSets').classList.contains('hidden')) renderSeriesDirectory(); }
  }

  // ---------- Quantità, prezzi, backup, statistiche, vista Pokémon, mancanti ----------
  let prices = {}, pkRes = [], snapT;
  const qtyOf = c => Math.max(1, +c.qty || 1);
  const eur = n => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n || 0);
  const isWest = id => !/^(jp:|man:|manual-|custom|imp-|legacy-)/.test(id) && !id.includes('#');
  const csvCell = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const download = (name, text, type) => { const u = URL.createObjectURL(new Blob(['\ufeff' + text], { type })), a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 1000); };
  const lbl = 'block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1';

  // --- Quantità / duplicati ---
  const _ocd = openCardDetailModal;
  openCardDetailModal = function (id) { _ocd(id); const o = ownedCardsMap[id]; $('pvQty').value = o ? qtyOf(o) : 1; mktBox(); };
  const _scd = saveCardDetail;
  saveCardDetail = function (e) {
    const c = currentModalCardObj, q = Math.max(1, parseInt($('pvQty').value, 10) || 1);
    _scd(e);
    if (c && ownedCardsMap[c.id]) { ownedCardsMap[c.id].qty = q; saveCollectionToStorage(); }
    if (currentSet) { updateSetDetailHeaderStats(); renderSetCardsGrid(); }
    if (region === 'pokemon') renderPokemon();
    if (!$('viewCollection').classList.contains('hidden')) renderOwnedCollection();
  };
  const _g3 = renderSetCardsGrid;
  renderSetCardsGrid = function () {
    _g3();
    $('setCardsGrid').querySelectorAll(':scope > div').forEach(w => {
      const b = w.querySelector('button[onclick^="quickToggleCardFlag"]'), m = b && b.getAttribute('onclick').match(/'([^']+)'/), o = m && ownedCardsMap[m[1]];
      if (o && qtyOf(o) > 1) { const s = document.createElement('span'); s.textContent = '×' + qtyOf(o); s.className = 'absolute bottom-14 left-3 z-20 px-1.5 py-0.5 rounded-md bg-pokeYellow text-slate-900 text-[11px] font-extrabold shadow'; w.appendChild(s); }
    });
  };

  // --- Prezzi di mercato (Cardmarket via pokemontcg.io; link Cardmarket + Cardtrader) ---
  const cmLink = c => (prices[c.id] && prices[c.id].url) || `https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=${encodeURIComponent(c.name + ' ' + c.number)}`;
  const ctLink = c => `https://www.cardtrader.com/en/search?query=${encodeURIComponent(c.name + ' ' + c.number)}`;
  function mktBox() {
    const c = currentModalCardObj, el = $('pvMkt'); if (!c || !el) return;
    const p = prices[c.id], a = 'target="_blank" rel="noopener" class="text-pokeBlue hover:underline"';
    el.innerHTML = `<div class="flex items-center justify-between gap-2"><span class="text-xs font-extrabold uppercase tracking-wider text-slate-600 dark:text-slate-300">Prezzi di mercato</span><button type="button" onclick="pvLoadPrice()" class="text-[11px] font-bold text-pokeBlue hover:underline">${p ? '↻ Aggiorna' : 'Carica prezzo'}</button></div>
      ${p ? `<p class="text-xs text-slate-600 dark:text-slate-300 mt-1">Cardmarket: tendenza <b>${eur(p.trend)}</b> • medio <b>${eur(p.avg)}</b> • da <b>${eur(p.low)}</b> <button type="button" onclick="pvApplyPrice()" class="ml-1 underline font-bold">usa come prezzo</button></p>` : '<p class="text-[11px] text-slate-400 mt-1">Prezzo non caricato (disponibile per le carte occidentali del catalogo).</p>'}
      <div class="flex gap-4 mt-1.5 text-[11px] font-bold"><a href="${esc(cmLink(c))}" ${a}>Cardmarket ↗</a><a href="${esc(ctLink(c))}" ${a}>Cardtrader ↗</a></div>`;
  }
  async function fetchPrices(ids) {
    for (let i = 0; i < ids.length; i += 25) {
      const q = ids.slice(i, i + 25).map(x => 'id:' + x).join(' OR ');
      const j = await getJson(`${API_BASE}/cards?q=${encodeURIComponent(q)}&pageSize=25&select=id,cardmarket`, 2);
      (j.data || []).forEach(c => { const m = c.cardmarket; if (m && m.prices) prices[c.id] = { trend: m.prices.trendPrice, avg: m.prices.averageSellPrice, low: m.prices.lowPrice, url: m.url, t: Date.now() }; });
    }
    kvSet('prices', prices);
  }
  window.pvLoadPrice = async () => {
    const c = currentModalCardObj; if (!c) return;
    if (!isWest(c.id)) return showToast('Prezzi automatici solo per le carte occidentali del catalogo: usa i link.', 'info');
    try { await fetchPrices([c.id]); mktBox(); if (!prices[c.id]) showToast('Nessun prezzo Cardmarket per questa carta.', 'info'); } catch { showToast('Prezzo non disponibile ora.', 'error'); }
  };
  window.pvApplyPrice = () => { const p = prices[currentModalCardObj.id]; if (p) $('detailPrice').value = (p.trend || p.avg || 0).toFixed(2); };
  window.pvUpdateAll = async () => {
    const ids = Object.keys(ownedCardsMap).filter(isWest); if (!ids.length) return showToast('Nessuna carta occidentale da aggiornare.', 'info');
    showToast('Aggiornamento prezzi in corso…', 'info');
    try { await fetchPrices(ids); showToast('Prezzi Cardmarket aggiornati!', 'success'); } catch { showToast('Aggiornamento non riuscito o parziale.', 'error'); }
    renderStats();
  };

  // --- Backup sicuro ---
  async function snapshot() {
    const n = Object.keys(ownedCardsMap).length; if (!n) return;
    const day = new Date().toISOString().slice(0, 10); let s = ((await kvGet('snaps')) || []).filter(x => x.day !== day);
    s.unshift({ day, t: Date.now(), n, cards: ownedCardsMap, customSets, overrides: ov, manualSets: manual });
    await kvSet('snaps', s.slice(0, 7)); if (!$('viewCollection').classList.contains('hidden')) renderSnaps();
  }
  const _sc = saveCollectionToStorage;
  saveCollectionToStorage = function () { _sc(); clearTimeout(snapT); snapT = setTimeout(snapshot, 4000); paintBanner(); };
  const _ex = exportCollection;
  exportCollection = function () { _ex(); localStorage.setItem('pv_last_export', Date.now()); paintBanner(); };
  function paintBanner() {
    const b = $('pvBanner'); if (!b) return;
    const last = +localStorage.getItem('pv_last_export') || 0, d = Math.floor((Date.now() - last) / 864e5);
    b.classList.toggle('hidden', !(Object.keys(ownedCardsMap).length && (!last || d >= 14)));
    b.querySelector('span').textContent = last ? `Ultimo backup scaricato ${d} giorni fa.` : 'Non hai ancora scaricato nessun backup della collezione.';
  }
  async function renderSnaps() {
    const s = (await kvGet('snaps')) || [], el = $('pvSnaps'); if (!el) return;
    el.innerHTML = `<p class="${lbl}">Backup automatici (ultimi 7 giorni)</p>` + (s.length ? s.map((x, i) => `<div class="flex items-center justify-between text-xs py-1 border-b border-slate-100 dark:border-slate-800"><span>${formatDateIT(x.day)} • ${x.n} carte</span><button onclick="pvRestore(${i})" class="font-bold text-pokeBlue hover:underline">Ripristina</button></div>`).join('') : '<p class="text-xs text-slate-400">Nessuno snapshot ancora: se ne salva uno al giorno a ogni modifica.</p>');
  }
  window.pvRestore = async i => {
    const x = ((await kvGet('snaps')) || [])[i];
    if (!x || !confirm(`Ripristinare lo snapshot del ${formatDateIT(x.day)} (${x.n} carte)? La collezione attuale verrà sostituita.`)) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(x.cards)); customSets = x.customSets || []; saveCustom(); localStorage.setItem(MAN_KEY, JSON.stringify(x.manualSets || manual));
    await kvSet('overrides', x.overrides || { sets: {}, cards: {} }); location.reload();
  };
  window.pvCsv = () => {
    const rows = [['Set', 'Numero', 'Nome', 'Condizione', 'Variante', 'Quantità', 'Prezzo pagato (€)', 'Data acquisto', 'Tendenza Cardmarket (€)']];
    Object.values(ownedCardsMap).forEach(c => rows.push([c.setName, c.number, c.name, c.condition, c.variant, qtyOf(c), c.price, c.purchaseDate, prices[c.id] ? prices[c.id].trend : '']));
    download(`collezione-${new Date().toISOString().slice(0, 10)}.csv`, rows.map(r => r.map(csvCell).join(';')).join('\n'), 'text/csv');
  };

  // --- Statistiche e grafici ---
  function renderStats() {
    const el = $('pvStats'); if (!el) return;
    const list = Object.values(ownedCardsMap), sum = (a, f) => a.reduce((t, c) => t + f(c), 0);
    const copies = sum(list, qtyOf), spent = sum(list, c => (+c.price || 0) * qtyOf(c));
    const pr = list.filter(c => prices[c.id] && prices[c.id].trend != null), market = sum(pr, c => prices[c.id].trend * qtyOf(c)), paid = sum(pr, c => (+c.price || 0) * qtyOf(c));
    const dups = list.filter(c => qtyOf(c) > 1).length, diff = market - paid;
    const k = (l, v, s) => `<div class="rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 p-3"><p class="text-[11px] font-bold uppercase text-slate-500 dark:text-slate-400">${l}</p><p class="text-lg font-extrabold text-slate-900 dark:text-white">${v}</p><p class="text-[11px] text-slate-400">${s || ''}</p></div>`;
    const group = (kf, wf) => { const m = {}; list.forEach(c => { const x = kf(c) || 'N/D'; m[x] = (m[x] || 0) + wf(c); }); return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 8); };
    const bars = (t, rows, f = x => x) => { const mx = Math.max(1, ...rows.map(r => r[1])); return `<div class="space-y-1.5"><p class="${lbl}">${t}</p>${rows.map(([l, v]) => `<div class="flex items-center gap-2 text-[11px]"><span class="w-28 truncate text-slate-600 dark:text-slate-300" title="${esc(l)}">${esc(l)}</span><div class="flex-1 h-2 rounded bg-slate-200 dark:bg-slate-700"><div class="h-full rounded bg-pokeBlue" style="width:${v / mx * 100}%"></div></div><span class="w-14 text-right font-bold text-slate-800 dark:text-slate-200">${f(v)}</span></div>`).join('') || '<p class="text-xs text-slate-400">Nessun dato</p>'}</div>`; };
    const mo = {}; list.forEach(c => { const d = (c.purchaseDate || new Date(c.updatedAt || Date.now()).toISOString()).slice(0, 7); mo[d] = (mo[d] || 0) + qtyOf(c); });
    const ks = Object.keys(mo).sort(); let cum = 0; const pts = ks.map(x => (cum += mo[x]));
    const line = pts.map((v, i) => `${pts.length > 1 ? 4 + i / (pts.length - 1) * 292 : 150},${76 - v / cum * 68}`).join(' ');
    const growth = `<div><p class="${lbl}">Crescita collezione (copie cumulate)</p><svg viewBox="0 0 300 84" class="w-full h-24"><polyline points="${line}" fill="none" stroke="#2A75BB" stroke-width="2.5" stroke-linejoin="round"/></svg><div class="flex justify-between text-[10px] text-slate-400"><span>${ks[0] || ''}</span><span>${ks[ks.length - 1] || ''}</span></div></div>`;
    el.innerHTML = `<div class="grid grid-cols-2 lg:grid-cols-5 gap-3">${k('Copie totali', copies, list.length + ' carte uniche')}${k('Doppioni', dups, 'carte con più copie')}${k('Spesa registrata', eur(spent))}${k('Valore Cardmarket', eur(market), pr.length + ' carte con prezzo')}${k('Differenza', (diff >= 0 ? '+' : '') + eur(diff), 'mercato − pagato (solo carte con prezzo)')}</div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-5 pt-2">${bars('Per rarità (copie)', group(c => c.rarity, qtyOf))}${bars('Per set (copie)', group(c => c.setName, qtyOf))}${bars('Carte di maggior valore (tendenza)', pr.map(c => [c.name, prices[c.id].trend]).sort((a, b) => b[1] - a[1]).slice(0, 8), eur)}${growth}</div>`;
  }
  const _roc = renderOwnedCollection;
  renderOwnedCollection = function () { _roc(); renderStats(); };
  const _sv = switchView;
  switchView = function (v) { _sv(v); if (v === 'collection') renderSnaps(); };

  // --- Vista per Pokémon ---
  const _pr = window.pvRegion;
  window.pvRegion = async r => {
    if (r !== 'pokemon') { $('pokemonView').classList.add('hidden'); return _pr(r); }
    region = r; paintBar();
    if (currentSet) { currentSet = null; currentSetCards = []; $('setDetailView').classList.add('hidden'); $('customToolbar').classList.add('hidden'); }
    $('customSetsView').classList.add('hidden'); $('setsDirectoryView').classList.add('hidden'); $('pokemonView').classList.remove('hidden'); renderPokemon();
  };
  window.pvPokeSearch = async e => {
    e.preventDefault();
    const q = $('pkQuery').value.trim(); if (!q) return;
    $('pkSummary').textContent = 'Ricerca in corso…'; $('pkGrid').innerHTML = '';
    try {
      if ($('pkSource').value === 'jp') {
        const j = await getJson(`${TCGDEX}/ja/cards?name=${encodeURIComponent(q)}`, 2);
        pkRes = (Array.isArray(j) ? j : []).map(c => { const sid = c.id.slice(0, c.id.length - String(c.localId).length - 1), st = jpSets.find(s => s.id === 'jp:' + sid); return { id: 'jp:' + c.id, name: c.name, number: c.localId, rarity: '', images: imgs(c.image), set: { id: 'jp:' + sid, name: st ? st.name : sid, series: st ? st.series : '🇯🇵 Altro' } }; });
      } else {
        const j = await getJson(`${API_BASE}/cards?q=${encodeURIComponent(`name:"${q}*"`)}&pageSize=250&select=id,name,number,rarity,artist,images,set`, 2);
        pkRes = (j.data || []).sort((a, b) => (a.set.releaseDate || '').localeCompare(b.set.releaseDate || ''));
      }
    } catch { pkRes = []; showToast('Ricerca non riuscita, riprova.', 'error'); }
    applyCards(pkRes); currentSetCards = pkRes; renderPokemon();
  };
  function renderPokemon() {
    if (!$('pkGrid')) return;
    const own = pkRes.filter(c => ownedCardsMap[c.id]).length;
    $('pkSummary').innerHTML = pkRes.length ? `<b>${own}</b> possedute su <b>${pkRes.length}</b> carte trovate (${Math.round(own / pkRes.length * 100)}%)` : '';
    $('pkGrid').innerHTML = pkRes.map((c, i) => {
      const o = ownedCardsMap[c.id], im = (c.images && (c.images.small || c.images.large)) || ph();
      return `<div class="relative bg-white dark:bg-slate-900 rounded-xl p-2 border ${o ? 'border-emerald-500' : 'border-slate-200 dark:border-slate-800'}">
        <button onclick="pvPokeToggle(${i})" class="absolute top-3 right-3 z-20 w-7 h-7 rounded-full flex items-center justify-center shadow-md text-sm ${o ? 'bg-emerald-500 text-white' : 'bg-slate-900/70 text-slate-200 hover:bg-emerald-500'}">✓</button>
        <div onclick="openCardDetailModal('${c.id}')" class="cursor-pointer"><div class="aspect-[2.5/3.5] rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-800"><img src="${esc(im)}" loading="lazy" alt="${esc(c.name)}" class="w-full h-full object-contain ${o ? 'card-owned' : 'card-unowned'}"></div>
        <p class="text-xs font-extrabold truncate mt-2 text-slate-900 dark:text-white">${esc(c.name)}${o && qtyOf(o) > 1 ? ' ×' + qtyOf(o) : ''}</p><p class="text-[10px] text-slate-500 truncate">#${esc(c.number)} • ${esc(c.set ? c.set.name : '')}</p></div></div>`;
    }).join('');
  }
  window.pvPokeToggle = i => {
    const c = pkRes[i];
    if (ownedCardsMap[c.id]) delete ownedCardsMap[c.id];
    else ownedCardsMap[c.id] = { id: c.id, name: c.name, number: c.number, setId: c.set.id, setName: c.set.name, series: c.set.series || 'Other', rarity: c.rarity || 'Comune', image: (c.images && (c.images.large || c.images.small)) || '', condition: 'Near Mint', price: 0, purchaseDate: new Date().toISOString().split('T')[0], variant: 'Normale', qty: 1, updatedAt: Date.now() };
    saveCollectionToStorage(); renderPokemon();
  };

  // --- Lista dei mancanti ---
  window.pvMissing = () => {
    if (!currentSet) return;
    const miss = currentSetCards.filter(c => !ownedCardsMap[c.id]);
    $('pvMissTxt').value = `Carte mancanti – ${currentSet.name} (${miss.length}/${currentSetCards.length})\n\n` + miss.map(c => `☐ #${c.number}  ${c.name}`).join('\n');
    $('pvMissModal').classList.remove('hidden'); $('pvMissModal').classList.add('flex');
  };
  window.pvMissClose = () => { $('pvMissModal').classList.add('hidden'); $('pvMissModal').classList.remove('flex'); };
  window.pvMissCopy = () => navigator.clipboard.writeText($('pvMissTxt').value).then(() => showToast('Lista copiata!', 'success'));
  window.pvMissTxtDl = () => download('carte-mancanti.txt', $('pvMissTxt').value, 'text/plain');
  window.pvMissPrint = () => { const w = window.open('', '_blank'); if (!w) return; w.document.write(`<pre style="font:15px/1.8 sans-serif;white-space:pre-wrap">${esc($('pvMissTxt').value)}</pre>`); w.document.close(); w.print(); };

  async function initFeatures() {
    const btn = 'px-4 py-2 rounded-xl text-xs sm:text-sm font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition';
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
    prices = (await kvGet('prices')) || {};
    // Quantità + prezzi nel dettaglio carta
    $('detailVariant').parentElement.insertAdjacentHTML('afterend', `<div><label class="${lbl}" for="pvQty">Quantità</label><input type="number" id="pvQty" min="1" step="1" value="1" class="${inp} w-full"></div>`);
    $('detailCardForm').lastElementChild.insertAdjacentHTML('beforebegin', '<div id="pvMkt" class="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700"></div>');
    // Vista Pokémon
    $('regionBar').insertAdjacentHTML('beforeend', '<button data-r="pokemon" onclick="pvRegion(\'pokemon\')">🔎 Per Pokémon</button>'); paintBar();
    const pv = document.createElement('div'); pv.id = 'pokemonView'; pv.className = 'hidden space-y-5';
    pv.innerHTML = `<div class="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm space-y-3">
      <div><h2 class="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white">Vista per Pokémon</h2><p class="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">Cerca un Pokémon e vedi tutte le sue carte in tutti i set: colorate quelle che hai, grigie quelle che ti mancano.</p></div>
      <form onsubmit="pvPokeSearch(event)" class="flex flex-col sm:flex-row gap-2"><select id="pkSource" class="${inp}"><option value="west">Occidentali</option><option value="jp">Giapponesi (nome in giapponese)</option></select>
      <input id="pkQuery" placeholder="es. Pikachu, Charizard" class="${inp} flex-1"><button class="px-4 py-2 rounded-xl text-sm font-bold bg-pokeBlue hover:bg-blue-700 text-white transition">Cerca</button></form>
      <p id="pkSummary" class="text-xs text-slate-600 dark:text-slate-300"></p></div>
      <div id="pkGrid" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3.5"></div>`;
    $('viewSets').appendChild(pv);
    // Mancanti
    const bm = document.createElement('button'); bm.className = 'px-3 py-1.5 rounded-xl text-xs font-bold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition';
    bm.textContent = '📋 Mancanti'; bm.onclick = pvMissing; $('setFilterAllBtn').parentElement.appendChild(bm);
    const mm = document.createElement('div'); mm.id = 'pvMissModal'; mm.className = 'fixed inset-0 z-[60] hidden items-center justify-center bg-slate-950/75 backdrop-blur-sm p-4';
    mm.innerHTML = `<div class="bg-white dark:bg-slate-900 w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden"><div class="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/60"><h2 class="text-lg font-extrabold text-slate-900 dark:text-white">Lista dei mancanti</h2><button onclick="pvMissClose()" class="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button></div>
      <div class="p-6 space-y-3"><textarea id="pvMissTxt" readonly class="${inp} w-full h-64 font-mono text-xs"></textarea><div class="flex flex-wrap gap-2 justify-end"><button onclick="pvMissCopy()" class="${btn}">Copia</button><button onclick="pvMissTxtDl()" class="${btn}">Scarica TXT</button><button onclick="pvMissPrint()" class="${btn}">Stampa</button></div></div></div>`;
    document.body.appendChild(mm);
    // Pannello statistiche e strumenti (La Mia Collezione) + avviso backup
    const tp = document.createElement('section'); tp.className = 'bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4';
    tp.innerHTML = `<div class="flex flex-wrap items-center justify-between gap-2"><h3 class="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white">📊 Statistiche e strumenti</h3><div class="flex flex-wrap gap-2"><button onclick="pvUpdateAll()" class="${btn}">↻ Aggiorna prezzi</button><button onclick="pvCsv()" class="${btn}">⬇ CSV</button><button onclick="exportCollection()" class="${btn}">💾 Backup JSON</button></div></div><div id="pvStats"></div><div id="pvSnaps"></div>`;
    $('viewCollection').firstElementChild.after(tp);
    document.querySelector('main').insertAdjacentHTML('afterbegin', '<div id="pvBanner" class="hidden flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 px-4 py-3 text-sm text-amber-900 dark:text-amber-200"><span></span><button onclick="exportCollection()" class="px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-500 text-white">Scarica backup ora</button></div>');
    paintBanner(); renderStats();
  }

  // ---------- Aggiornamento espansioni + creazione manuale di set ----------
  const MAN_KEY = 'pokevault_manual_sets_v1';
  let manual = [], ctimes = {}, msLogo = '';
  try { manual = JSON.parse(localStorage.getItem(MAN_KEY)) || []; } catch { manual = []; }
  const saveManual = () => { try { localStorage.setItem(MAN_KEY, JSON.stringify(manual)); } catch { showToast('Errore di salvataggio dei set manuali.', 'error'); } };
  const stamp = k => { ctimes[k] = Date.now(); kvSet('ctimes', ctimes); };
  // Le carte in cache di un set incompleto vengono riscaricate dopo 24 ore
  function isStale(k, n) {
    const s = k.startsWith('w:') ? allSets.find(x => x.id === k.slice(2)) : jpSets.find(x => x.id === k);
    return n < (s ? (s.total || s.printedTotal || 0) : 0) && Date.now() - (ctimes[k] || 0) > 864e5;
  }
  const manSet = m => ({ id: m.id, name: m.name, base: m.base, series: m.series, total: m.total, printedTotal: m.total, releaseDate: m.releaseDate || '', images: { symbol: m.logo || '', logo: m.logo || '' }, manual: true });
  const manualSets = r => manual.filter(m => m.region === r && !(r === 'jp' ? jpSets : allSets).some(s => s.id === m.id)).map(manSet);

  const _r3 = renderSeriesDirectory;
  renderSeriesDirectory = function () {
    const sw = allSets, sj = jpSets;
    allSets = sw.concat(manualSets('west')); jpSets = sj.concat(manualSets('jp'));
    try { _r3(); } finally { allSets = sw; jpSets = sj; }
  };
  const syncMan = () => { const t = $('manToolbar'); if (!t) return; t.classList.toggle('hidden', !(currentSet && currentSet.manual)); $('manAddBtn').classList.toggle('hidden', !(currentSet && currentSet.id.startsWith('man:'))); };
  const _o3 = openSetDetail;
  openSetDetail = function (id) { const sw = allSets; allSets = sw.concat(manual.map(manSet)); const p = _o3(id); allSets = sw; syncMan(); return p; };
  const _c3 = closeSetDetail;
  closeSetDetail = function () { _c3(); syncMan(); };
  const _pr3 = window.pvRegion;
  window.pvRegion = async r => { await _pr3(r); syncMan(); };
  const _lc3 = loadCardsForSet;
  loadCardsForSet = async function (id) {
    if (!id.startsWith('man:')) return _lc3(id);
    const m = manual.find(x => x.id === id);
    currentSetCards = (m && m.cards || []).map(c => ({ id: c.id, name: c.name, number: c.number, rarity: '', images: { small: c.image || ph(), large: c.image || ph() } }));
    applyCards(currentSetCards); $('setCardsLoader').classList.add('hidden');
  };
  window.pvManAddCard = async () => {
    const m = manual.find(x => x.id === currentSet.id); if (!m || !m.cards) return;
    const name = prompt('Nome della carta?'); if (!name) return;
    const num = prompt('Numero della carta?', String(m.cards.length + 1));
    m.cards.push({ id: m.id + '#' + Date.now().toString(36), name: name.trim(), number: (num || '').trim() || String(m.cards.length + 1), image: '' });
    m.total = m.cards.length; currentSet.total = m.total; saveManual();
    await loadCardsForSet(m.id); updateSetDetailHeaderStats(); renderSetCardsGrid(); $('detailSetMeta').textContent = `${m.total} carte totali`;
  };
  window.pvManDelete = () => {
    const m = manual.find(x => x.id === currentSet.id); if (!m || !confirm(`Eliminare il set «${currentSet.name}» e le sue carte flaggate?`)) return;
    Object.keys(ownedCardsMap).forEach(k => { if (ownedCardsMap[k].setId === m.id) delete ownedCardsMap[k]; });
    manual = manual.filter(x => x.id !== m.id); saveManual(); saveCollectionToStorage(); closeSetDetail();
  };

  // --- Crea set ---
  window.pvLogoUrl = v => { msLogo = v.trim(); };
  window.pvManClose = () => { $('pvManModal').classList.add('hidden'); $('pvManModal').classList.remove('flex'); };
  window.pvManType = () => {
    const r = $('msType').value;
    $('msCatBox').classList.toggle('hidden', r !== 'jp');
    const names = [...new Set((r === 'jp' ? jpSets.map(s => s.base) : allSets.map(s => s.series)).filter(Boolean))];
    $('msBlocks').innerHTML = names.map(n => `<option value="${esc(n)}">`).join('');
  };
  window.pvManOpen = () => {
    $('pvManForm').reset(); msLogo = ''; $('msType').value = region === 'jp' ? 'jp' : 'west'; pvManType();
    $('pvManModal').classList.remove('hidden'); $('pvManModal').classList.add('flex'); $('msName').focus();
  };
  window.pvManSave = e => {
    e.preventDefault();
    const r = $('msType').value, name = $('msName').value.trim(), block = $('msBlock').value.trim(), api = $('msApi').value.trim();
    if (!name || !block) return;
    const total = Math.max(0, parseInt($('msTotal').value, 10) || 0), id = api ? (r === 'jp' ? 'jp:' + api : api) : 'man:' + Date.now().toString(36);
    if (manual.some(m => m.id === id) || (r === 'jp' ? jpSets : allSets).some(s => s.id === id)) return showToast('Esiste già un set con questo ID.', 'error');
    if (r === 'jp') [`🇯🇵 ${block} · Set principali`, `🇯🇵 ${block} · Set speciali`].forEach(k => { if (!SERIES_ORDER.includes(k)) SERIES_ORDER.push(k); SERIES_LABELS[k] = k; });
    manual.push({ id, region: r, name, base: block, series: r === 'jp' ? `🇯🇵 ${block} · ${$('msCat').value}` : block, releaseDate: $('msDate').value.replace(/-/g, '/'), total, logo: msLogo,
      cards: api ? null : Array.from({ length: total }, (_, i) => ({ id: id + '#' + (i + 1), name: 'Carta ' + (i + 1), number: String(i + 1), image: '' })) });
    saveManual(); pvManClose(); pvRegion(r === 'jp' ? 'jp' : 'west'); showToast(`Set «${name}» creato!`, 'success');
  };

  // --- Aggiornamento espansioni ---
  window.pvUpdClose = () => { $('pvUpdModal').classList.add('hidden'); $('pvUpdModal').classList.remove('flex'); };
  function showUpdates(found, manualRun) {
    if (!found.length) { if (manualRun) showToast('Nessuna nuova espansione: sei aggiornato!', 'success'); return; }
    $('pvUpdList').innerHTML = found.map(s => `<button onclick="pvUpdClose();openSetDetail('${s.id}')" class="w-full text-left px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-sm font-semibold text-slate-800 dark:text-slate-100">${esc(s.label)}</button>`).join('');
    $('pvUpdModal').classList.remove('hidden'); $('pvUpdModal').classList.add('flex');
  }
  async function checkUpdates(manualRun) {
    const btn = $('pvUpdBtn'), found = [];
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Controllo…'; }
    if (manualRun) { ctimes = {}; kvDel('ctimes'); }
    try {
      const j = await getJson(`${API_BASE}/sets?orderBy=releaseDate`, 2);
      if (j.data && j.data.length) {
        const known = new Set(allSets.map(s => s.id));
        j.data.filter(s => !known.has(s.id)).forEach(s => found.push({ id: s.id, label: '🌍 ' + s.name }));
        allSets = j.data; localStorage.setItem(SETS_CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data: j.data }));
      }
    } catch { if (manualRun) showToast('Set occidentali: controllo non riuscito.', 'error'); }
    const prev = jpSets;
    if (prev.length) { // i set giapponesi si ricontrollano solo se già caricati
      try {
        const old = new Set(prev.map(s => s.id)); await kvDel('jp_sets'); jpSets = []; await loadJp();
        jpSets.filter(s => !old.has(s.id)).forEach(s => found.push({ id: s.id, label: '🇯🇵 ' + s.name }));
      } catch { jpSets = prev; if (manualRun) showToast('Set giapponesi: controllo non riuscito.', 'error'); }
    }
    localStorage.setItem('pv_last_check', Date.now());
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Aggiorna espansioni'; }
    if (!currentSet && region !== 'custom' && region !== 'pokemon') renderSeriesDirectory();
    showUpdates(found, manualRun);
  }
  window.pvCheckUpdates = checkUpdates;

  async function initUpdates() {
    ctimes = (await kvGet('ctimes')) || {};
    const bc = 'px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition disabled:opacity-60';
    $('seriesJumpSelect').parentElement.insertAdjacentHTML('beforeend', `<button id="pvUpdBtn" onclick="pvCheckUpdates(true)" class="${bc}">🔄 Aggiorna espansioni</button><button onclick="pvManOpen()" class="${bc}">➕ Crea set</button>`);
    const mt = document.createElement('div'); mt.id = 'manToolbar'; mt.className = 'hidden flex flex-wrap gap-2';
    mt.innerHTML = `<button id="manAddBtn" onclick="pvManAddCard()" class="px-4 py-2 rounded-xl text-xs sm:text-sm font-bold bg-pokeRed hover:bg-red-600 text-white shadow-md transition">➕ Aggiungi carta</button><button onclick="pvManDelete()" class="px-4 py-2 rounded-xl text-xs sm:text-sm font-bold bg-slate-100 dark:bg-slate-800 text-red-600 hover:bg-red-50 dark:hover:bg-slate-700 transition">🗑️ Elimina set</button>`;
    $('setCardSearchInput').parentElement.before(mt);
    const head = (t, f) => `<div class="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/60"><h2 class="text-lg font-extrabold text-slate-900 dark:text-white">${t}</h2><button type="button" onclick="${f}()" class="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button></div>`;
    const wrap = 'fixed inset-0 z-[60] hidden items-center justify-center bg-slate-950/75 backdrop-blur-sm p-4 overflow-y-auto', box = 'bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden my-auto';
    const um = document.createElement('div'); um.id = 'pvUpdModal'; um.className = wrap;
    um.innerHTML = `<div class="${box}">${head('🎉 Nuove espansioni trovate', 'pvUpdClose')}<div id="pvUpdList" class="p-6 space-y-2 max-h-96 overflow-y-auto"></div></div>`;
    const mm = document.createElement('div'); mm.id = 'pvManModal'; mm.className = wrap;
    mm.innerHTML = `<form id="pvManForm" onsubmit="pvManSave(event)" class="${box}">${head('Crea set', 'pvManClose')}
      <div class="p-6 space-y-3">
        <div class="grid grid-cols-2 gap-3"><div><label class="${lbl}">Tipo</label><select id="msType" onchange="pvManType()" class="${inp} w-full"><option value="west">🌍 Occidentale</option><option value="jp">🇯🇵 Giapponese</option></select></div>
        <div id="msCatBox" class="hidden"><label class="${lbl}">Categoria</label><select id="msCat" class="${inp} w-full"><option>Set principali</option><option>Set speciali</option></select></div></div>
        <div><label class="${lbl}">Blocco di espansione *</label><input id="msBlock" required list="msBlocks" placeholder="Scegli uno esistente o scrivine uno nuovo" class="${inp} w-full"><datalist id="msBlocks"></datalist></div>
        <div><label class="${lbl}">Nome del set *</label><input id="msName" required maxlength="80" class="${inp} w-full"></div>
        <div class="grid grid-cols-2 gap-3"><div><label class="${lbl}">Data di uscita</label><input id="msDate" type="date" class="${inp} w-full"></div><div><label class="${lbl}">Numero carte</label><input id="msTotal" type="number" min="0" value="0" class="${inp} w-full"></div></div>
        <div><label class="${lbl}">ID del set nel catalogo (opzionale)</label><input id="msApi" placeholder="es. sv3pt5 — le carte si caricano da sole" class="${inp} w-full"><p class="text-[11px] text-slate-400 mt-1">Senza ID il set viene creato con carte numerate da rinominare e illustrare con ✏️.</p></div>
        <div><label class="${lbl}">Logo del set</label><div class="flex gap-2"><input id="msLogoUrl" placeholder="URL immagine" class="${inp} flex-1" oninput="pvLogoUrl(this.value)"><input id="msLogoFile" type="file" accept="image/*" class="${inp} w-40 text-xs"></div></div>
      </div>
      <div class="px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2"><button type="button" onclick="pvManClose()" class="px-4 py-2 rounded-xl text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">Annulla</button><button class="px-5 py-2 rounded-xl text-sm font-bold bg-pokeRed hover:bg-red-600 text-white shadow-md">Crea</button></div></form>`;
    document.body.append(um, mm);
    $('msLogoFile').onchange = async e => { const f = e.target.files[0]; if (f) { try { msLogo = await fileToData(f, 240); $('msLogoUrl').value = ''; } catch { showToast('Immagine non leggibile.', 'error'); } } };
    if (Date.now() - (+localStorage.getItem('pv_last_check') || 0) > 864e5) setTimeout(() => checkUpdates(false), 6000);
  }

  // ---------- Inizializzazione UI ----------
  function init() {
    try { customSets = JSON.parse(localStorage.getItem(CUSTOM_KEY)) || []; } catch { customSets = []; }
    // pulizia vecchie cache carte (potevano contenere liste vuote o troncate)
    if (!localStorage.getItem('pokevault_cache_purged_v2')) {
      Object.keys(localStorage).filter(k => k.startsWith(CARDS_CACHE_PREFIX)).forEach(k => localStorage.removeItem(k));
      localStorage.setItem('pokevault_cache_purged_v2', '1');
    }
    SERIES_LABELS['Set Personalizzati'] = 'Set Personalizzati';
    const bar = document.createElement('div');
    bar.id = 'regionBar'; bar.className = 'flex flex-wrap gap-2 bg-white dark:bg-slate-900 rounded-2xl p-2 border border-slate-200 dark:border-slate-800 shadow-sm';
    bar.innerHTML = [['west', '🌍 Occidentali'], ['jp', '🇯🇵 Giapponesi'], ['custom', '🧩 Set Personalizzati']].map(([k, l]) => `<button data-r="${k}" onclick="pvRegion('${k}')">${l}</button>`).join('');
    $('viewSets').prepend(bar);
    const cv = document.createElement('div'); cv.id = 'customSetsView'; cv.className = 'hidden space-y-5'; $('viewSets').appendChild(cv);
    const tb = document.createElement('div');
    tb.id = 'customToolbar'; tb.className = 'hidden flex flex-wrap gap-2';
    tb.innerHTML = `<button onclick="pvOpenAdd()" class="px-4 py-2 rounded-xl text-xs sm:text-sm font-bold bg-pokeRed hover:bg-red-600 text-white shadow-md transition">➕ Aggiungi carte</button>
      <button onclick="pvDeleteSet()" class="px-4 py-2 rounded-xl text-xs sm:text-sm font-bold bg-slate-100 dark:bg-slate-800 text-red-600 hover:bg-red-50 dark:hover:bg-slate-700 transition">🗑️ Elimina set</button>`;
    $('setCardSearchInput').parentElement.before(tb);
    const rl = document.createElement('button');
    rl.onclick = pvReload; rl.title = 'Riscarica le carte del set';
    rl.className = 'px-3 py-1.5 rounded-xl text-xs font-bold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition';
    rl.textContent = '↻ Ricarica'; $('setFilterAllBtn').parentElement.appendChild(rl);
    const m = document.createElement('div');
    m.id = 'csAddModal'; m.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4 overflow-y-auto';
    m.innerHTML = `<div class="bg-white dark:bg-slate-900 w-full max-w-3xl rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden my-auto">
      <div class="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/60">
        <h2 class="text-lg font-extrabold text-slate-900 dark:text-white">Aggiungi carte al set</h2>
        <button onclick="pvCloseAdd()" class="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-lg leading-none">✕</button></div>
      <div class="p-6 space-y-5">
        <form onsubmit="pvSearch(event)" class="flex flex-col sm:flex-row gap-2">
          <select id="csSource" class="${inp}"><option value="west">Occidentali</option><option value="jp">Giapponesi (nome in giapponese)</option></select>
          <input id="csQuery" placeholder="Nome carta (es. Charizard, ピカチュウ)" class="${inp} flex-1">
          <button class="px-4 py-2 rounded-xl text-sm font-bold bg-pokeBlue hover:bg-blue-700 text-white transition">Cerca</button></form>
        <div id="csResults" class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3 max-h-80 overflow-y-auto"></div>
        <form onsubmit="pvManual(event)" class="pt-4 border-t border-slate-200 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-4 gap-2">
          <input id="cmName" required placeholder="Nome (manuale)" class="${inp}"><input id="cmNumber" placeholder="Numero" class="${inp}">
          <input id="cmImage" type="url" placeholder="URL foto (opzionale)" class="${inp}"><button class="px-4 py-2 rounded-xl text-sm font-bold bg-slate-800 dark:bg-slate-700 text-white">Aggiungi</button></form>
      </div></div>`;
    document.body.appendChild(m);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') pvCloseAdd(); });
    paintBar(); initEdit(); initFeatures(); initUpdates();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
