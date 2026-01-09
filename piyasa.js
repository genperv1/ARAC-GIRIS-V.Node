
/* PİYASA MODÜLÜ
   - Login ve mevcut İHRACAT Excel sistemine dokunmaz.
   - Araçlar menüsüne eklenen:
     #piyasaExcelUploadButtonTop / #piyasaExcelClearButtonTop
   - Excel yükleyince hafta sorar, siparişleri liste modalında gösterir,
     seçince form alanlarını doldurur.
*/
(function(){
  // Sayfa yenilense bile piyasa verisini kaybetmemek için localStorage kullanıyoruz.
  // (Login ve mevcut ihracat excel sistemine dokunmadan.)
  const STORAGE_KEY = 'piyasa_state_v1';
  const state = {
    orders: [],
    week: null,
    sheet: null,
    loadedAt: null,
  };

  function saveState(){
    try{
      const payload = {
        week: state.week,
        sheet: state.sheet,
        loadedAt: state.loadedAt ? state.loadedAt.toISOString() : null,
        // LocalStorage sınırı için sadece gerekli alanları saklıyoruz
        orders: (state.orders || []).map(o => ({
          __idx: o.__idx,
          firma: o.firma,
          malzeme: o.malzeme,
          yuklemeTuru: o.yuklemeTuru,
          aciklama: o.aciklama,
          il: o.il,
          miktar: o.miktar,
        }))
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      // GIRIS.html üstteki “Excel durumu” alanını anında güncelle
      try { window.refreshHeaderExcelInfo && window.refreshHeaderExcelInfo(); } catch(e) {}
    }catch(e){
      // localStorage dolu olabilir; bu durumda sessiz geçiyoruz.
      console.warn('Piyasa saveState failed', e);
    }
  }

  function loadState(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const payload = JSON.parse(raw);
      if (!payload || !Array.isArray(payload.orders) || payload.orders.length === 0) return false;
      state.week = payload.week ?? null;
      state.sheet = payload.sheet ?? null;
      state.loadedAt = payload.loadedAt ? new Date(payload.loadedAt) : null;
      state.orders = payload.orders.map((o, i) => ({
        __idx: o.__idx ?? (i+1),
        firma: o.firma || '',
        malzeme: o.malzeme || '',
        yuklemeTuru: o.yuklemeTuru || '',
        aciklama: o.aciklama || '',
        il: o.il || '',
        miktar: o.miktar || '',
      }));
      return true;
    }catch(e){
      console.warn('Piyasa loadState failed', e);
      return false;
    }
  }

  function clearSavedState(){
    try{ localStorage.removeItem(STORAGE_KEY); }catch(e){}
  }

  function toast(msg, type){
    try{
      if (typeof window.showToast === 'function') return window.showToast(msg, type || 'info');
    }catch(e){}
    // fallback
    console.log('[PİYASA]', msg);
  }

  function normKey(k){
    return String(k||'')
      .toUpperCase()
      .replaceAll('İ','I')
      .replace(/\s+/g,' ')
      .trim();
  }

  function pick(obj, wanted){
    const map = {};
    for (const key of Object.keys(obj||{})) map[normKey(key)] = obj[key];
    for (const w of wanted){
      const v = map[normKey(w)];
      if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }
    return '';
  }

  function getWeekFromSheetName(name){
    const m = String(name||'').toUpperCase().match(/(\d{1,2})\s*\.?\s*HAFTA/);
    return m ? parseInt(m[1], 10) : null;
  }

  function ensureHiddenFileInput(id){
    let inp = document.getElementById(id);
    if (inp) return inp;
    inp = document.createElement('input');
    inp.type = 'file';
    inp.id = id;
    inp.accept = '.xlsx,.xls,.xlsm,.xlsb';
    inp.style.display = 'none';
    document.body.appendChild(inp);
    return inp;
  }

  function askWeek(weeks){
    const def = (weeks && weeks.length) ? String(weeks[0]) : '';
    const answer = prompt(`Hangi haftayı yükleyelim?\nMevcut haftalar: ${weeks.join(', ')}`, def);
    if (answer === null) return null;
    const w = parseInt(String(answer).trim(), 10);
    if (!Number.isFinite(w)) return null;
    return w;
  }

  function chooseBestSheetByRowCount(workbook, sheetNames){
    // ✅ Hız: sheet_to_json ile saymak çok pahalı.
    // !ref üzerinden yaklaşık satır sayısı (çok hızlı) ile en büyük sheet'i seç.
    let best = sheetNames[0];
    let bestCount = -1;
    for (const s of sheetNames){
      try{
        const ws = workbook.Sheets[s];
        const ref = ws && ws['!ref'];
        let rowCount = 0;
        if (ref && XLSX && XLSX.utils && XLSX.utils.decode_range){
          const range = XLSX.utils.decode_range(ref);
          rowCount = (range.e.r - range.s.r + 1) || 0;
        }
        if (rowCount > bestCount){
          bestCount = rowCount;
          best = s;
        }
      }catch(e){}
    }
    return best;
  }

  // Excel'deki bazı satırlar filtre/gizli olabilir. Varsa !rows.hidden bilgisine göre ele.
  function filterHiddenRowsAoA(ws, table){
    try{
      const rowsMeta = ws && ws['!rows'];
      if (!rowsMeta || !Array.isArray(rowsMeta)) return table;
      const out = [];
      for (let i = 0; i < table.length; i++){
        const meta = rowsMeta[i];
        if (meta && meta.hidden) continue;
        out.push(table[i]);
      }
      return out;
    }catch(e){
      return table;
    }
  }

  function parseAmount(v){
    const s = String(v ?? '').trim();
    if (!s) return NaN;
    // 1.234,56 / 1234,56 / 1234.56 gibi
    const cleaned = s
      .replace(/\s+/g,'')
      .replace(/\./g,'')
      .replace(',', '.');
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : NaN;
  }

  function isSummaryText(v){
    const t = String(v||'').toUpperCase().replaceAll('İ','I');
    return t.includes('TOPLAM') || t.includes('ARA TOPLAM') || t.includes('GENEL TOPLAM') || t.includes('OZET') || t.includes('ÖZET');
  }

  function parseSheetSmart(ws){
    // Bazı dosyalarda başlık satırı 1. satır değildir (üstte boş/sabit satırlar olabilir).
    // Bu yüzden sheet'i önce tablo (array-of-arrays) olarak okuyup başlık satırını buluyoruz.
    let table = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    table = filterHiddenRowsAoA(ws, table);
    const expected = ['FİRMA','FIRMA','MALZEME','YÜKLEME TÜRÜ','YUKLEME TURU','AÇIKLAMA','ACIKLAMA','İL','IL','MİKTAR','MIKTAR'];

    function cellNorm(v){
      return String(v||'')
        .toUpperCase()
        .replaceAll('İ','I')
        .replace(/\s+/g,' ')
        .trim();
    }

    // İlk 40 satır içinde, beklenen başlıklardan en az 2-3 tanesini içeren satırı başlık kabul et.
    let headerRowIndex = -1;
    let bestScore = -1;
    const scanMax = Math.min(table.length, 40);
    for (let i = 0; i < scanMax; i++){
      const row = table[i] || [];
      const set = new Set(row.map(cellNorm).filter(Boolean));
      let score = 0;
      for (const k of expected) if (set.has(cellNorm(k))) score++;
      if (score > bestScore){
        bestScore = score;
        headerRowIndex = i;
      }
    }

    // Eğer hiç başlık bulamadıysa, klasik json'a dön.
    if (bestScore < 2 || headerRowIndex < 0){
      return XLSX.utils.sheet_to_json(ws, { defval: '' });
    }

    const header = (table[headerRowIndex] || []).map(v=> String(v||'').trim());
    // Boş başlıkları doldur
    const safeHeader = header.map((h, idx)=> h && h.trim() ? h : `__COL_${idx}`);

    const out = [];
    for (let r = headerRowIndex + 1; r < table.length; r++){
      const row = table[r];
      if (!row) continue;
      const obj = {};
      for (let c = 0; c < safeHeader.length; c++){
        obj[safeHeader[c]] = row[c] ?? '';
      }
      out.push(obj);
    }
    return out;
  }

  function normalizeRows(rawRows){
    return (rawRows || []).map((r, idx)=>({
      __idx: idx + 1,
      firma: pick(r, ['FİRMA','FIRMA']),
      malzeme: pick(r, ['MALZEME']),
      yuklemeTuru: pick(r, ['YÜKLEME TÜRÜ','YUKLEME TURU','YÜKLEME TURU']),
      aciklama: pick(r, ['AÇIKLAMA','ACIKLAMA']),
      il: pick(r, ['İL','IL']),
      miktar: pick(r, ['MİKTAR','MIKTAR']),
      _raw: r
    })).filter(o=>{
      // Sipariş satırı filtresi (fazla satır sayımını azaltır)
      const firma = String(o.firma||'').trim();
      const malzeme = String(o.malzeme||'').trim();
      const miktarRaw = String(o.miktar||'').trim();
      const any = (firma||malzeme||o.yuklemeTuru||o.aciklama||o.il||miktarRaw);
      if (!String(any||'').trim()) return false;
      if (isSummaryText(firma) || isSummaryText(malzeme)) return false;
      // En az firma+malzeme olmalı
      if (!firma || !malzeme) return false;
      // Miktar sayısal ve >0 olmalı (miktar yoksa sipariş saymayalım)
      const n = parseAmount(miktarRaw);
      if (!Number.isFinite(n) || n <= 0) return false;
      return true;
    });
  }

  function getSheetMetaForPicker(wb){
    const metas = [];
    const names = wb.SheetNames || [];
    for (let i = 0; i < names.length; i++){
      const name = names[i];
      const week = getWeekFromSheetName(name);
      if (!week) continue;

      // HIZLI: tüm sheet'i JSON'a çevirmeden yaklaşık satır sayısı al
      let approxRows = 0;
      try{
        const ws = wb.Sheets[name];
        const ref = ws && ws['!ref'];
        if (ref && XLSX?.utils?.decode_range){
          const range = XLSX.utils.decode_range(ref);
          approxRows = (range.e.r - range.s.r + 1) || 0;
        }
      }catch(e){
        approxRows = 0;
      }

      metas.push({ name, week, count: approxRows, approx: true, orderIndex: i });
    }
    return metas;
  }

  function openSheetPickerModal(metas, onConfirm){
    const weeks = Array.from(new Set(metas.map(m=>m.week))).sort((a,b)=>a-b);
    const defaultWeek = weeks[0] ?? null;

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;';
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:14px;max-width:780px;width:100%;max-height:82vh;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,.25);display:flex;flex-direction:column;">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #eee;gap:12px;">
          <div style="font-weight:900;">PİYASA Excel • Kitap Seç</div>
          <button id="piyasaSheetModalClose" style="border:0;background:#eee;border-radius:10px;padding:6px 10px;cursor:pointer;">Kapat</button>
        </div>
        <div style="padding:10px 14px;display:flex;gap:10px;align-items:center;border-bottom:1px solid #eee;flex-wrap:wrap;">
          <label style="font-size:12px;color:#666;">Hafta:</label>
          <select id="piyasaSheetWeek" style="padding:8px;border:1px solid #ddd;border-radius:10px;min-width:140px;"></select>
          <input id="piyasaSheetSearch" placeholder="Kitap adı ara..." style="flex:1;min-width:220px;padding:10px;border:1px solid #ddd;border-radius:10px;">
          <div style="font-size:12px;color:#666;min-width:120px;text-align:right;" id="piyasaSheetCount"></div>
        </div>
        <div style="padding:0 14px 14px;overflow:auto;flex:1;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
              <tr style="background:#f6f6f6;position:sticky;top:0;z-index:1;">
                <th style="text-align:left;padding:8px;border:1px solid #eee;">Seç</th>
                <th style="text-align:left;padding:8px;border:1px solid #eee;">KİTAP (SHEET)</th>
                <th style="text-align:left;padding:8px;border:1px solid #eee;">HAFTA</th>
                <th style="text-align:left;padding:8px;border:1px solid #eee;">SİPARİŞ</th>
                <th style="text-align:left;padding:8px;border:1px solid #eee;">SIRA</th>
              </tr>
            </thead>
            <tbody id="piyasaSheetTbody"></tbody>
          </table>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:10px;padding:12px 14px;border-top:1px solid #eee;">
          <button id="piyasaSheetCancel" style="border:0;background:#eee;border-radius:10px;padding:10px 12px;cursor:pointer;">İptal</button>
          <button id="piyasaSheetOk" disabled style="border:0;background:#111827;color:#fff;border-radius:10px;padding:10px 12px;cursor:pointer;opacity:.6;">Tamam</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const close = ()=> overlay.remove();
    overlay.querySelector('#piyasaSheetModalClose').onclick = close;
    overlay.querySelector('#piyasaSheetCancel').onclick = close;
    overlay.onclick = (e)=>{ if(e.target===overlay) close(); };

    const weekSel = overlay.querySelector('#piyasaSheetWeek');
    const searchEl = overlay.querySelector('#piyasaSheetSearch');
    const tbody = overlay.querySelector('#piyasaSheetTbody');
    const countEl = overlay.querySelector('#piyasaSheetCount');
    const okBtn = overlay.querySelector('#piyasaSheetOk');

    weeks.forEach(w=>{
      const opt = document.createElement('option');
      opt.value = String(w);
      opt.textContent = `${w}. HAFTA`;
      weekSel.appendChild(opt);
    });
    if (defaultWeek !== null) weekSel.value = String(defaultWeek);

    // Varsayılan sheet: o haftada parantezsiz "X.HAFTA" varsa o, yoksa en sağdaki (orderIndex en büyük)
    function defaultPickForWeek(w){
      const list = metas.filter(m=>m.week===w);
      const exactName = `${w}.HAFTA`;
      const exact = list.find(m => String(m.name||'').trim().toUpperCase() === exactName);
      if (exact) return exact.name;
      let best = list[0]?.name || '';
      let bestIdx = -1;
      for (const m of list){
        if (m.orderIndex > bestIdx){ bestIdx = m.orderIndex; best = m.name; }
      }
      return best;
    }

    let selectedName = '';
    function setSelected(name){
      selectedName = name || '';
      okBtn.disabled = !selectedName;
      okBtn.style.opacity = selectedName ? '1' : '.6';
      // radio işaretlerini güncelle
      tbody.querySelectorAll('input[type="radio"]').forEach(r=>{
        r.checked = (r.value === selectedName);
      });
    }

    function render(){
      const w = parseInt(weekSel.value, 10);
      const q = String(searchEl.value||'').trim().toLowerCase();
      let list = metas.filter(m=>m.week===w);
      if (q) list = list.filter(m => String(m.name||'').toLowerCase().includes(q));
      // Önce sipariş sayısına göre, eşitse en sağdaki önce
      list.sort((a,b)=> (b.count - a.count) || (b.orderIndex - a.orderIndex));
      countEl.textContent = `${list.length} kitap`;
      tbody.innerHTML = list.map(m=>`
        <tr>
          <td style="padding:8px;border:1px solid #eee;">
            <input type="radio" name="piyasaSheetRadio" value="${escapeHtml(m.name)}" style="transform:scale(1.1);">
          </td>
          <td style="padding:8px;border:1px solid #eee;">${escapeHtml(m.name)}</td>
          <td style="padding:8px;border:1px solid #eee;">${m.week}. hafta</td>
          <td style="padding:8px;border:1px solid #eee;">${m.approx ? ('~' + m.count) : m.count}</td>
          <td style="padding:8px;border:1px solid #eee;">${m.orderIndex+1}</td>
        </tr>
      `).join('');

      // olaylar
      tbody.querySelectorAll('tr').forEach(tr=>{
        tr.style.cursor = 'pointer';
        tr.onclick = ()=>{
          const radio = tr.querySelector('input[type="radio"]');
          if (radio){
            radio.checked = true;
            setSelected(radio.value);
          }
        };
      });

      // eğer bu hafta için seçili sheet yoksa default seç
      if (!selectedName || !list.find(x=>x.name===selectedName)){
        const def = defaultPickForWeek(w);
        setSelected(def);
      }
    }

    weekSel.onchange = ()=>{ selectedName=''; render(); };
    searchEl.oninput = ()=> render();

    okBtn.onclick = ()=>{
      if (!selectedName) return;
      const w = parseInt(weekSel.value, 10);
      const chosen = metas.find(m=>m.name===selectedName);
      if (!chosen){
        alert('❌ Seçilen kitap bulunamadı.');
        return;
      }
      close();
      onConfirm({ sheetName: chosen.name, week: w });
    };

    render();
    setTimeout(()=> searchEl.focus(), 0);
  }

  function applyOrderToForm(o){
    const firmaKodu = document.getElementById('firmaKodu');
    const firmaSelect = document.getElementById('firmaSelect');
    const malzeme = document.getElementById('malzeme');
    const malzemeSelect = document.getElementById('malzemeSelect');
    const ambalaj = document.getElementById('ambalajBilgisi');
    const notu = document.getElementById('yuklemeNotu');
    const sevk = document.getElementById('sevkYeri');
    const tonaj = document.getElementById('tonaj');

    // Değerleri bas
    // Firma/Müşteri Kodu: hem input'u doldur hem de select içinde eşleşen varsa seç.
    const firmaVal = (o.firma || '').trim();
    if (firmaKodu) firmaKodu.value = firmaVal;
    let firmaOptMatched = false;
    if (firmaSelect) {
      const opt = Array.from(firmaSelect.options || []).find(x => (x.value||'').trim() === firmaVal);
      if (opt) {
        firmaSelect.value = opt.value;
        firmaOptMatched = true;
      }
    }
    if (malzeme) malzeme.value = o.malzeme || '';
    if (malzemeSelect) {
      // seçenek eşleşirse select'i de işaretle
      const target = (o.malzeme || '').trim();
      const opt = Array.from(malzemeSelect.options || []).find(x => (x.value||'').trim() === target);
      malzemeSelect.value = opt ? opt.value : '';
    }
    if (ambalaj) ambalaj.value = o.yuklemeTuru || '';
    if (notu) notu.value = o.aciklama || '';
    if (sevk) sevk.value = o.il || '';
    if (tonaj) tonaj.value = o.miktar || '';

    // Listener'ları tetikle
    const els = [firmaKodu, malzeme, malzemeSelect, ambalaj, notu, sevk, tonaj];
    if (firmaOptMatched) els.unshift(firmaSelect);
    els.forEach(el=>{
      if (!el) return;
      try {
        el.dispatchEvent(new Event('input', { bubbles:true }));
        el.dispatchEvent(new Event('change', { bubbles:true }));
      } catch(_) {}
    });

    // Bazı akışlarda select change input'u temizleyebiliyor; en son tekrar basıyoruz.
    if (firmaKodu) firmaKodu.value = firmaVal;
  }


  function openOrderPicker(){
    if (!state.orders || state.orders.length === 0){
      alert('❌ PİYASA Excel yüklü değil ya da sipariş yok.');
      return;
    }

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;';
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:14px;max-width:1000px;width:100%;max-height:82vh;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,.25);display:flex;flex-direction:column;">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #eee;gap:12px;">
          <div style="font-weight:900;">Piyasa Sipariş Seç</div>
          <div style="font-size:12px;color:#666;">${state.sheet ? `Sheet: <b>${escapeHtml(state.sheet)}</b>` : ''}</div>
          <button id="piyasaModalClose" style="border:0;background:#eee;border-radius:10px;padding:6px 10px;cursor:pointer;">Kapat</button>
        </div>
        <div style="padding:10px 14px;display:flex;gap:10px;align-items:center;border-bottom:1px solid #eee;">
          <input id="piyasaSearch" placeholder="Firma / Malzeme / İl / Açıklama ara..." style="flex:1;padding:10px;border:1px solid #ddd;border-radius:10px;">
          <div style="font-size:12px;color:#666;min-width:120px;text-align:right;" id="piyasaCount"></div>
        </div>
        <div style="padding:0 14px 14px;overflow:auto;flex:1;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
              <tr style="background:#f6f6f6;position:sticky;top:0;z-index:1;">
                <th style="text-align:left;padding:8px;border:1px solid #eee;">#</th>
                <th style="text-align:left;padding:8px;border:1px solid #eee;">FİRMA</th>
                <th style="text-align:left;padding:8px;border:1px solid #eee;">MALZEME</th>
                <th style="text-align:left;padding:8px;border:1px solid #eee;">YÜKLEME TÜRÜ</th>
                <th style="text-align:left;padding:8px;border:1px solid #eee;">İL</th>
                <th style="text-align:left;padding:8px;border:1px solid #eee;">MİKTAR</th>
                <th style="text-align:left;padding:8px;border:1px solid #eee;">SEÇ</th>
              </tr>
            </thead>
            <tbody id="piyasaTbody"></tbody>
          </table>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const close = ()=> overlay.remove();
    overlay.querySelector('#piyasaModalClose').onclick = close;
    overlay.onclick = (e)=>{ if(e.target===overlay) close(); };

    const tbody = overlay.querySelector('#piyasaTbody');
    const countEl = overlay.querySelector('#piyasaCount');
    const searchEl = overlay.querySelector('#piyasaSearch');

    function rowHtml(o){
      return `
        <tr>
          <td style="padding:8px;border:1px solid #eee;">${o.__idx}</td>
          <td style="padding:8px;border:1px solid #eee;">${escapeHtml(o.firma||'')}</td>
          <td style="padding:8px;border:1px solid #eee;">${escapeHtml(o.malzeme||'')}</td>
          <td style="padding:8px;border:1px solid #eee;">${escapeHtml(o.yuklemeTuru||'')}</td>
          <td style="padding:8px;border:1px solid #eee;">${escapeHtml(o.il||'')}</td>
          <td style="padding:8px;border:1px solid #eee;">${escapeHtml(String(o.miktar||''))}</td>
          <td style="padding:8px;border:1px solid #eee;">
            <button data-idx="${o.__idx}" style="cursor:pointer;border:0;background:#111827;color:#fff;border-radius:10px;padding:6px 10px;">Seç</button>
          </td>
        </tr>
      `;
    }

    function render(filter){
      const f = String(filter||'').trim().toLowerCase();
      const rows = state.orders.filter(o=>{
        const hay = `${o.firma} ${o.malzeme} ${o.il} ${o.yuklemeTuru} ${o.aciklama} ${o.miktar}`.toLowerCase();
        return !f || hay.includes(f);
      });
      countEl.textContent = `${rows.length} sipariş`;
      tbody.innerHTML = rows.map(rowHtml).join('');
      tbody.querySelectorAll('button[data-idx]').forEach(btn=>{
        btn.onclick = ()=>{
          const idx = parseInt(btn.getAttribute('data-idx'), 10);
          const selected = state.orders.find(x=>x.__idx===idx);
          if (selected){
            applyOrderToForm(selected);
            close();
          }
        };
      });
    }

    searchEl.oninput = ()=> render(searchEl.value);
    setTimeout(()=> searchEl.focus(), 0);
    render('');
  }

  function escapeHtml(s){
    return String(s||'')
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'","&#039;");
  }

  async function loadPiyasaExcel(file){
    if (!file){
      alert('❌ Dosya seçilemedi.');
      return;
    }
    if (!window.XLSX){
      alert('❌ XLSX kütüphanesi yüklenmemiş.');
      return;
    }
    const ab = await file.arrayBuffer();
    const wb = XLSX.read(ab, {
      type: 'array',
      cellStyles: false,
      cellNF: false,
      cellText: false,
      dense: true
    });

    const metas = getSheetMetaForPicker(wb);
    if (!metas.length){
      alert('❌ Bu dosyada HAFTA sheet’i bulamadım (ör: 21.HAFTA).');
      return;
    }

    // Kullanıcıya kitap seçtir (week + sheet)
    openSheetPickerModal(metas, ({sheetName, week})=>{
      try{
        const ws = wb.Sheets[sheetName];
        const rawRows = parseSheetSmart(ws);
        const orders = normalizeRows(rawRows);

        state.orders = orders;
        state.week = week;
        state.sheet = sheetName;
        state.loadedAt = new Date();

        if (state.orders && state.orders.length) saveState();

        toast(`✅ Piyasa yüklendi: ${sheetName} • ${week}. hafta • ${state.orders.length} sipariş`, 'success');
        try { window.Report?.addEvent('EXCEL_PIYASA_LOADED', { sheet: sheetName, week, count: (state.orders||[]).length }); } catch(e) {}

        if (!state.orders.length){
          alert('⚠️ Seçilen kitapta sipariş bulunamadı. (Filtre kuralları nedeniyle bazı satırlar atılmış olabilir.)');
          return;
        }
        openOrderPicker();
      }catch(e){
        console.error('Piyasa load failed', e);
        alert('❌ Seçilen kitabı okurken hata oluştu.');
      }
    });
  }

  function clearPiyasa(){
    state.orders = [];
    state.week = null;
    state.sheet = null;
    state.loadedAt = null;
    clearSavedState();
    // GIRIS.html üstteki “Excel durumu” alanını anında güncelle
    try { window.refreshHeaderExcelInfo && window.refreshHeaderExcelInfo(); } catch(e) {}
    toast('🗑️ Piyasa verisi temizlendi.', 'info');
    try { window.Report?.addEvent('EXCEL_PIYASA_CLEARED', {}); } catch(e) {}
  }

  function bind(){
    const uploadBtn = document.getElementById('piyasaExcelUploadButtonTop');
    const clearBtn = document.getElementById('piyasaExcelClearButtonTop');

    // Menü butonları
    if (uploadBtn && !uploadBtn.__piyasaBound){
      uploadBtn.__piyasaBound = true;
      uploadBtn.addEventListener('click', ()=>{
        const inp = ensureHiddenFileInput('piyasaExcelInputHidden');
        inp.onchange = ()=> {
          const f = inp.files && inp.files[0];
          inp.value = '';
          loadPiyasaExcel(f);
        };
        // Safari vb. için güvenli click
        try { inp.showPicker ? inp.showPicker() : inp.click(); } catch(e){ inp.click(); }
      });
    }

    if (clearBtn && !clearBtn.__piyasaBound){
      clearBtn.__piyasaBound = true;
      clearBtn.addEventListener('click', ()=>{
        if (!state.orders.length){
          toast('ℹ️ Piyasa verisi zaten boş.', 'info');
          return;
        }
        if (confirm('Piyasa verisini silmek istiyor musun?')){
          clearPiyasa();
        }
      });
    }

    // "Bul" butonunu PİYASA modunda sipariş seçtirir yap
    const firmaAraBtn = document.getElementById('firmaAraBtn');
    if (firmaAraBtn && !firmaAraBtn.__piyasaHijacked){
      firmaAraBtn.__piyasaHijacked = true;
      firmaAraBtn.addEventListener('click', (e)=>{
        if (state.orders && state.orders.length){
          e.preventDefault();
          e.stopImmediatePropagation();
          openOrderPicker();
        }
      }, true); // capture: önce biz
    }

    const malzemeAraBtn = document.getElementById('malzemeAraBtn');
    if (malzemeAraBtn && !malzemeAraBtn.__piyasaHijacked){
      malzemeAraBtn.__piyasaHijacked = true;
      malzemeAraBtn.addEventListener('click', (e)=>{
        if (state.orders && state.orders.length){
          e.preventDefault();
          e.stopImmediatePropagation();
          openOrderPicker();
        }
      }, true);
    }
  }

  // init: UI render edildikten sonra butonlar geliyor, o yüzden kısa süre poll.
  function init(){
    // Sayfa yenilense bile piyasa verisini geri al
    const restored = loadState();
    if (restored){
      toast(`✅ Piyasa verisi geri yüklendi (${state.orders.length} satır)`, 'success');
      // Sayfa yenilendiğinde de header bilgisi doğru görünsün
      try { window.refreshHeaderExcelInfo && window.refreshHeaderExcelInfo(); } catch(e) {}
    }

    let tries = 0;
    const t = setInterval(()=>{
      tries++;
      bind();
      if (document.getElementById('piyasaExcelUploadButtonTop') || tries > 80){
        // 80 * 250ms = 20s
        if (tries > 80) console.warn('Piyasa init: butonlar bulunamadı (timeout).');
        clearInterval(t);
      }
    }, 250);
  }

  
  // Dışarıya minimal API aç (app.js Bul butonu buradan çağıracak)
  window.piyasa = window.piyasa || {};
  window.piyasa.hasOrders = ()=> (state.orders && state.orders.length > 0);
  window.piyasa.openOrderPicker = openOrderPicker;
  window.piyasa.applyOrderToForm = applyOrderToForm;
  window.piyasa._state = state;

window.initPiyasaModule = init;
  document.addEventListener('DOMContentLoaded', init);
})();
