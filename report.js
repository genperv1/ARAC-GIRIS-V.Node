// report.js
(function(){
  // Cleanup legacy localStorage keys that may feed the reports UI
  try {
    try { localStorage.removeItem('report_events_v1'); } catch(e) {}
    try { localStorage.removeItem('pending_reprint_vehicleId'); } catch(e) {}
    try { localStorage.removeItem('soforHistoryByPlaka'); } catch(e) {}
    // remove any vehicle_* keys
    try {
      const toRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i) || '';
        if (k.startsWith('vehicle_')) toRemove.push(k);
      }
      toRemove.forEach(k => { try { localStorage.removeItem(k); } catch(e){} });
    } catch(e) {}
  } catch(e) {}
  function fmtDate(ts){
    try{
      if (!ts) return '-';
      const d = new Date(ts);
      if (isNaN(d.getTime())) return '-';
      return d.toLocaleString('tr-TR');
    }catch(e){ return '-'; }
  }

  async function getDailyMeta(){
    try{ const r = await fetch('/api/kv/daily_shipments_meta'); if (r.ok) return await r.json(); }catch(e){}
    return {};
  }
  async function getDailyCount(){
    try{ const r = await fetch('/api/kv/daily_shipments_current'); if (r.ok) { const a = await r.json(); return Array.isArray(a) ? a.length : 0; } }catch(e){}
    return 0;
  }
  async function getPiyasaState(){
    try{ const r = await fetch('/api/piyasa'); if (r.ok) return await r.json(); }catch(e){}
    return {};
  }
  async function getEvents(){
    try{ const r = await fetch('/api/reports'); if (r.ok) return await r.json(); }catch(e){}
    return [];
  }

  function normPlate(s){
    return String(s||'').toLowerCase().replace(/[\s-]+/g,'');
  }

  function calcKpis(vehicles, events){
    const printedVehicles = vehicles.filter(v => (parseInt(v.printCount||'0',10)||0) > 0);
    const totalPrintedVehicles = printedVehicles.length;
    const totalPrints = printedVehicles.reduce((acc,v)=> acc + (parseInt(v.printCount||'0',10)||0), 0);
    const now = Date.now();
    const day = 24*60*60*1000;
    const print24 = events.filter(ev => ev && ev.type === 'PRINT' && (now - (ev.ts||0)) <= day).length;
    return { totalPrintedVehicles, totalPrints, print24 };
  }

  // shift filter state: 'all' | 'day' | 'night'
  if (!window.__shiftFilter) window.__shiftFilter = 'all';

  function timeStrToMinutes(s){
    try{
      if (!s) return null;
      // accept formats like HH:MM or HH:MM:SS or localized 'hh:mm:ss'
      const m = String(s||'').trim().match(/(\d{1,2}):([0-5]\d)(?::([0-5]\d))?/);
      if (!m) return null;
      const hh = parseInt(m[1],10);
      const mm = parseInt(m[2],10);
      return hh*60 + mm;
    }catch(e){return null;}
  }

  function isInShiftMinutes(mins, shift){
    if (mins === null) return false;
    if (shift === 'day') return mins >= (8*60) && mins < (18*60);
    if (shift === 'night') return mins >= 0 && mins < (8*60);
    return true;
  }

  async function render(){
    // Load events from reports endpoint and build a vehicles list from PRINT events
    const events = await getEvents();
    // Aggregate PRINT events into vehicle-like objects so UI can display per-vehicle rows
    const vmap = {};
    try{
      (events || []).filter(ev => ev && ev.type === 'PRINT').forEach(ev => {
        try{
          const d = ev.data || {};
          const plate = (d.plaka || '').toString();
          const id = d.vehicleId ? String(d.vehicleId) : ('pl_' + (normPlate(plate) || ev.id));
          const key = id;
          const cur = vmap[key] || { id, cekiciPlaka: plate, printCount: 0, lastPrintSnapshot: null, defaultFirma: '', kayitTarihi: '' };
          cur.printCount = (cur.printCount || 0) + 1;
          if (!cur.lastPrintSnapshot || (ev.ts && Number(ev.ts) > Number(cur.lastPrintSnapshot.ts || 0))) {
            cur.lastPrintSnapshot = { ts: ev.ts, ...d };
            cur.defaultFirma = d.firma || d.firmaKodu || d.firmaSelect || cur.defaultFirma;
          }
          vmap[key] = cur;
        }catch(e){}
      });
    }catch(e){}
    const vehicles = Object.values(vmap);

    const dailyMeta = await getDailyMeta();
    const dailyCnt = await getDailyCount();
    const piyasa = await getPiyasaState();

    // KPI
    const k = calcKpis(vehicles, events);


    // filters
    const q = normPlate(document.getElementById('plateSearch').value || '');
    const mode = 'printed';
    try{ const fs=document.getElementById('filterSelect'); if(fs){ fs.value='printed'; fs.disabled=true; } }catch(e){}

    let rows = vehicles.slice();
    if (q){
      rows = rows.filter(v => normPlate(v.cekiciPlaka || '').includes(q));
    }
    if (mode === 'printed'){
      rows = rows.filter(v => (parseInt(v.printCount||'0',10)||0) > 0);
    } else if (mode === 'notprinted'){
      rows = rows.filter(v => (parseInt(v.printCount||'0',10)||0) === 0);
    }

    // sort: last print timestamp desc (use lastPrintSnapshot.ts) then kayitTarihi
    rows.sort((a,b)=>{
      const ap = (a.lastPrintSnapshot && a.lastPrintSnapshot.ts) ? Number(a.lastPrintSnapshot.ts) : 0;
      const bp = (b.lastPrintSnapshot && b.lastPrintSnapshot.ts) ? Number(b.lastPrintSnapshot.ts) : 0;
      if (bp !== ap) return bp - ap;
      return String(b.kayitTarihi||'').localeCompare(String(a.kayitTarihi||''));
    });

    const tbody = document.getElementById('tbody');
    tbody.innerHTML = '';


    function findLastPrintEvent(vehicle){
      try{
        const plateNorm = normPlate(vehicle.cekiciPlaka || '');
        // events is in outer scope
        const evs = (events || []).filter(ev => ev && ev.type === 'PRINT' && ev.data);
        const matched = evs.filter(ev => {
          try{
            const d = ev.data || {};
            if (d.vehicleId && String(d.vehicleId) === String(vehicle.id)) return true;
            if (d.plaka && normPlate(d.plaka || '') === plateNorm) return true;
          }catch(e){}
          return false;
        });
        if (!matched.length) return null;
        matched.sort((a,b)=>Number(b.ts||0) - Number(a.ts||0));
        return matched[0];
      }catch(e){return null;}
    }

    // Apply shift filter (after we can locate last print events)
    try{
      const sf = window.__shiftFilter || 'all';
      if (sf && sf !== 'all') {
        rows = rows.filter(v => {
          try{
            const le = findLastPrintEvent(v);
            let timeStr = (le && le.data && (le.data.saat || le.saat)) || '';
            if (!timeStr && le && le.ts) timeStr = new Date(Number(le.ts)).toLocaleTimeString('tr-TR');
            const mins = timeStrToMinutes(timeStr);
            return isInShiftMinutes(mins, sf);
          }catch(e){ return false; }
        });
      }
    }catch(e){}

    for (const v of rows){
      const pc = (parseInt(v.printCount||'0',10)||0);
      const printed = pc > 0;
      const tr = document.createElement('tr');

      const plate = (v.cekiciPlaka || '').toString();

      // find last PRINT event for this vehicle
      const lastEv = findLastPrintEvent(v);
      let lastPrintHtml = '-';
      let ts = (lastEv && lastEv.ts) || (v.lastPrintSnapshot && v.lastPrintSnapshot.ts) || null;
      let d = (lastEv && lastEv.data) ? lastEv.data : {};
      let saat = d.saat || (ts ? new Date(Number(ts)).toLocaleTimeString('tr-TR') : '');
      if (printed || lastEv) {
        const kantar = d.kantar || '';
        const malz = d.malzeme || '';
        const sevk = d.sevkYeri || '';
        lastPrintHtml = `
          <div style="font-size:12px;opacity:.85">${kantar ? ' • 👤 ' + kantar : ''}</div>
          <div style="font-size:12px;opacity:.85">${malz ? '📦 ' + malz : ''} ${sevk ? ' • 📍 ' + sevk : ''}</div>
        `;
      }

      tr.innerHTML = `
        <td class="p-3 font-semibold">${plate || '-'}</td>
        <td class="p-3">${( (lastEv && (lastEv.data && (lastEv.data.firma || lastEv.data.firmaKodu || lastEv.data.firmaSelect))) || v.defaultFirma ) ? (lastEv && lastEv.data && (lastEv.data.firma || lastEv.data.firmaKodu || lastEv.data.firmaSelect) || v.defaultFirma) : '-'}</td>
        <td class="p-3">${(function(){
            const dateStr = (d && d.tarih) ? (d.tarih || '-') : (ts ? (new Date(Number(ts)).toLocaleDateString('tr-TR')) : '-');
            const timeStr = (d && d.saat) ? d.saat : (lastEv && lastEv.saat) ? lastEv.saat : (ts ? new Date(Number(ts)).toLocaleTimeString('tr-TR') : '');
            return '<div style="font-weight:700">' + (dateStr || '-') + '</div>' + (timeStr ? ('<div style="font-size:12px;opacity:.85">' + timeStr + '</div>') : '');
          })()}</td>
        <td class="p-3">${lastPrintHtml}</td>
        <td class="p-3">
          <button class="reprintBtn bg-indigo-600 text-white px-3 py-2 rounded-lg hover:bg-indigo-700 transition text-xs"
            data-id="${String(v.id||'')}">
            🖨️ Tekrar Yazdır
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    }

    // bind reprint
    tbody.querySelectorAll('.reprintBtn').forEach(btn => {
      if (btn.__bound) return;
      btn.__bound = true;
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id') || '';
        if (!id) return;
        try{
          // pending reprint persistence removed; open main page without storing
          window.open('GIRIS.html', '_blank');
        }catch(e){
          alert('❌ Tekrar yazdırma isteği başarısız.');
        }
      });
    });
  }

  function bind(){
    const allBtn = document.getElementById('allShiftsBtn');
    if (allBtn) {
      allBtn.addEventListener('click', () => {
        window.__shiftFilter = 'all';
        updateShiftButtonStyles();
        render();
      });
    }
    document.getElementById('backBtn').addEventListener('click', () => { try { location.href = 'GIRIS.html'; } catch(e){} });

    const clearBtn = document.getElementById('clearReportsBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        const ok = confirm('🧹 Rapor kayıtları (yazdırma geçmişi) temizlenecek.\nAraç kayıtları silinmez. Devam edilsin mi?');
        if (!ok) return;
        try {
          // 1) Clear server-side reports
          try { await fetch('/api/reports', { method: 'DELETE' }); } catch(e){}

          // 2) Reset print flags on all vehicles on server
          try {
            const r = await fetch('/api/vehicles');
            if (r.ok) {
              const arr = await r.json();
              for (const v of (Array.isArray(arr)?arr:[])){
                try {
                  const nv = { ...v, printCount: 0, lastPrintSnapshot: null };
                  await fetch('/api/vehicles/' + encodeURIComponent(String(v.id||'')), {
                    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(nv)
                  });
                } catch(e){}
              }
            }
          } catch(e){}

          alert('✅ Raporlar temizlendi.');
          render();
        } catch(e) {
          alert('❌ Temizleme işlemi başarısız.');
        }
      });
    }

    const plate = document.getElementById('plateSearch');
    const sel = document.getElementById('filterSelect');
    plate.addEventListener('input', () => { window.clearTimeout(window.__rdeb); window.__rdeb = window.setTimeout(render, 120); });

    // shift filter buttons
    const dayBtn = document.getElementById('dayShiftBtn');
    const nightBtn = document.getElementById('nightShiftBtn');
    function updateShiftButtonStyles(){
      const sf = window.__shiftFilter || 'all';
      if (allBtn) {
        allBtn.classList.toggle('ring-2', sf === 'all');
        allBtn.classList.toggle('ring-green-500', sf === 'all');
      }
      if (dayBtn) {
        dayBtn.classList.toggle('ring-2', sf === 'day');
        dayBtn.classList.toggle('ring-yellow-400', sf === 'day');
      }
      if (nightBtn) {
        nightBtn.classList.toggle('ring-2', sf === 'night');
        nightBtn.classList.toggle('ring-slate-700', sf === 'night');
      }
    }

    if (dayBtn) {
      dayBtn.addEventListener('click', () => {
        window.__shiftFilter = (window.__shiftFilter === 'day') ? 'all' : 'day';
        updateShiftButtonStyles();
        render();
      });
    }
    if (nightBtn) {
      nightBtn.addEventListener('click', () => {
        window.__shiftFilter = (window.__shiftFilter === 'night') ? 'all' : 'night';
        updateShiftButtonStyles();
        render();
      });
    }
    // initialize styles
    updateShiftButtonStyles();
  }

    bind();
    render();
})();
