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
    if (c && c.length) return c;
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
    if (!cards.length) throw new Error('vuoto');
    cards = sortCards(cards); kvSet(key, cards); return cards;
  }
  async function jpCards(setId) {
    const c = await kvGet(setId);
    if (c && c.length) return c;
    const j = await getJson(`${TCGDEX}/ja/sets/${encodeURIComponent(setId.slice(3))}`);
    const cards = sortCards((j.cards || []).map(c => ({ id: 'jp:' + c.id, name: c.name || ('#' + c.localId), number: c.localId, rarity: '', images: imgs(c.image) })));
    if (!cards.length) throw new Error('vuoto');
    kvSet(setId, cards); return cards;
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
      const blob = new Blob([JSON.stringify({ version: 3, exportedAt: new Date().toISOString(), cards: ownedCardsMap, customSets, overrides: ov }, null, 2)], { type: 'application/json' });
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
      try { const p = JSON.parse(r.result); if (p && Array.isArray(p.customSets)) { customSets = p.customSets; saveCustom(); } if (p && p.overrides) { ov = Object.assign({ sets: {}, cards: {} }, p.overrides); saveOv(); } } catch {}
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
    paintBar(); initEdit();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
