// report.js
(function(){
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

  async function render(){
    const vehicles = await (async ()=>{
      try { const r = await fetch('/api/vehicles'); if (r.ok) return await r.json(); } catch(e) {}
      return (window.storage && window.storage.loadAll) ? (window.storage.loadAll() || []) : [];
    })();

    const events = await getEvents();

    const dailyMeta = await getDailyMeta();
    const dailyCnt = await getDailyCount();
    const piyasa = await getPiyasaState();

    // KPI
    const k = calcKpis(vehicles, events);
    document.getElementById('kpiTotal').textContent = String(k.totalPrintedVehicles);
    document.getElementById('kpiPrinted').textContent = String(k.totalPrints);
    document.getElementById('kpiPrint24').textContent = String(k.print24);

    // Excel info
    const ihr = dailyMeta && dailyMeta.fileName ? `${dailyMeta.fileName} • ${dailyCnt} kayıt` : (dailyCnt ? `${dailyCnt} kayıt` : '-');
    document.getElementById('excelIhracatInfo').textContent = `📄 İHRACAT Excel: ${ihr}`;

    const piy = (piyasa && piyasa.sheet) ? `${piyasa.sheet}${piyasa.week ? ' • ' + piyasa.week + '. hafta' : ''} • ${(piyasa.orders||[]).length || 0} satır` : '-';
    document.getElementById('excelPiyasaInfo').textContent = `🧾 PİYASA Excel: ${piy}`;

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

    // sort: lastPrinted desc then kayitTarihi
    rows.sort((a,b)=>{
      const ap = (a.lastPrintedAt||0);
      const bp = (b.lastPrintedAt||0);
      if (bp !== ap) return bp - ap;
      return String(b.kayitTarihi||'').localeCompare(String(a.kayitTarihi||''));
    });

    const tbody = document.getElementById('tbody');
    tbody.innerHTML = '';

    const excelCell = `<div class="text-xs text-gray-600">
      <div>📄 ${ihr}</div>
      <div>🧾 ${piy}</div>
    </div>`;

    for (const v of rows){
      const pc = (parseInt(v.printCount||'0',10)||0);
      const printed = pc > 0;
      const tr = document.createElement('tr');

      const plate = (v.cekiciPlaka || '').toString();
      const kayit = (v.kayitTarihi || '-').toString();

      tr.innerHTML = `
        <td class="p-3 font-semibold">${plate || '-'}</td>
        <td class="p-3">${kayit}</td>
        <td class="p-3">${excelCell}</td>
        <td class="p-3">${printed ? `✅ (${pc})` : '—'}</td>
        <td class="p-3">${printed ? fmtDate(v.lastPrintedAt) : '-'}</td>
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
          localStorage.setItem('pending_reprint_vehicleId', String(id));
          // ana sayfayı aç
          window.open('GIRIS.html', '_blank');
        }catch(e){
          alert('❌ Tekrar yazdırma isteği kaydedilemedi.');
        }
      });
    });
  }

  function bind(){
    document.getElementById('refreshBtn').addEventListener('click', render);
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
                  const nv = { ...v, printCount: 0, lastPrintedAt: 0 };
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
    sel.addEventListener('change', render);
  }

    bind();
    render();
})();
