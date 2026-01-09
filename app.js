
// === Safe event binding (prevents duplicate handlers when re-rendering)
const __safeBindMap = new WeakMap();
function safeBind(el, eventName, handler, options){
  try {
    if (!el || !eventName || !handler) return;
    let map = __safeBindMap.get(el);
    if (!map) { map = {}; __safeBindMap.set(el, map); }
    const prev = map[eventName];
    if (prev) {
      try { el.removeEventListener(eventName, prev, options); } catch (e) { try { el.removeEventListener(eventName, prev); } catch(_e){} }
    }
    el.addEventListener(eventName, handler, options);
    map[eventName] = handler;
  } catch (e) {
    // fail silently
  }
}


// Alias for legacy calls (used in some handlers)
function addOnce(el, eventName, handler, options){
  return safeBind(el, eventName, handler, options);
}



// =========================
// 📊 Raporlama / Olay Akışı (Log) - Çalışan sistemi BOZMADAN ek katman
// - Yazdır / Excel yükle / Excel sil gibi aksiyonları kayıt altına alır
// - LocalStorage: report_events_v1
// =========================
(function(){
  const KEY = 'report_events_v1';
  const MAX = 2000;
  // in-memory cache for synchronous reads
  let _cache = [];

  function _readLocal(){
    try{
      const raw = localStorage.getItem(KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    }catch(e){ return []; }
  }
  function _writeLocal(arr){
    try{ localStorage.setItem(KEY, JSON.stringify(arr)); return true; }catch(e){ return false; }
  }

  // initialize: load local immediately, then try to refresh from server
  (function initReports(){
    _cache = _readLocal().slice(0, MAX);
    // fetch from server and merge
    try{
      fetch('/api/reports').then(r => r.ok ? r.json() : Promise.resolve([])).then(remote => {
        if (!Array.isArray(remote)) return;
        // remote items are newest first; merge preserving uniqueness by id
        const map = {};
        const merged = [];
        (remote || []).forEach(it => { if (it && it.id) { map[it.id] = it; merged.push(it); } });
        (_cache || []).forEach(it => { if (it && it.id && !map[it.id]) { merged.push(it); map[it.id] = it; } });
        _cache = (merged || []).slice(0, MAX);
        try { _writeLocal(_cache); } catch(e){}
      }).catch(()=>{});
    }catch(e){}
  })();

  function add(type, data){
    try{
      const ev = {
        id: 'EV' + Date.now().toString(36) + Math.random().toString(16).slice(2),
        type: String(type || 'INFO'),
        ts: Date.now(),
        iso: new Date().toISOString(),
        userId: (localStorage.getItem('currentUserId') || ''),
        data: (data && typeof data === 'object') ? data : { value: data }
      };
      _cache.unshift(ev);
      if (_cache.length > MAX) _cache.length = MAX;
      // persist local fallback
      try { _writeLocal(_cache); } catch(e){}
      // fire-and-forget to server
      try { fetch('/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ev) }).catch(()=>{}); } catch(e){}
      return ev;
    }catch(e){ return null; }
  }

  function list(){
    return _cache.slice();
  }

  function clear(){
    try{ _cache = []; _writeLocal([]); try { fetch('/api/reports', { method: 'DELETE' }).catch(()=>{}); } catch(e){}; return true; }catch(e){ return false; }
  }

  // Global API (rapor.html ve uygulama içi kullanır)
  window.Report = window.Report || {};
  window.Report.addEvent = add;
  window.Report.getEvents = list;
  window.Report.clearEvents = clear;
  window.Report.KEY = KEY;
})();

// app.js - GİRİŞ.html içinden ayrıldı
// Giriş kontrolü (çoklu kullanıcı + hash)
let isLoggedIn = false;
let isEnteringApp = false; // çift giriş tetiklenmesini engeller

// 🖥️ Kiosk modu (tam ekran + büyük yazı) - başlangıçta uygula
try {
  if (localStorage.getItem('kiosk_mode_v1') === '1') {
    document.body && document.body.classList.add('kiosk-mode');
  }
} catch (e) {}


// ⚠️ Not: Bu offline çalışan (sunucusuz) bir sistem. Bu yüzden gerçek güvenlik için backend gerekir.
// Yine de şifreyi düz yazı tutmamak için SHA-256 + salt kullanıyoruz.
const AUTH_SALT = "collabiq_salt_v1";
const USERS = [
  { id: "GENPER", passHash: "b47f62fb2692177aa12dc99be4ace000825f2c6a72818242f69791645bd658c0", passPlain: "BB123", role: "admin" },
  // örnek: { id: "KANTAR1", passHash: "SHA256_HASH", role: "user" }
];

// Malzeme listesi
        let malzemeListesi = [
            "HP 0.074-0.30",
            "HP 0.074-0.60",
            "HP 0.15-0.30",
            "HP 0.15-0.40",
            "HP 0.15-0.60",
            "HP 0.30-0.50",
            "HP 0.30-0.85",
            "HP 0.60-1.20",
            "HP 1.20-2.40",
            "HP 1.20-2.80",
            "HP 1.60-4.00"
        ];

        // Firma listesi - başlangıç değerleri
        let firmaListesi = [
            "HP3 / BOZÜYÜK",
            "HP3 / MERSİN",
            "HP3 / GÖLBAŞI",
            "HP3 / SİVAS / İKİNCİ EL BBT",
            "HP8 / ANKARA",
            "HP11 / ANKARA",
            "HP77 / AKSARAY",
            "HP7  / ANKARA",
            "HP2  / GEBZE",
            "HP2  / ANKARA/BALA/SİLOBAS",
            "HP2 / ANKARA",
            "HP2  / TURGUTLU-MANİSA",
            "HP22  / ANKARA",
            "HP9 / ESKİŞEHİR",
            "HP5 /İSTANBUL"
        ];

        // Eşleştirme listesi
        let eslestirmeListesi = [];

        // 🔗 Eşleştirme kaldırıldı: eski kayıtlar varsa temizle
        try { localStorage.removeItem('eslestirmeListesi'); } catch(e) {}
        try { localStorage.removeItem('firmaOverrides_v1'); } catch(e) {}
        try { eslestirmeListesi = []; } catch(e) {}

        // Ana uygulama state
        let state = {
            vehicles: [],
            searchTerm: '',
            quickPlateTerm: '',
            showForm: false,
            editingId: null,
            listLimit: 6,
            showAll: false,  
			pageSize: 20,
			visibleCount: 20,
			lastTotal: 0,
            
            formData: {
                cekiciPlaka: '',
                dorsePlaka: '',
                soforAdi: '',
                soforSoyadi: '',
                sofor2Adi: '',
                sofor2Soyadi: '',
                iletisim: '',
                tcKimlik: '',
                defaultFirma: '',
                defaultMalzeme: '',
                defaultSevkYeri: '',
                defaultYuklemeNotu: ''
            }
        };

        // TC Kimlik kontrolü
        function isValidTC(tc) {
            if (!tc) return true;
            return /^\d{11}$/.test(tc);
        }

        // İletişim numarası kontrolü
        function isValidIletisim(iletisim) {
            if (!iletisim) return true;
            const cleaned = iletisim.replace(/\D/g, '');
            return cleaned.length === 10 || cleaned.length === 11;
        }

        // Plaka kontrol fonksiyonu
        function isPlateExists(cekiciPlaka, excludeId = null) {
            const needle = String(cekiciPlaka || '').toLowerCase().trim();
            if (!needle) return false;

            return state.vehicles.some(vehicle => {
                const hay = String(vehicle?.cekiciPlaka || '').toLowerCase().trim();
                return vehicle?.id !== excludeId && hay && hay === needle;
            });
        }

        // Çakışan plakaları otomatik temizleme (✅ Artık silmez, sadece raporlar)
        // - Aynı plaka iki farklı kişi/araç kaydında bulunabilir.
        // - Login / Excel okuma tarafına dokunmaz.
        function cleanDuplicatePlates() {
    const duplicates = [];
    const seen = {};
    const vehiclesToKeep = [];

    (state.vehicles || []).forEach(vehicle => {
        const plate = String(vehicle?.cekiciPlaka || '').toLowerCase().trim();

        // Bozuk / eksik kayıt (plaka yok) -> saklama alanından da temizle
        if (!plate) {
            if (vehicle?.id) storage.delete(`vehicle_${vehicle.id}`);
            return;
        }

        // ✅ Bu plaka için şoför bilgilerini geçmişe ekle (çok şoför / tek plaka)
        try {
          const pKey = String(vehicle?.cekiciPlaka || '').trim();
          const n = ((vehicle?.soforAdi || '') + ' ' + (vehicle?.soforSoyadi || '')).trim();
          soforHistoryStorage.add(pKey, {
            name: n,
            tc: String(vehicle?.tcKimlik || '').trim(),
            phone: formatTRPhone(String(vehicle?.iletisim || '').trim())
          });
        } catch (e) {}

        // Duplicates: sadece raporla, silme
        if (seen[plate]) duplicates.push(vehicle.cekiciPlaka);
        else seen[plate] = true;

        vehiclesToKeep.push(vehicle);
    });

    state.vehicles = vehiclesToKeep;

    return duplicates.length;
}

// Eşleştirme yönetimi fonksiyonları
        const eslestirmeStorage = {
  save() {
    localStorage.setItem('eslestirmeListesi', JSON.stringify(eslestirmeListesi));
  },

  load() {
    const data = localStorage.getItem('eslestirmeListesi');
    if (!data) return;

    try {
      const parsed = JSON.parse(data);

      // ✅ Eski formatı (firma, malzeme) yeni formata migrate et
      eslestirmeListesi = (Array.isArray(parsed) ? parsed : [])
        .map((e) => {
          if (e && typeof e === 'object') {
            // yeni format
            if (e.id && 'ambalajBilgisi' in e && 'yuklemeNotu' in e) return e;

            // eski format (id yok)
            return {
              id: e.id || (Date.now().toString() + Math.random().toString(16).slice(2)),
              firma: e.firma || '',
              malzeme: e.malzeme || '',
              ambalajBilgisi: e.ambalajBilgisi || '',
              yuklemeNotu: e.yuklemeNotu || '',
              sevkYeri: e.sevkYeri || ''
            };
          }
          return null;
        })
        .filter(Boolean);

      // Eşleştirmelerden yeni firmaları/malzemeleri listelere ekle
      eslestirmeListesi.forEach(es => {
        if (es.firma && !firmaListesi.includes(es.firma)) firmaListesi.push(es.firma);
        if (es.malzeme && !malzemeListesi.includes(es.malzeme)) malzemeListesi.push(es.malzeme);
      });

      firmaStorage.save();
      try { localStorage.removeItem('malzemeListesi'); } catch(e) {}
// ✅ artık this çalışır
      this.save();
    } catch (e) {
      // bozuk json olursa sıfırlama
      eslestirmeListesi = [];
      this.save();
    }
  },

  // ✅ aynı firma + aynı malzeme varsa ekleme (ama aynı firma için farklı malzeme eklenebilir!)
  add(firma, malzeme, ambalajBilgisi = '', yuklemeNotu = '', sevkYeri = '') {
    if (eslestirmeListesi.some(es => es.firma === firma && es.malzeme === malzeme)) return false;

    if (!firmaListesi.includes(firma)) {
      firmaListesi.unshift(firma);
      firmaStorage.save();
    }

    if (!malzemeListesi.includes(malzeme)) {
      malzemeListesi.unshift(malzeme);
      try { localStorage.removeItem('malzemeListesi'); } catch(e) {}
}

    eslestirmeListesi.unshift({
      id: Date.now().toString() + Math.random().toString(16).slice(2),
      firma,
      malzeme,
      ambalajBilgisi,
      yuklemeNotu,
      sevkYeri
    });

    this.save();
    return true;
  },

  update(id, yeniData) {
    const idx = eslestirmeListesi.findIndex(es => es.id === id);
    if (idx === -1) return false;

    const target = eslestirmeListesi[idx];
    const newFirma = (yeniData.firma ?? target.firma);
    const newMalzeme = (yeniData.malzeme ?? target.malzeme);

    const conflict = eslestirmeListesi.some(es =>
      es.id !== id && es.firma === newFirma && es.malzeme === newMalzeme
    );
    if (conflict) return false;

    eslestirmeListesi[idx] = {
      ...target,
      ...yeniData,
      firma: newFirma,
      malzeme: newMalzeme
    };

    this.save();
    return true;
  },

  delete(id) {
    const idx = eslestirmeListesi.findIndex(es => es.id === id);
    if (idx === -1) return false;

    eslestirmeListesi.splice(idx, 1);
    this.save();
    return true;
  },

  // ✅ artık tek malzeme değil, firmaya ait TÜM eşleştirmeleri döndür
  // ✅ Firma eşleştirmesi normalize: Türkçe karakter/boşluk farklarında da bulsun (HP3 GÖLBAŞI vs HP3 GOLBASI)
  getByFirma(firma) {
    const norm = (s) => String(s || '')
      .toUpperCase()
      .replace(/İ/g,'I')
      .replace(/Ş/g,'S')
      .replace(/Ğ/g,'G')
      .replace(/Ü/g,'U')
      .replace(/Ö/g,'O')
      .replace(/Ç/g,'C')
      .replace(/[\s\-_/]+/g,' ')
      .trim();

    const key = norm(firma);
    return eslestirmeListesi.filter(es => norm(es?.firma) === key);
  }
};


		// Firma yönetimi fonksiyonları
        const firmaStorage = {
            save: () => {
                // ❌ Firma listesi kalıcı tutulmayacak
                try { localStorage.removeItem('firmaListesi'); } catch(e) {}
            },
            load: () => {
                // ❌ Firma listesi localStorage'dan okunmayacak
                try { localStorage.removeItem('firmaListesi'); } catch(e) {}
                firmaListesi = Array.isArray(firmaListesi) ? firmaListesi : [];
            },
            
            add: (firma) => {
                // Aynı firma zaten varsa ekleme
                if (firmaListesi.includes(firma)) {
                    return false;
                }
                
                // Yeni firmayı en üste ekle
                firmaListesi.unshift(firma);
                firmaStorage.save();
                return true;
            },
            update: (index, yeniFirma) => {
                if (index >= 0 && index < firmaListesi.length) {
                    firmaListesi[index] = yeniFirma;
                    firmaStorage.save();
                    return true;
                }
                return false;
            },
            delete: (index) => {
                if (index >= 0 && index < firmaListesi.length) {
                    firmaListesi.splice(index, 1);
                    firmaStorage.save();
                    return true;
                }
                return false;
            }
        };


        // Malzeme yönetimi fonksiyonları
        // Not: malzemeListesi, localStorage'da "malzemeListesi" altında tutulur.
        const malzemeStorage = {
            save: () => {
                // ❌ Malzeme listesi kalıcı tutulmayacak
                try { localStorage.removeItem('malzemeListesi'); } catch(e) {}
            },
            load: () => {
                // ❌ Malzeme listesi localStorage'dan okunmayacak
                try { localStorage.removeItem('malzemeListesi'); } catch(e) {}
                malzemeListesi = Array.isArray(malzemeListesi) ? malzemeListesi : [];
            },
            
            add: (malzeme) => {
                const m = String(malzeme || '').trim();
                if (!m) return false;
                if (malzemeListesi.includes(m)) return false;
                malzemeListesi.unshift(m);
                malzemeStorage.save();
                return true;
            },
            update: (index, yeniMalzeme) => {
                const m = String(yeniMalzeme || '').trim();
                if (!m) return false;
                if (index >= 0 && index < malzemeListesi.length) {
                    // aynı isim varsa engelle
                    if (malzemeListesi.some((x, i) => i !== index && String(x).trim() === m)) return false;
                    malzemeListesi[index] = m;
                    malzemeStorage.save();
                    return true;
                }
                return false;
            },
            delete: (index) => {
                if (index >= 0 && index < malzemeListesi.length) {
                    malzemeListesi.splice(index, 1);
                    malzemeStorage.save();
                    return true;
                }
                return false;
            }
        };

                // Veri depolama fonksiyonları (storage.js)
        const storage = window.storage;


// ✅ Son kullanılanlar (akıllı hafıza) - localStorage
const RECENT_KEYS = {
  firmalar: 'recent_firmalar',
  malzemeler: 'recent_malzemeler',
  sevkYerleri: 'recent_sevk_yerleri'
};

// ❌ İSTENMEYEN LİSTELER: sistemde tutulmasın, yedekte taşınmasın
const DISABLED_STORAGE_KEYS = [
  'firmaListesi','malzemeListesi',
  'firmalar','malzemeler',
  'recent_firmalar','recent_malzemeler','recent_sevk_yerleri'
];

function purgeDisabledKeys() {
  try {
    DISABLED_STORAGE_KEYS.forEach(k => { try { localStorage.removeItem(k); } catch(e) {} });
  } catch (e) {}
}

// Sayfa açılır açılmaz temizle
try { purgeDisabledKeys(); } catch(e) {}


function _readRecent(key) {
  try {
    if (typeof DISABLED_STORAGE_KEYS !== 'undefined' && DISABLED_STORAGE_KEYS.includes(key)) return [];
    const arr = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(arr) ? arr.filter(Boolean) : [];
  } catch (e) { return []; }
}

function _writeRecent(key, arr) {
  try {
    if (typeof DISABLED_STORAGE_KEYS !== 'undefined' && DISABLED_STORAGE_KEYS.includes(key)) return;
    localStorage.setItem(key, JSON.stringify((Array.isArray(arr) ? arr : []).slice(0, 50)));
  } catch (e) {}
}

function pushRecent(key, value) {
  const v = String(value || '').trim();
  if (!v) return;
  const arr = _readRecent(key);
  const next = [v, ...arr.filter(x => String(x).trim() !== v)];
  _writeRecent(key, next);
}

function fillDatalist(datalistId, values) {
  const dl = document.getElementById(datalistId);
  if (!dl) return;
  dl.innerHTML = (values || []).slice(0, 8).map(v => `<option value="${String(v).replace(/"/g, '&quot;')}"></option>`).join('');
}

// ✅ Hafıza / cache temizliği (eşleştirmeleri silmez)
function clearRecentCaches() {
  try {
    Object.values(RECENT_KEYS).forEach(k => {
      try { localStorage.removeItem(k); } catch (e) {}
    });

    // Bazı eski sürümlerde kalmış olabilecek yardımcı cache anahtarları
    const legacyKeys = [
      'recentFirmalar',
      'recentMalzemeler',
      'recentSevkYerleri',
      'lastFirmaKodu',
      'lastMalzeme',
      'lastSevkYeri'
    ];
    legacyKeys.forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });

    // UI tarafında datalist'leri de sıfırla
    try { fillDatalist('recentFirmalar', []); } catch (e) {}
    try { fillDatalist('recentMalzemeler', []); } catch (e) {}
    try { fillDatalist('recentSevkYerleri', []); } catch (e) {}

    return true;
  } catch (e) {
    return false;
  }
}


// =========================
// ✅ Plaka -> Şoför Geçmişi (çok şoför / tek plaka)
// - Excel okuma ve login akışına dokunmaz.
// - Takip Formu'nda şoför bilgileri değişirse burada saklanır.
// =========================
const SOFOR_HISTORY_KEY = 'soforHistoryByPlaka';

const soforHistoryStorage = {
  load() {
    try {
      const raw = localStorage.getItem(SOFOR_HISTORY_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (e) {
      return {};
    }
  },
  save(map) {
    try { localStorage.setItem(SOFOR_HISTORY_KEY, JSON.stringify(map || {})); } catch (e) {}
  },
  _key(plate) {
    return String(plate || '').toUpperCase().replace(/\s+/g,'').trim();
  },
  list(plate) {
    const k = this._key(plate);
    const map = this.load();
    const arr = map[k];
    return Array.isArray(arr) ? arr.filter(Boolean) : [];
  },
  add(plate, driver) {
    const k = this._key(plate);
    if (!k) return;
    const d = driver || {};
    const name = String(d.name || '').trim();
    const tc = String(d.tc || '').trim();
    const tel = String(d.phone || '').trim();
    if (!name && !tc && !tel) return;

    const map = this.load();
    const arr = Array.isArray(map[k]) ? map[k].filter(Boolean) : [];

    // aynı kayıt tekrar gelirse başa al
    const same = (x) => {
      if (!x) return false;
      const xName = String(x.name || '').trim();
      const xTc = String(x.tc || '').trim();
      const xTel = String(x.phone || '').trim();
      if (tc && xTc && tc === xTc) return true;
      if (name && xName && tel && xTel) return (name === xName && tel === xTel);
      return name && xName && (name === xName);
    };

    const cleaned = arr.filter(x => !same(x));
    const next = [{
      name,
      tc,
      phone: tel,
      updatedAt: Date.now()
    }, ...cleaned].slice(0, 12);

    map[k] = next;
    this.save(map);
  }
};


// ✅ Firma kodu normalize: "HP8 / İstanbul" -> "HP8"
function getFirmaKodOnly(firmaStr) {
  try { return String(firmaStr || '').split('/')[0].trim(); }
  catch (e) { return String(firmaStr || '').trim(); }
}

// =========================
// 📄 Günlük Excel Sevkiyat Import (offline uyumlu)
// - XLSX kütüphanesi: https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js
// - Login'e dokunmaz, sadece ana ekranda butonlarla çalışır.
// =========================
function _nz(v) {
  if (v == null) return '';
  const s = String(v).trim();
  if (!s) return '';
  // 0 / 0,0 / 0.0 gibi değerleri boş say
  const norm = s.replace(',', '.');
  if (norm === '0' || norm === '0.0' || norm === '0.00') return '';
  return s;
}

const DAILY_SHIPMENT_KEY = 'daily_shipments_current';

// ✅ Firma bazlı düzeltme hafızası (özellikle Sevk Yeri / Liman)
const FIRMA_OVERRIDE_KEY = 'firmaOverrides_v1';
function _normFirmaKey(f){
  return String(f || '').trim().toUpperCase();
}
function loadFirmaOverrides(){
  try{
    const obj = JSON.parse(localStorage.getItem(FIRMA_OVERRIDE_KEY) || '{}');
    return (obj && typeof obj === 'object') ? obj : {};
  }catch(e){ return {}; }
}
function saveFirmaOverrides(map){
  try{ localStorage.setItem(FIRMA_OVERRIDE_KEY, JSON.stringify(map || {})); return true; }catch(e){ return false; }
}
function getFirmaOverride(firma){
  const key = _normFirmaKey(firma);
  if (!key) return null;
  const map = loadFirmaOverrides();
  return map[key] || null;
}
function setFirmaOverride(firma, patch){
  const key = _normFirmaKey(firma);
  if (!key) return false;
  const map = loadFirmaOverrides();
  const cur = (map[key] && typeof map[key] === 'object') ? map[key] : {};
  map[key] = { ...cur, ...(patch || {}), updatedAt: new Date().toISOString() };
  return saveFirmaOverrides(map);
}
function applyFirmaOverridesToShipment(sh){
  // 🔒 Excel yüklüyken (veya genel kullanımda) local override kapalı.
  // Excel ne getiriyorsa o geçerli olacak; localStorage'dan düzeltme okunmaz.
  return sh;
}

const DAILY_SHIPMENT_META = 'daily_shipments_meta';

// TR plaka normalize (eşleştirme için) -> "43ADD516" == "43 ADD 516"
function normPlate(v) {
  return formatTRPlate(String(v || '')).replace(/\s+/g, ' ').trim();
}

function _todayKeyTR() {
  try {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    return `${yyyy}-${mm}-${dd}`;
  } catch(e){ return 'unknown'; }
}

function findShipmentHeaderText(grid, rowIdx) {
  // ✅ En yakın header'ı al (yanlış sevkiyat bloğundan seçim yapmayı engeller)
  // Header satırı genelde '/' içerir ve NET ... KG veya BOOKING/GEMİ gibi işaretler taşır.
  const start = Math.max(0, rowIdx - 25);

  for (let r = rowIdx; r >= start; r--) {
    const row = grid[r] || [];
    const maxC = Math.min(row.length, 80);

    for (let c = 0; c < maxC; c++) {
      const v = row[c];
      if (v === null || v === undefined || v === '') continue;

      const s = String(v).trim();
      if (!s.includes('/')) continue;

      if (
        /NET\s*\d+\s*KG/i.test(s) ||
        /BOOKING\s*NO/i.test(s) ||
        /GEM[İI]\s*DETAYI/i.test(s)
      ) {
        return s;
      }
    }
  }
  return '';
}


function saveDailyShipments(rows, meta) {
  try {
    // ✅ Yeni katman: DailyStore (memory + IndexedDB). Yoksa localStorage fallback.
    if (window.DailyStore && typeof DailyStore.set === 'function') {
      DailyStore.set(rows || [], meta || {});
      return true;
    }
    localStorage.setItem(DAILY_SHIPMENT_KEY, JSON.stringify(rows || []));
    localStorage.setItem(DAILY_SHIPMENT_META, JSON.stringify(meta || {}));
    return true;
  } catch(e){ return false; }
}

function loadDailyShipments() {
  try {
    if (window.DailyStore && typeof DailyStore.getRows === 'function') {
      return DailyStore.getRows() || [];
    }
    const rows = JSON.parse(localStorage.getItem(DAILY_SHIPMENT_KEY) || '[]');
    return Array.isArray(rows) ? rows : [];
  } catch(e){ return []; }
}

function hasDailyExcelLoaded(){
  try { return (loadDailyShipments() || []).length > 0; }
  catch(e){ return false; }
}

function loadDailyMeta() {
  try {
    if (window.DailyStore && typeof DailyStore.getMeta === 'function') {
      return DailyStore.getMeta() || {};
    }
    return JSON.parse(localStorage.getItem(DAILY_SHIPMENT_META) || '{}') || {};
  } catch(e){ return {}; }
}

function clearDailyShipments() {
  try {
    if (window.DailyStore && typeof DailyStore.clear === 'function') {
      DailyStore.clear();
      return true;
    }
    localStorage.removeItem(DAILY_SHIPMENT_KEY);
    localStorage.removeItem(DAILY_SHIPMENT_META);
    return true;
  } catch(e){ return false; }
}

// Header (Hızlı Giriş altı) Excel durum yazıları için ortak formatter
function _getExcelStatusInfo(){
  const out = {
    ihrCount: 0,
    ihrLine: '-',
    piyCount: 0,
    piyLine: '-',
  };

  // İHRACAT
  try {
    const meta = (typeof loadDailyMeta === 'function') ? (loadDailyMeta() || {}) : {};
    const cnt  = (typeof loadDailyShipments === 'function') ? ((loadDailyShipments() || []).length || 0) : 0;
    out.ihrCount = cnt;
    if (meta && meta.fileName) out.ihrLine = `${meta.fileName} • ${cnt} kayıt`;
    else if (cnt) out.ihrLine = `${cnt} kayıt`;
  } catch(e) {}

  // PİYASA
  try {
    const raw = localStorage.getItem('piyasa_state_v1');
    if (raw) {
      const piy = JSON.parse(raw) || {};
      const cnt = Array.isArray(piy.orders) ? piy.orders.length : 0;
      out.piyCount = cnt;
      if (piy && piy.sheet) out.piyLine = `${piy.sheet}${piy.week ? ' • ' + piy.week + '. hafta' : ''} • ${cnt} satır`;
      else if (cnt) out.piyLine = `${cnt} satır`;
    }
  } catch(e) {}

  return out;
}

// PİYASA modülü gibi dış modüller Excel yükleyince, header'daki yazıları anında güncellemek için
function refreshHeaderExcelInfo(){
  try {
    const info = _getExcelStatusInfo();

    // chips
    const chipIhr = document.getElementById('chipIhracat');
    const chipIhrText = document.getElementById('chipIhracatText');
    if (chipIhr) {
      chipIhr.classList.remove('chip-ok','chip-warn');
      chipIhr.classList.add(info.ihrCount > 0 ? 'chip-ok' : 'chip-warn');
    }
    if (chipIhrText) chipIhrText.textContent = info.ihrCount > 0 ? `Yüklü (${info.ihrCount})` : 'Boş';

    const chipPiy = document.getElementById('chipPiyasa');
    const chipPiyText = document.getElementById('chipPiyasaText');
    if (chipPiy) {
      chipPiy.classList.remove('chip-ok','chip-warn');
      chipPiy.classList.add(info.piyCount > 0 ? 'chip-ok' : 'chip-warn');
    }
    if (chipPiyText) chipPiyText.textContent = info.piyCount > 0 ? `Yüklü (${info.piyCount})` : 'Boş';

    // detail lines
    const ihrLineWrap = document.getElementById('quickIhracatInfoLine');
    const ihrLineText = document.getElementById('quickIhracatInfoText');
    if (ihrLineWrap) ihrLineWrap.title = info.ihrLine;
    if (ihrLineText) ihrLineText.textContent = info.ihrLine;

    const piyLineWrap = document.getElementById('quickPiyasaInfoLine');
    const piyLineText = document.getElementById('quickPiyasaInfoText');
    if (piyLineWrap) piyLineWrap.title = info.piyLine;
    if (piyLineText) piyLineText.textContent = info.piyLine;
  } catch(e) {}
}

// dışarı aç
try { window.refreshHeaderExcelInfo = refreshHeaderExcelInfo; } catch(e) {}

function purgeStrictExcelCaches(){
  // Excel yüklendiğinde: Excel dışındaki local veriler (eşleştirme/override/liste önbelleği) tamamen kapalı.
  const keys = [
    'eslestirmeListesi',
    'firmaListesi',
    'malzemeListesi',
    'recent_sevk_yerleri',
    'recent_firmalar',
    'recent_malzemeler',
    'firmaOverrides_v1'
  ];
  try {
    keys.forEach(k => { try { localStorage.removeItem(k); } catch(e){} });
  } catch(e){}
}

function rebuildListsFromExcelRows(rows){
  try{
    const r = Array.isArray(rows) ? rows : [];
    const firms = new Set();
    const mats = new Set();

    for (const x of r){
      const f = String(x?.firma || '').trim();
      if (f) firms.add(getFirmaKodOnly(f));
      const m = String(x?.malzeme || '').trim();
      if (m) mats.add(m);
    }

    // ✅ Excel yüklüyken seçenekleri sadece Excel'den üret
    firmaListesi = Array.from(firms).filter(Boolean).sort();
    malzemeListesi = Array.from(mats).filter(Boolean).sort();

    // UI açık ise select'leri güncelle
    const firmaSel = document.getElementById('firmaSelect');
    if (firmaSel) {
      const cur = firmaSel.value;
      firmaSel.innerHTML = '<option value="">Seçiniz veya elle yazın</option>' +
        firmaListesi.map(f => `<option value="${f}">${f}</option>`).join('');
      if (cur) firmaSel.value = cur;
    }

    const malSel = document.getElementById('malzemeSelect');
    if (malSel) {
      const curM = malSel.value;
      malSel.innerHTML = '<option value="">Seçiniz veya elle yazın</option>' +
        malzemeListesi.map(m => `<option value="${m}">${m}</option>`).join('');
      if (curM) malSel.value = curM;
    }
  }catch(e){}
}
// Ambalaj metnini header satırından yakala (NET'li/NET'siz, 1 veya 2 ambalaj):
// Örn: "NET 25 KG ... NET 1200 KG ..." -> "NET 25 KG ... + NET 1200 KG ..."
// Örn: "1250 KG'LIK ... BIGBAGLER"     -> "NET 1250 KG ... BIGBAGLER"
function extractAmbalajFromHeader(headerText) {
  const raw = String(headerText || '')
    .replace(/\./g, '')       // 1.250 -> 1250
    .replace(/'/g, '')         // KG'LIK -> KGLIK
    .replace(/\s+/g, ' ')
    .toUpperCase()
    .trim();

  const parts = raw.split('/').map(p => p.trim()).filter(Boolean);
  const results = [];

  for (const part of parts) {
    // 1) NET 25 KG / NET 1200 KG (aynı segmentte birden fazla olabilir)
    const netMatches = [...part.matchAll(/\bNET\s*([0-9]{1,5})\s*KG\b([^\/]*)/gi)];
    for (const m of netMatches) {
      const kg = parseInt(m[1], 10);
      let text = `NET ${kg} KG ${m[2] || ''}`;
      text = cleanAmbalajText(text);
      if (text) results.push({ kg, text });
    }

    // 2) NET yok ama "1250 KG'LIK ... BIGBAG/ÇUVAL" gibi
    const nonNetMatches = [...part.matchAll(/\b([0-9]{1,5})\s*KG(LIK)?\b([^\/]*)/gi)];
    for (const m of nonNetMatches) {
      const kg = parseInt(m[1], 10);
      const rest = String(m[3] || '').trim();

      // Ambalaj anahtar kelimesi yoksa alma (HP 0,074-0,30 gibi alanları ele)
      if (!/(BIGBAG|BIG BAG|BİGBAG|CUVAL|ÇUVAL|PALET|BBT)/i.test(rest)) continue;

      let text = `NET ${kg} KG ${rest}`;
      text = cleanAmbalajText(text);
      if (text) results.push({ kg, text });
    }
  }

  if (!results.length) return '';

  // Tekrarları temizle
  const uniq = [];
  const seen = new Set();
  for (const r of results) {
    const key = String(r.text || '').toUpperCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    uniq.push(r);
  }

  // Küçükten büyüğe: 25 KG + 1200/1250 KG
  uniq.sort((a, b) => (a.kg || 0) - (b.kg || 0));

  return uniq.map(x => x.text).join(' + ');
}

function cleanAmbalajText(text) {
  return String(text || '')
    // sevkiyat sonrası alanları buda
    .replace(/\bBOOKING\b.*$/i, '')
    .replace(/\bGEM[İI]\b.*$/i, '')
    .replace(/\bGEMI\b.*$/i, '')
    .replace(/\bEXPORT\b.*$/i, '')
    .replace(/\bTON\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}


// ✅ Aday üretimi: Ambalaj (NET'li + NET'siz KG'LIK) -> seçenek listesi
function getAmbalajCandidates(headerText){
  const raw = String(headerText || '')
    .replace(/\./g,'')
    .replace(/'/g,'')
    .replace(/\s+/g,' ')
    .toUpperCase()
    .trim();

  const parts = raw.split('/').map(p=>p.trim()).filter(Boolean);
  const out = [];

  for (const part of parts) {
    // NET xxx KG ... (aynı segmentte birden fazla)
    for (const m of part.matchAll(/\bNET\s*([0-9]{1,5})\s*KG\b([^\/]*)/gi)) {
      const kg = parseInt(m[1],10);
      let t = `NET ${kg} KG ${m[2]||''}`;
      t = cleanAmbalajText(t);
      if (t) out.push({kg, text:t});
    }
    // NET yok ama 1250 KG'LIK ...
    for (const m of part.matchAll(/\b([0-9]{1,5})\s*KG(LIK)?\b([^\/]*)/gi)) {
      const kg = parseInt(m[1],10);
      const rest = String(m[3]||'').trim();
      if (!/(BIGBAG|BIG BAG|BİGBAG|ÇUVAL|CUVAL|TORBA|JUMBO|SACK|BAG|PALET|BBT)/i.test(rest)) continue;
      let t = `NET ${kg} KG ${rest}`;
      t = cleanAmbalajText(t);
      if (t) out.push({kg, text:t});
    }
  }

  // uniq + küçükten büyüğe
  const seen = new Set();
  const uniq = [];
  for (const x of out) {
    const k = x.text;
    if (!k || seen.has(k)) continue;
    seen.add(k);
    uniq.push(x);
  }
  uniq.sort((a,b)=> (a.kg||0)-(b.kg||0));
  return uniq.map(x=>x.text);
}

// ✅ Aday üretimi: Liman / Sevk Yeri (çoğunlukla son segment + bilinen isimler)
function getLimanCandidates(headerText){
  const s = String(headerText || '').replace(/\s+/g,' ').trim();
  if (!s) return [];
  const parts = s.split('/').map(p=>p.trim()).filter(Boolean);

  // Bilinen liman/terminal kelimeleri (gerekirse buraya ekleyebilirsin)
  const known = [
    'DP WORLD','EVYAP','GEMPORT','SAFIPORT','MARDAS','MARDAŞ','MARPORT','ASYA PORT','ASYA PORTS',
    'KUMPORT','KUMPORT LİMANI','KUMPORT LIMANI','LIMAŞ','LIMAS','LİMAŞ','ALSANCAK','HAYDARPASA','HAYDARPAŞA',
    'GEMLIK','GEMLİK','YILPORT','YILPORT GEMLIK','AKDENIZ PORT','AKDENİZ PORT',
    'KORFEZ','KÖRFEZ','MEDLOG','KORFEZ MEDLOG','KÖRFEZ MEDLOG','DEPO','TERMINAL','TERMİNAL','LIMAN','LİMAN','PORT'
  ];

  const skipRe = /(GEM[İI]\s*DETAYI|BOOKING\s*NO|LOT\s*NO|HP\s*\d|TON\b|BBT\b|PALET\b|ÇUVAL\b|CUVAL\b|NET\s*\d+\s*KG)/i;

  // Adayları topla: son segmentlere daha fazla ağırlık veriyoruz
  const candidates = [];
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i];
    if (!seg) continue;
    if (skipRe.test(seg)) continue;

    // Bilinen kelime içeriyorsa güçlü aday
    const upper = seg.toUpperCase();

    let score = 0;
    for (const k of known) {
      if (upper.includes(k)) { score += 3; break; }
    }

    // sonlara yakınsa bonus
    const distFromEnd = (parts.length - 1) - i;
    if (distFromEnd <= 1) score += 2;
    if (distFromEnd <= 3) score += 1;

    // Liman/terminal/depo gibi sinyaller
    if (/(PORT|LIMAN|LİMAN|TERMINAL|TERMİNAL|DEPO|MEDLOG|KORFEZ|KÖRFEZ)/i.test(seg)) score += 2;

    if (score > 0) candidates.push({ text: seg, score });
  }

  // Sadece text'e indir, tekrarları temizle
  candidates.sort((a,b)=> b.score - a.score);
  const uniq = [];
  const seen = new Set();
  for (const x of candidates) {
    const key = x.text.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(x.text);
  }

  return uniq.slice(0,6); // UI şişmesin
}

// ✅ YD anahtarını normalize et (YD28(G) -> YD28)
function normalizeYdKey(val){
  const s = String(val || '');
  const m = s.match(/\b(YD\d{1,4})\b/i);
  return m ? m[1].toUpperCase() : s.trim().toUpperCase();
}
function findSevkYeriNear(grid, headerRowIdx, headerText) {
  const ht = String(headerText || '').trim();
  if (ht && ht.includes('/')) {
    const parts = ht.split('/').map(p => p.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return '';
}
// Excel okuma (XLSX)
async function importDailyExcel(file) {
  if (!file) return { ok:false, msg:'Dosya seçilmedi.' };
  if (typeof XLSX === 'undefined') {
    return { ok:false, msg:'XLSX kütphanesi yüklenemedi. (xlsx.full.min.js)' };
  }

  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: 'array' });
  const sheetName = wb.SheetNames && wb.SheetNames[0];
  if (!sheetName) return { ok:false, msg:'Excel sayfası bulunamadı.' };
  const ws = wb.Sheets[sheetName];

  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: false });

  const rowsOut = [];

  // SAĞ TABLO:
  // V: SIRANO (index 21)
  // W: PLAKA  (index 22)
  // Y: MALIN CİNSİ (index 24)
  // Z: TONAJ(KG)   (index 25) -> sadece saklanır, forma basılmaz
  // AA: BBT (26), AB: ÇUVAL (27), AC: PALET (28), AD: BOŞ BBT (29)

  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] || [];
    const sirano = String(row[21] || '').toUpperCase().trim();
    const plakaHdr = String(row[22] || '').toUpperCase().trim();
    if (!(sirano === 'SIRANO' && plakaHdr === 'PLAKA')) continue;

    const firma = String(row[0] || '').trim();

    // ✅ Header text'i en sağlam şekilde yakala (NET/BOOKING/GEMİ içeren uzun satır)
    const headerText = findShipmentHeaderText(grid, r) || '';

    const ambalaj = ''; // otomatik ambalaj okuma kapali (manuel / aday secim)
    const sevkYeri = ''; // otomatik sevk yeri okuma kapali (manuel / aday secim)
    const ydKey = (headerText.match(/\b(YD\d{1,4})\b/i)||[])[1] ? (headerText.match(/\b(YD\d{1,4})\b/i)[1].toUpperCase()) : (String(row[0]||'').match(/\b(YD\d{1,4})\b/i)||[])[1]?.toUpperCase() || '';

    for (let rr = r+1; rr < grid.length; rr++) {
      const d = grid[rr] || [];
      const rawA0 = String(d[0] || '').trim();
      const maybeToplam = rawA0.toUpperCase().trim();
      // ✅ Blok sınırı: yeni YD başlığına geldiysek bu sevkiyat bitti
      if (rr > r + 1 && /^YD\d+/i.test(rawA0)) break;
      if (maybeToplam === 'TOPLAM' || maybeToplam === 'KALAN') break;
const plakaRaw = d[22];
      if (!plakaRaw) continue;

      rowsOut.push({
        id: String(d[0] || '').trim(),
        sira: d[21] != null ? String(d[21]).trim() : '',
        plaka: normPlate(plakaRaw),
        ydKey: ydKey,
        headerText: headerText,

        irsaliyeNo: d[23] != null ? String(d[23]).trim() : '',
        malzeme: d[24] != null ? String(d[24]).trim() : '',
        tonajKg: _nz(d[25]),
        bbt: _nz(d[26]),
        cuval: _nz(d[27]),
        palet: _nz(d[28]),
        bosBbt: _nz(d[29]),
        bosCuval: _nz(d[30]),

        firma,
        sevkYeri,
        ambalaj
      });
    }
  }

  // uniq
  const uniq = [];
  const seen = new Set();
  for (const x of rowsOut) {
    const k = `${x.plaka}__${x.id}__${x.sira}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(x);
  }

  const meta = {
    dateKey: _todayKeyTR(),
    sheetName: sheetName,
    fileName: file.name,
    importedAt: new Date().toISOString(),
    count: uniq.length
  };

  const uniq2 = uniq; // 🔒 Excel satırları local override olmadan kaydedilir

  // ✅ 2 Excel yükleme desteği (Excel okuma mantığına dokunmadan):
  // - Mevcut günlük veri varsa, yeni dosya EKLEMEK isteyip istemediğini sorar.
  // - Ekleme yapılırsa plakaya göre birden fazla kayıt oluşabilir; plaka yazınca 1/2 seçimi gelir.
  let rowsToSave = uniq2;
  let metaToSave = meta;

  try {
    const existing = (typeof loadDailyShipments === 'function') ? (loadDailyShipments() || []) : [];
    const existingMeta = (typeof loadDailyMeta === 'function') ? (loadDailyMeta() || {}) : {};

    if (Array.isArray(existing) && existing.length > 0) {
      const doAppend = confirm(
        `Mevcut Excel verisi var: ${existing.length} kayıt.

` +
        `Yeni dosya EKLENSİN mi?
` +
        `• OK  = Ekle (2 Excel aynı anda)
` +
        `• İptal = Değiştir (eskisi silinir)`
      );

      if (doAppend) {
        rowsToSave = existing.concat(uniq2);

        // meta: dosya listesini tut (geriye dönük uyumlu)
        const files = []
          .concat(existingMeta.files || (existingMeta.fileName ? [existingMeta.fileName] : []))
          .concat(file.name || meta.fileName || '')
          .map(s => String(s || '').trim())
          .filter(Boolean);

        // uniq file names
        const seenF = new Set();
        const uniqFiles = [];
        for (const f of files) { if (!seenF.has(f)) { seenF.add(f); uniqFiles.push(f); } }

        metaToSave = {
          ...existingMeta,
          ...meta,
          files: uniqFiles,
          fileName: uniqFiles.join(' + '),
          count: rowsToSave.length,
          appendedAt: new Date().toISOString()
        };
      } else {
        // replace
        rowsToSave = uniq2;
        metaToSave = meta;
      }
    }
  } catch (e) {
    // fail-safe: replace davranışı
    rowsToSave = uniq2;
    metaToSave = meta;
  }

  // ⚠️ Aynı plaka birden fazla kayıtta mı? (Seçim çıkacağını kullanıcıya hatırlat)
  try {
    const counts = new Map();
    for (const r of (rowsToSave || [])) {
      const p = String(r?.plaka || '').trim();
      if (!p) continue;
      counts.set(p, (counts.get(p) || 0) + 1);
    }
    const dupPlates = Array.from(counts.entries()).filter(([,c]) => c > 1);
    if (dupPlates.length && typeof showToast === 'function') {
      showToast(`⚠️ ${dupPlates.length} plaka birden fazla kayıtta var. Plakayı yazınca 1/2 seçim sorulacak.`);
    }
  } catch(e){}

  const ok = saveDailyShipments(rowsToSave, metaToSave);
  if (!ok) return { ok:false, msg:'Kaydetme başarısız (localStorage dolu olabilir).' };

  // 🔒 Excel yüklendi -> Excel dışındaki local verileri tamamen temizle (eşleştirme/override/liste cache)
  purgeStrictExcelCaches();
  // ✅ Dropdown seçeneklerini sadece Excel'den üret
  rebuildListsFromExcelRows(rowsToSave);

  return { ok:true, msg:`✅ Excel yüklendi: ${uniq.length} satır`, meta: metaToSave };
}


/* =========================================================================
   ✅ Sevkiyat BAŞLIK OKUMA + SEÇİM TABLOSU (Sadece başlıklar)
   - Kullanıcı sevkiyatları tekli/çoklu seçer
   - Bu sürümde import YAPMAZ (sadece seçim ekranı gösterir)
   ========================================================================= */

function _safeStr(x){ return (x==null)?'':String(x); }

function _rowToText(row){
  if (!row || !Array.isArray(row)) return '';
  const parts = row.map(v => _safeStr(v).replace(/\s+/g,' ').trim()).filter(Boolean);
  return parts.join(' ').replace(/\s+/g,' ').trim();
}

function _findFirst(regex, text){
  const m = (text || '').match(regex);
  return m ? (m[1] || m[0] || '').trim() : '';
}

function _extractFirmaKod(headerText){
  // YD138(M) -> YD138
  return _findFirst(/\b(YD\d{2,4})\b/i, headerText) || '';
}

// ✅ Firma/YD anahtarı: kullanıcı "YD28(G) ..." yazsa bile "YD28" üretir.
// Autofill ve eşleştirme için her yerde aynı anahtar kullanılmalı.
function _firmaKey(val){
  const s = String(val || '');
  return (_extractFirmaKod(s) || s.trim());
}

function _extractMalzeme(headerText){
  // HP 0,074-0,30 / HP 0.074-0.30
  const m = headerText.match(/\bHP\s*([0-9][0-9\.,]*\s*-\s*[0-9][0-9\.,]*)\b/i);
  if (!m) return '';
  const rng = String(m[1] || '').replace(/\s+/g,'').replace(/\./g,','); // TR format
  return `HP ${rng}`;
}

function _extractSevkYeri(headerText){
  return ''; // otomatik sevk yeri okuma kapali (manuel opsiyonel)
}


function _extractAmbalaj(headerText){
  return ''; // otomatik ambalaj okuma kapali
}


function _extractTotal(headerText, key){
  const t = (headerText || '').replace(/\s+/g,' ').trim().toUpperCase();
  if (key === 'BBT') {
    const m = t.match(/\b([0-9]{1,6})\s*BBT\b/);
    return m ? m[1] : '';
  }
  if (key === 'PALET') {
    const m = t.match(/\b([0-9]{1,6})\s*PALET\b/);
    return m ? m[1] : '';
  }
  if (key === 'ÇUVAL') {
    const m = t.match(/\b([0-9][0-9\.\,]{0,8})\s*ÇUVAL\b/);
    return m ? m[1].replace(/\./g,'').replace(/,/g,'') : '';
  }
  return '';
}

// Grid'den sevkiyat başlıklarını bul (başlık satırı + aralık)
function parseShipmentBlocksFromGrid(grid){
  const headers = [];
  for (let r=0; r<grid.length; r++){
    const rowText = _rowToText(grid[r]);
    if (!rowText) continue;

    // Başlık heuristiği: YDxxx + LOT NO olan satır
    const hasLot = /LOT\s*NO/i.test(rowText);
    const hasFirma = /\bYD\d{2,4}\b/i.test(rowText);
    if (hasLot && hasFirma) {
      headers.push({ r, headerText: rowText });
    }
  }

  // blok aralıklarını belirle
  const blocks = headers.map((h, i) => {
    const startRow = h.r;
    const endRow = (i < headers.length-1) ? (headers[i+1].r - 1) : (grid.length - 1);
    const headerText = h.headerText;

    const blk = {
      id: `B${startRow}_${i+1}`,
      index: i+1,
      startRow,
      endRow,
      headerText,
      firma: _extractFirmaKod(headerText),
      malzeme: _extractMalzeme(headerText),
      sevkYeri: _extractSevkYeri(headerText),
      ambalaj: _extractAmbalaj(headerText),
      totalBBT: _extractTotal(headerText,'BBT'),
      totalPalet: _extractTotal(headerText,'PALET')
    };
    // 🔒 Excel başlık/blok parsing sırasında EŞLEŞTİRME'den otomatik doldurma kapalı.
    // Excel ne getiriyorsa o kullanılacak; local eşleştirme/önbellek karışmasın.

    return blk;
  });

  return blocks;
}

function closeShipmentSelectUI(){
  const el = document.getElementById('shipmentSelectOverlay');
  if (el) el.remove();
}

function showShipmentSelectUI(blocks, fileName){
  closeShipmentSelectUI();

  const overlay = document.createElement('div');
  overlay.id = 'shipmentSelectOverlay';
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 999999;
    background: rgba(0,0,0,.55);
    display: flex; align-items: flex-start; justify-content: center;
    padding: 24px;
  `;

  const card = document.createElement('div');
  card.style.cssText = `
    width: min(1100px, 98vw);
    max-height: 92vh;
    overflow: auto;
    background: #101217;
    color: #fff;
    border: 1px solid rgba(255,255,255,.15);
    border-radius: 16px;
    box-shadow: 0 20px 60px rgba(0,0,0,.5);
    padding: 18px;
  `;

  const title = document.createElement('div');
  title.style.cssText = `display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom: 12px;`;
  title.innerHTML = `
    <div>
      <div style="font-size:18px; font-weight:800;">📌 Excel Sevkiyat Seçimi</div>
      <div style="opacity:.85; margin-top:4px; font-size:13px;">
        Dosya: <b>${_safeStr(fileName||'')}</b> • Bulunan sevkiyat: <b>${blocks.length}</b>
      </div>
      <div style="opacity:.85; margin-top:4px; font-size:12px;">
        Bu ekranda sadece <b>başlık bilgileri</b> gösterilir. (Henüz import yapılmaz.)
      </div>
    </div>
    <button id="shipmentSelectCloseBtn" style="background:#2b2f3a;color:#fff;border:1px solid rgba(255,255,255,.18);padding:10px 14px;border-radius:12px;cursor:pointer;">Kapat</button>
  `;

  const tableWrap = document.createElement('div');
  tableWrap.style.cssText = `margin-top: 10px; border:1px solid rgba(255,255,255,.12); border-radius:12px; overflow:hidden;`;
  const rows = blocks.map((b) => {
    const headerShort = _safeStr(b.headerText).slice(0,160) + (_safeStr(b.headerText).length>160 ? '…' : '');
    return `
      <tr style="border-bottom:1px solid rgba(255,255,255,.08);">
        <td style="padding:10px; text-align:center;"><input type="checkbox" class="shipPick" data-id="${b.id}" /></td>
        <td style="padding:10px; white-space:nowrap;"><b>${b.firma || '-'}</b></td>
        <td style="padding:10px;">${b.malzeme || '-'}</td>
        <td style="padding:10px; white-space:nowrap;">${b.sevkYeri || '-'}</td>
        <td style="padding:10px;">${b.ambalaj || '-'}</td>
        <td style="padding:10px; text-align:center;">${b.totalBBT || '-'}</td>
        <td style="padding:10px; text-align:center;">${b.totalPalet || '-'}</td>
        <td style="padding:10px; font-size:12px; opacity:.85;">${headerShort}</td>
      </tr>
    `;
  }).join('');

  tableWrap.innerHTML = `
    <table style="width:100%; border-collapse:collapse;">
      <thead style="background:rgba(255,255,255,.06);">
        <tr>
          <th style="padding:10px; width:60px;">Seç</th>
          <th style="padding:10px; width:90px;">Firma</th>
          <th style="padding:10px; width:160px;">Malzeme</th>
          <th style="padding:10px; width:120px;">Sevk Yeri</th>
          <th style="padding:10px;">Ambalaj</th>
          <th style="padding:10px; width:70px;">BBT</th>
          <th style="padding:10px; width:70px;">Palet</th>
          <th style="padding:10px; width:260px;">Başlık (kısa)</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  const actions = document.createElement('div');
  actions.style.cssText = `display:flex; gap:10px; align-items:center; justify-content:flex-end; margin-top: 14px; flex-wrap:wrap;`;

  actions.innerHTML = `
    <button id="shipPickAll" style="background:#1f6feb;color:#fff;border:none;padding:10px 14px;border-radius:12px;cursor:pointer;">Hepsini Seç</button>
    <button id="shipClearAll" style="background:#2b2f3a;color:#fff;border:1px solid rgba(255,255,255,.18);padding:10px 14px;border-radius:12px;cursor:pointer;">Temizle</button>
    <button id="shipConfirm" style="background:#7c3aed;color:#fff;border:none;padding:10px 14px;border-radius:12px;cursor:pointer;">Seçimleri Onayla</button>
  `;

  card.appendChild(title);
  card.appendChild(tableWrap);
  card.appendChild(actions);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  // ✅ Aday listelerini doldur (sevk yeri / ambalaj)
  try {
    const ambC = (candidates && Array.isArray(candidates.ambalaj)) ? candidates.ambalaj : [];
    const sevC = (candidates && Array.isArray(candidates.sevkYeri)) ? candidates.sevkYeri : [];

    // ✅ Son kullanılan (YD/Firma) değerlerini aday listesine EKLE,
    // ama mevcut header'dan gelen adaylar varsa otomatik override ETME.
    const origAmbLen = ambC.length;
    const origSevLen = sevC.length;
    try {
      const key = normalizeYdKey(ydKey || chosen?.ydKey || chosen?.firma || '');
      if (key) {
        if (!window.__quickDefaultsByKey) window.__quickDefaultsByKey = {};
        const d = window.__quickDefaultsByKey[key];
        if (d) {
          const da = String(d.ambalaj || '').trim();
          const ds = String(d.sevkYeri || '').trim();
          if (ds && !sevC.map(x=>String(x||'').toUpperCase()).includes(ds.toUpperCase())) sevC.unshift(ds);
          if (da && !ambC.map(x=>String(x||'').toUpperCase()).includes(da.toUpperCase())) ambC.unshift(da);

          // Eğer header'dan HİÇ aday yoksa (yani sadece kullanıcı hafızası var),
          // inputlar boşken otomatik doldur.
          if (origSevLen === 0) {
            const sevInp = card.querySelector('#xr_sevkYeri');
            if (sevInp && !String(sevInp.value||'').trim() && ds) sevInp.value = ds;
          }
          if (origAmbLen === 0) {
            const ambInp = card.querySelector('#xr_ambalaj');
            if (ambInp && !String(ambInp.value||'').trim() && da) ambInp.value = da;
          }
        }
      }
    } catch(e) {}


    const selAmb = card.querySelector('#xr_ambalajCand');
    const selSev = card.querySelector('#xr_sevkYeriCand');

    const addOpts = (sel, arr) => {
      if (!sel) return;
      for (const v of (arr || [])) {
        const opt = document.createElement('option');
        opt.value = String(v || '');
        opt.textContent = String(v || '');
        sel.appendChild(opt);
      }
    };

    addOpts(selSev, sevC);
    addOpts(selAmb, ambC);

    // seçilince inputu doldur
    if (selSev) selSev.addEventListener('change', () => {
      const v = selSev.value || '';
      if (v) {
        const inp = card.querySelector('#xr_sevkYeri');
        if (inp) inp.value = v;
      }
    });
    if (selAmb) selAmb.addEventListener('change', () => {
      const v = selAmb.value || '';
      if (v) {
        const inp = card.querySelector('#xr_ambalaj');
        if (inp) inp.value = v;
      }
    });
  } catch(e){}

  const close = () => closeShipmentSelectUI();
  document.getElementById('shipmentSelectCloseBtn')?.addEventListener('click', close);

  document.getElementById('shipPickAll')?.addEventListener('click', () => {
    overlay.querySelectorAll('input.shipPick').forEach(ch => ch.checked = true);
  });
  document.getElementById('shipClearAll')?.addEventListener('click', () => {
    overlay.querySelectorAll('input.shipPick').forEach(ch => ch.checked = false);
  });

  document.getElementById('shipConfirm')?.addEventListener('click', () => {
    const picks = Array.from(overlay.querySelectorAll('input.shipPick'))
      .filter(ch => ch.checked)
      .map(ch => ch.getAttribute('data-id'));

    if (!picks.length) { alert('Önce en az 1 sevkiyat seçmelisin.'); return; }

    window.__selectedShipmentBlocks = blocks.filter(b => picks.includes(b.id));
    const msg = window.__selectedShipmentBlocks.map(b => `${b.index}) ${b.firma||'-'} | ${b.malzeme||'-'} | ${b.sevkYeri||'-'}`).join('\n');
    alert(`✅ Seçildi (${window.__selectedShipmentBlocks.length}):\n\n${msg}\n\n(Not: Bu sürümde sadece seçim ekranı var. Sonraki adımda bu seçime göre plaka/BBT okunacak.)`);
    close();
  });
}

// Excel oku -> blokları çıkar -> seçim ekranını göster (import yapmaz)
async function importExcelHeadersOnly_ShowSelection(file){
  if (!file) return { ok:false, msg:'Dosya seçilmedi.' };
  if (typeof XLSX === 'undefined') return { ok:false, msg:'XLSX kütüphanesi yüklenemedi. (xlsx.full.min.js)' };

  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: 'array' });
  const sheetName = wb.SheetNames && wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: false });

  const blocks = parseShipmentBlocksFromGrid(grid);

  if (!blocks.length) {
    showShipmentSelectUI([], file.name);
    return { ok:false, msg:'Başlık bulunamadı (LOT NO / YDxxx).', blocks:[] };
  }

  showShipmentSelectUI(blocks, file.name);
  return { ok:true, msg:`✅ Başlıklar bulundu: ${blocks.length} sevkiyat`, blocks };
}


// Takip formu açılınca plaka ile excel satırını uygula

// ✅ Araç varsayılanlarını takip formuna uygula (Excel'e / kullanıcı girdisine dokunmaz)
// - Sadece ilgili alan BOŞSA doldurur.
// - Excel import varsa applyShipmentToTakipForm zaten doldurur; burada tekrar ezmeyiz.
function applyVehicleDefaultsToTakipForm(vehicle) {
  try {
    // 🔒 Günlük Excel yüklüyken araç varsayılanlarından doldurma YAPMA (Excel ile çakışmasın)
    if (hasDailyExcelLoaded()) return;
    if (!vehicle) return;

    const firmaKodu = document.getElementById('firmaKodu');
    const malzeme = document.getElementById('malzeme');
    const malzemeSelect = document.getElementById('malzemeSelect');
    const sevkYeri = document.getElementById('sevkYeri');
    const yuklemeNotu = document.getElementById('yuklemeNotu');

    const df = String(vehicle.defaultFirma || '').trim();
    const dm = String(vehicle.defaultMalzeme || '').trim();
    const ds = String(vehicle.defaultSevkYeri || '').trim();
    const dn = String(vehicle.defaultYuklemeNotu || '').trim();

    // Firma
    if (firmaKodu && !String(firmaKodu.value || '').trim() && df) {
      firmaKodu.value = df;
    }

    // Malzeme
    if (malzeme && !String(malzeme.value || '').trim() && dm) {
      malzeme.value = dm;
    }
    if (malzemeSelect && !String(malzemeSelect.value || '').trim() && dm) {
      // dropdown'da varsa seç, yoksa elle girilen input yeterli
      try {
        const opt = Array.from(malzemeSelect.options || []).find(o => String(o.value||'').trim() === dm);
        if (opt) malzemeSelect.value = dm;
      } catch (e) {}
    }

    // Sevk yeri
    if (sevkYeri && !String(sevkYeri.value || '').trim() && ds) {
      sevkYeri.value = ds;
    }

    // Yükleme notu
    if (yuklemeNotu && !String(yuklemeNotu.value || '').trim() && dn) {
      yuklemeNotu.value = dn;
    }
  } catch(e) {
    console.error('applyVehicleDefaultsToTakipForm hata:', e);
  }
}

function applyShipmentToTakipForm(vehicle) {
  try {
    const plateNeedle = normPlate(vehicle?.cekiciPlaka || '');
    if (!plateNeedle) return;

    // ✅ Hız: plaka->kayıt index (DailyStore) varsa onu kullan
    let hits = [];
    try {
      if (window.DailyStore && typeof DailyStore.findByPlate === 'function') {
        hits = DailyStore.findByPlate(plateNeedle) || [];
      } else {
        const list = loadDailyShipments();
        if (!list.length) return;
        hits = list.filter(x => x.plaka === plateNeedle);
      }
    } catch(e) {
      const list = loadDailyShipments();
      if (!list.length) return;
      hits = list.filter(x => x.plaka === plateNeedle);
    }
    if (!hits.length) return;

    let chosen = hits[0];
    if (hits.length > 1) {
      const label = hits.map((h,i)=> `${i+1}) ${h.id || ''} | Sıra:${h.blockId || ''} | Firma:${h.firma || ''} | Mal:${h.malzeme || ''} | Sevk:${h.sevkYeri || ''}`).join('\n');
      const ans = prompt(`Bu plakaya ait ${hits.length} kayıt var. Seç (1-${hits.length}):\n\n${label}\n\n(İptal = 1. kayıt)`);
      const idx = parseInt(ans || '1', 10);
      if (Number.isFinite(idx) && idx >= 1 && idx <= hits.length) chosen = hits[idx-1];
    }

    
    // ✅ Firma bazlı override (örn: Liman/Sevk Yeri düzeltmesi)
    chosen = applyFirmaOverridesToShipment(chosen);

    // ✅ Not: Ambalaj/Sevk Yeri otomatik doldurma burada YAPILMIYOR.
    // Sadece aday listesine 'son kullanılan' olarak eklenecek (yanlış override olmasın).
// ✅ Excel okununca DÜZELTME PENCERESİ aç
    openExcelReviewUI({
      plate: plateNeedle,
      chosen,
      ydKey: chosen?.ydKey || chosen?.firma || '',
      candidates: {
        ambalaj: getAmbalajCandidates(chosen?.headerText || ''),
        sevkYeri: getLimanCandidates(chosen?.headerText || '')
      },
      onApply: (fixed) => {
        const firmaKodu = document.getElementById('firmaKodu');
        const malzeme = document.getElementById('malzeme');
        const malzemeSelect = document.getElementById('malzemeSelect');
        const sevkYeri = document.getElementById('sevkYeri');
        const ambalajBilgisi = document.getElementById('ambalajBilgisi');

        const bbt = document.getElementById('bbt');
        const cuval = document.getElementById('cuval');
        const palet = document.getElementById('palet');
        const bosBbt = document.getElementById('bosBbt');
        const bosCuval = document.getElementById('bosCuval');

        if (firmaKodu) firmaKodu.value = fixed.firma || '';
        if (malzeme) malzeme.value = fixed.malzeme || '';
        if (malzemeSelect) malzemeSelect.value = fixed.malzeme || '';
        if (sevkYeri) sevkYeri.value = fixed.sevkYeri || '';
        if (ambalajBilgisi) ambalajBilgisi.value = fixed.ambalaj || '';

        // ✅ Bu Excel oturumunda aynı firmaya (YDxx) hızlı varsayılan kaydı:
        // Bir kez girildi mi, sonraki plakalarda otomatik dolsun.
        try {
          if (!window.__firmaQuickDefaults) window.__firmaQuickDefaults = {};
          const fKey = _firmaKey(fixed.firma);
          if (fKey) {
            const amb = String(fixed.ambalaj || '').trim();
            const svk = String(fixed.sevkYeri || '').trim();
            // Boşları kaydetme; önceki dolu değer varsa koru
            const prev = window.__firmaQuickDefaults[fKey] || {};
            window.__firmaQuickDefaults[fKey] = {
              ambalaj: amb || prev.ambalaj || '',
              sevkYeri: svk || prev.sevkYeri || ''
            };
          }
        } catch(e) {}

        if (bbt) bbt.value = fixed.bbt || '';
        if (palet) palet.value = fixed.palet || '';
        if (bosBbt) bosBbt.value = fixed.bosBbt || '';

        // ✅ Çuval özel mantık: 0 gelirse boş çuvalı çuval gibi göster (mevcut davranış korunur)
        if (cuval) {
          const cv = Number(fixed.cuval || 0);
          const bcv = Number(fixed.bosCuval || 0);
          if (cv > 0) {
            cuval.value = String(fixed.cuval);
            if (bosCuval) bosCuval.value = (bcv > 0 ? String(fixed.bosCuval) : '');
          } else if (bcv > 0) {
            cuval.value = String(fixed.bosCuval);
            if (bosCuval) bosCuval.value = '';
          } else {
            cuval.value = '';
            if (bosCuval) bosCuval.value = '';
          }
        }
        // ✅ Excel düzeltmesinden sonra: firma+malzeme eşleştirmesini güncelle (ambalaj/sevk)
        try {
          const f = _firmaKey(fixed.firma);
          const m = (fixed.malzeme || '').trim();
          if (f && m) {
            const existing = eslestirmeListesi.find(es => es.firma === f && es.malzeme === m);
            if (existing && existing.id) {
              eslestirmeStorage.update(existing.id, {
                ambalajBilgisi: (fixed.ambalaj || '').trim(),
                sevkYeri: (fixed.sevkYeri || '').trim()
              });
            } else {
              eslestirmeStorage.add(f, m, (fixed.ambalaj || '').trim(), '', (fixed.sevkYeri || '').trim());
            }
          }
        } catch(e){}

        // ✅ Aynı Excel oturumunda hızlı doldurma (firma/YD bazlı)
        // Kullanıcı bir kez ambalaj/sevk yeri girdiyse, aynı firmaya ait sonraki plakalarda otomatik gelsin.
        try {
          const f = _firmaKey(fixed.firma);
          const a = (fixed.ambalaj || '').trim();
          const s = (fixed.sevkYeri || '').trim();
          if (f && (a || s)) {
            const key = normalizeYdKey(fixed.ydKey || chosen?.ydKey || fixed.firma || chosen?.firma || '');
            if (!window.__quickDefaultsByKey) window.__quickDefaultsByKey = {};
            if (key && (a || s)) {
              window.__quickDefaultsByKey[key] = {
                ambalaj: a || (window.__quickDefaultsByKey[key]?.ambalaj || ''),
                sevkYeri: s || (window.__quickDefaultsByKey[key]?.sevkYeri || '')
              };
            }
          }
        } catch(e){}

      }
    });

  } catch(e) {
    console.error('applyShipmentToTakipForm hata:', e);
  }
}






// 🛡️ Sessiz koruma: hata olursa uygulama çökmesin (login'i etkilemez)
function showUiWarning(message) {
    try {
        let bar = document.getElementById('uiWarningBar');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'uiWarningBar';
            bar.className = 'ui-warning hidden';
            bar.innerHTML = `
                <div class="ui-warning__content">
                    <span id="uiWarningText"></span>
                    <button id="uiWarningClose" class="ui-warning__close" title="Kapat">✖</button>
                </div>
            `;
            document.body.appendChild(bar);
            document.getElementById('uiWarningClose')?.addEventListener('click', () => {
                bar.classList.add('hidden');
            });
        }
        const t = document.getElementById('uiWarningText');
        if (t) t.textContent = String(message || 'Bir hata oluştu.');
        bar.classList.remove('hidden');
    } catch (e) {
        console.error('showUiWarning hata:', e);
    }
}

window.addEventListener('error', (e) => {
    console.error('JS ERROR:', e?.error || e?.message || e);
    logClientError('error', e?.error || e?.message || e);
    logClientError('promise', e?.reason || e);
    showUiWarning('Bir hata oluştu. F12 > Console’dan hatayı görebilirsiniz.');
});


// ✅ Görünmez otomatik günlük yedek (indirirmez, localStorage'a snapshot alır)
function autoDailySnapshot() {
  try {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth()+1).padStart(2,'0');
    const d = String(today.getDate()).padStart(2,'0');
    const key = `auto_backup_${y}-${m}-${d}`;

    if (localStorage.getItem(key)) return; // bugün alındı

    const snap = {
      ts: new Date().toISOString(),
      vehicles: (window.storage && window.storage.loadAll) ? window.storage.loadAll() : []
    };
    localStorage.setItem(key, JSON.stringify(snap));

    // son 7 günü tut, eskileri temizle
    const keys = [];
    for (let i=0;i<localStorage.length;i++){
      const k = localStorage.key(i);
      if (k && k.startsWith('auto_backup_')) keys.push(k);
    }
    keys.sort().reverse();
    keys.slice(7).forEach(k => localStorage.removeItem(k));
  } catch (e) {}
}

// ✅ Sessiz hata günlüğü (en fazla 120 kayıt)
function logClientError(type, payload) {
  try {
    const key = 'client_error_log';
    const arr = JSON.parse(localStorage.getItem(key) || '[]');
    const item = { ts: new Date().toISOString(), type, payload: String(payload || '') };
    arr.unshift(item);
    localStorage.setItem(key, JSON.stringify(arr.slice(0, 120)));
  } catch (e) {}
}

window.addEventListener('unhandledrejection', (e) => {
    console.error('PROMISE ERROR:', e?.reason || e);
    logClientError('error', e?.error || e?.message || e);
    showUiWarning('Bir hata oluştu. F12 > Console’dan hatayı görebilirsiniz.');
});
        // TÜM VERİLERİ DIŞA AKTAR - YENİ
        function exportFullBackup() {
  try {
    const storageDump = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      // 🔗 Eşleştirme kaldırıldı: yedeğe dahil etme
      if (/eslestirme/i.test(k) || k === 'eslestirmeListesi') continue;
      // ❌ Firma/Malzeme/Sevk hafızaları: yedeğe dahil etme
      if (DISABLED_STORAGE_KEYS && DISABLED_STORAGE_KEYS.includes(k)) continue;
      storageDump[k] = localStorage.getItem(k);
}

    const allData = {
      __type: "V8_FULL_BACKUP",
      exportTarihi: new Date().toLocaleString('tr-TR'),
      storageDump
    };

    const dataStr = JSON.stringify(allData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `V8_TAM_YEDEK_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error(e);
    alert('❌ Yedek alınırken hata oluştu!');
  }
}

// Eski kısmi yedek (geriye dönük uyumluluk için)
function exportAllDataLegacy() {
  const allData = {
    vehicles: storage.loadAll(),
    // ❌ firmalar/malzemeler/export kaldırıldı

    driverIssuesByPlate: loadIssuesMap(),
    dailyShipmentsCurrent: (() => { try { return JSON.parse(localStorage.getItem(DAILY_SHIPMENT_KEY) || 'null'); } catch(e){ return null; } })(),
    yuklemeSirasiCounter: localStorage.getItem('yuklemeSirasiCounter'),
    yuklemeSirasiDate: localStorage.getItem('yuklemeSirasiDate'),
    deletionLog: (() => { try { return JSON.parse(localStorage.getItem('deletionLog') || '[]'); } catch(e){ return []; } })(),
    exportTarihi: new Date().toLocaleString('tr-TR')
  };

  const dataStr = JSON.stringify(allData, null, 2);
  const dataBlob = new Blob([dataStr], {type: 'application/json'});
  const url = URL.createObjectURL(dataBlob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `V8_YEDEK_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function exportAllData(){ return exportAllDataLegacy(); }


        // TÜM VERİLERİ İÇE AKTAR - YENİ
        function importAllData(jsonData) {
            try {
                const allData = JSON.parse(jsonData);

                // ✅ TAM YEDEK (tüm localStorage dump) içe aktarma
                if (allData && allData.storageDump && typeof allData.storageDump === 'object') {
                    try {
                        // send full storageDump to server to persist into SQLite
                        fetch('/api/restore-full', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(allData)
                        }).then(resp => resp.json()).then(result => {
                          try { console.log('restore-full result', result); } catch(e){}
                          // reload app state from server by forcing storage to re-fetch
                          try {
                            if (window.storage && typeof window.storage._readAll === 'function') {
                              window.storage._readAll().then(()=>{
                                try { loadVehicles(); } catch(e){}
                                try { loadFirmalar(); } catch(e){}
                                try { loadEslestirmeler(); } catch(e){}
                                try { loadMalzemeler(); } catch(e){}
                                try { purgeDisabledKeys(); } catch(e){}
                              }).catch(()=>{
                                try { loadVehicles(); } catch(e){}
                              });
                            } else {
                              try { loadVehicles(); } catch(e){}
                            }
                          } catch(e) { try { loadVehicles(); } catch(e){} }
                        }).catch(e => {
                          console.error('Restore failed', e);
                        });
                        return { __fullRestore: true };
                    } catch(e) {
                        return false;
                    }
                }

let sonuc = {
                    araclar: { added: 0, duplicate: 0 },
                    firmalar: { added: 0, duplicate: 0 },
                    eslestirmeler: { added: 0, duplicate: 0 },
                    malzemeler: { added: 0, duplicate: 0 }
                };
                // Araçları içe aktar
                // ✅ Artık plaka benzersiz değil: aynı plaka birden fazla kayıt olabilir.
                // Bu yüzden sadece ID bazlı çakışma kontrolü yapılır.
                if (allData.vehicles) {
                    allData.vehicles.forEach(vehicle => {
                        const key = `vehicle_${vehicle.id}`;
                        if (!localStorage.getItem(key)) {
                            storage.save(key, vehicle);
                            sonuc.araclar.added++;
                        } else {
                            sonuc.araclar.duplicate++;
                        }
                    });
                }
                // ❌ Firmaları içe aktarma kaldırıldı (yedek taşınmasın)
// Eşleştirmeler kaldırıldı: içe aktarma yapılmaz, varsa da temizlenir
                try { localStorage.removeItem('eslestirmeListesi'); } catch(e) {}
        try { localStorage.removeItem('firmaOverrides_v1'); } catch(e) {}
                try { eslestirmeListesi = []; } catch(e) {}

                // Malzemeleri içe aktar
                if (allData.malzemeler) {
                    allData.malzemeler.forEach(malzeme => {
                        if (!malzemeListesi.includes(malzeme)) {
                            malzemeListesi.unshift(malzeme);
                            sonuc.malzemeler.added++;
                        } else {
                            sonuc.malzemeler.duplicate++;
                        }
                    });
                    try { localStorage.removeItem('malzemeListesi'); } catch(e) {}
}

                // ⚠️ Sorunlar / Şoför-Plaka sorun kayıtlarını içe aktar (merge)
                if (allData.driverIssuesByPlate && typeof allData.driverIssuesByPlate === 'object') {
                    const existing = loadIssuesMap();
                    let addedCount = 0;
                    Object.keys(allData.driverIssuesByPlate).forEach(k => {
                        const arr = Array.isArray(allData.driverIssuesByPlate[k]) ? allData.driverIssuesByPlate[k] : [];
                        if (!Array.isArray(existing[k])) existing[k] = [];
                        arr.forEach(it => {
                            const id = it && it.id;
                            if (id && !existing[k].some(x => x && x.id === id)) {
                                existing[k].push(it);
                                addedCount++;
                            }
                        });
                        // newest first
                        existing[k].sort((a,b) => (b?.ts||0) - (a?.ts||0));
                    });
                    saveIssuesMap(existing);
                    sonuc.sorunlar = { added: addedCount };
                } else {
                    sonuc.sorunlar = { added: 0 };
                }

                // Günlük sevkiyat / sayaç / loglar (varsa)
                if (allData.dailyShipmentsCurrent !== undefined) {
                    try { localStorage.setItem(DAILY_SHIPMENT_KEY, JSON.stringify(allData.dailyShipmentsCurrent)); } catch(e){}
                }
                if (allData.yuklemeSirasiCounter !== undefined && allData.yuklemeSirasiCounter !== null) {
                    try { localStorage.setItem('yuklemeSirasiCounter', String(allData.yuklemeSirasiCounter)); } catch(e){}
                }
                if (allData.yuklemeSirasiDate !== undefined && allData.yuklemeSirasiDate !== null) {
                    try { localStorage.setItem('yuklemeSirasiDate', String(allData.yuklemeSirasiDate)); } catch(e){}
                }
                if (allData.deletionLog) {
                    try { localStorage.setItem('deletionLog', JSON.stringify(allData.deletionLog)); } catch(e){}
                }

                return sonuc;
            } catch (e) {
                return false;
            }
        }

        // Verileri yükle
        function loadVehicles() {
            state.searchTerm = '';
            state.showAll = false;
            state.vehicles = storage.loadAll();
            // Telefonları otomatik formatla ve kaydet
            try {
                let changed = false;
                const all = state.vehicles.map(v => {
                    const old = v.iletisim || '';
                    const neu = formatTRPhone(old);
                    if (neu && neu !== old) { changed = true; return { ...v, iletisim: neu }; }
                    return v;
                });
                if (changed && window.storage && window.storage.save) {
                    // her kaydı güncelle
                    all.forEach(v => window.storage.save('vehicle_' + v.id, v));
                    state.vehicles = all;
                }
            } catch(e) {}

            cleanDuplicatePlates();
            firmaStorage.load();
            
            // ❌ Malzeme listesini localStorage'dan yükleme kaldırıldı
eslestirmeStorage.load();
            autoDailySnapshot();
            render();

// ✅ Raporlar'dan gelen tekrar yazdır isteği: araç formunu otomatik aç
try {
    const pid = (localStorage.getItem('pending_reprint_vehicleId') || '').trim();
    if (pid) {
        localStorage.removeItem('pending_reprint_vehicleId');
        const v = (state.vehicles || []).find(x => String(x.id) === String(pid));
        if (v) {
            setTimeout(() => {
                try { showTakipFormu(v); } catch(e) {}
            }, 50);
        } else {
            try { showToast && showToast('⚠️ Tekrar yazdırılacak araç bulunamadı.'); } catch(e) {}
        }
    }
} catch(e) {}

        }

        // Form verilerini güncelle
        function updateFormData(field, value) {
  if (field === 'iletisim') {
    state.formData[field] = formatTRPhone(value);
    return;
  }
  state.formData[field] = value;
}

        // Kayıt ekle/güncelle
        function saveVehicle() {
            const cekiciPlaka = state.formData.cekiciPlaka.trim();
            
            if (!cekiciPlaka) {
                alert('❌ Çekici plaka zorunludur!');
                return;
            }

            if (!isValidTC(state.formData.tcKimlik)) {
                alert('❌ TC Kimlik numarası 11 haneli olmalıdır!');
                return;
            }

            if (!isValidIletisim(state.formData.iletisim)) {
                alert('❌ İletişim numarası 10 veya 11 haneli olmalıdır!');
                return;
            }
            const vehicleData = {
                id: state.editingId || Date.now().toString(),
                ...state.formData,
                kayitTarihi: state.editingId ? 
                    state.vehicles.find(v => v.id === state.editingId)?.kayitTarihi : 
                    new Date().toLocaleString('tr-TR')
            };

            storage.save(`vehicle_${vehicleData.id}`, vehicleData);
            
            if (state.editingId) {
                state.vehicles = state.vehicles.map(v => 
                    v.id === state.editingId ? vehicleData : v
                );
            } else {
                state.vehicles.push(vehicleData);
            }

            alert(state.editingId ? '✅ Kayıt güncellendi!' : '✅ Kayıt eklendi!');
            resetForm();
        }

        // Form'u sıfırla
        function resetForm() {
            state.formData = {
                cekiciPlaka: '',
                dorsePlaka: '',
                soforAdi: '',
                soforSoyadi: '',
                sofor2Adi: '',
                sofor2Soyadi: '',
                iletisim: '',
                tcKimlik: '',
                defaultFirma: '',
                defaultMalzeme: '',
                defaultSevkYeri: '',
                defaultYuklemeNotu: ''
            };
            state.editingId = null;
            state.showForm = false;
            render();
        }

        // Arama
        function filterVehicles() {
  // ✅ Görünmez performans: basit cache
  window.__filterCache = window.__filterCache || { term: null, ver: 0, out: null };
  const currentVer = (state.vehicles && state.vehicles.length) ? state.vehicles.length : 0;
  if (window.__filterCache.term === state.searchTerm && window.__filterCache.ver === currentVer && window.__filterCache.out) {
    return window.__filterCache.out;
  }
  if (!state.searchTerm) return state.vehicles;

  const term = state.searchTerm.toLowerCase();
  // ✅ Plaka aramasında boşluk / tire farkını yok say
  // Örn: "34ABC123" yazılsa da "34 ABC 123" eşleşsin
  const termPlate = term.replace(/[\s-]+/g, '');

  const out = state.vehicles.filter(vehicle =>
    (vehicle.cekiciPlaka || '').toLowerCase().replace(/[\s-]+/g, '').includes(termPlate) ||
    (vehicle.dorsePlaka  || '').toLowerCase().replace(/[\s-]+/g, '').includes(termPlate) ||
    (vehicle.soforAdi    || '').toLowerCase().includes(term) ||
    (vehicle.soforSoyadi || '').toLowerCase().includes(term) ||
    (vehicle.sofor2Adi   || '').toLowerCase().includes(term) ||
    (vehicle.sofor2Soyadi|| '').toLowerCase().includes(term) ||
    (vehicle.iletisim    || '').toLowerCase().includes(term) ||
    (vehicle.tcKimlik    || '').toLowerCase().includes(term)
  );
  // ✅ Aramada: sorunlu olanları üste taşı (1 sorun bile varsa)
  try {
    out.sort((a,b)=>{
      const ap = (a.cekiciPlaka||'').toLowerCase().replace(/[\s-]+/g,'');
      const bp = (b.cekiciPlaka||'').toLowerCase().replace(/[\s-]+/g,'');
      const aExact = ap === termPlate ? 1 : 0;
      const bExact = bp === termPlate ? 1 : 0;
      if (aExact !== bExact) return bExact - aExact;
      const ai = getIssueCount(a.cekiciPlaka);
      const bi = getIssueCount(b.cekiciPlaka);
      if (ai !== bi) return bi - ai;
      return 0;
    });
  } catch(e){}


  window.__filterCache = { term: state.searchTerm, ver: currentVer, out };
  return out;
}

        // Veri dışa aktar - YENİ
        function exportData() {
            if (confirm('✅ TAM YEDEK AL: Sistem içindeki ne var ne yok (tüm kayıtlar + ayarlar + arşivler) yedeklensin mi?')) {
                exportFullBackup();
            }
        }

        // Veri içe aktar - YENİ
        function importData() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.style.display = 'none';
  document.body.appendChild(input);

  input.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) {
      document.body.removeChild(input);
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = importAllData(event.target.result);
      if (result !== false) {
        let message = '✅ VERİLER BAŞARIYLA İÇE AKTARILDI:\n\n';

        if (result && result.__fullRestore) {
          alert('✅ TAM YEDEK GERİ YÜKLENDİ!\\n\\nSayfa şimdi yenilenecek.');
          setTimeout(() => { try { location.reload(); } catch(e) {} }, 200);
          document.body.removeChild(input);
          return;
        }

        if (result.araclar.added > 0) message += `• ${result.araclar.added} araç kaydı\n`;
        if (result.firmalar.added > 0) message += `• ${result.firmalar.added} firma\n`;
        if (result.eslestirmeler.added > 0) message += `• ${result.eslestirmeler.added} eşleştirme\n`;
        if (result.malzemeler.added > 0) message += `• ${result.malzemeler.added} malzeme\n`;

        if (result.araclar.duplicate > 0) message += `\n⚠️ ${result.araclar.duplicate} araç atlandı (plaka çakışması)`;
        if (result.firmalar.duplicate > 0) message += `\n⚠️ ${result.firmalar.duplicate} firma atlandı (zaten mevcut)`;
        if (result.eslestirmeler.duplicate > 0) message += `\n⚠️ ${result.eslestirmeler.duplicate} eşleştirme atlandı (zaten mevcut)`;
        if (result.malzemeler.duplicate > 0) message += `\n⚠️ ${result.malzemeler.duplicate} malzeme atlandı (zaten mevcut)`;

        alert(message);
        loadVehicles();
      } else {
        alert('❌ Geçersiz yedek dosyası veya bozuk JSON!');
      }

      document.body.removeChild(input);
    };

    reader.onerror = () => {
      alert('❌ Dosya okunamadı!');
      document.body.removeChild(input);
    };

    reader.readAsText(file);
  }, { once: true });

  input.click();
}

        // Takip Formu Göster
        

// =============================
// KANTAR imza otomatik eşleştirme
// Not: İmza dosyalarını /V8/signatures klasörüne koyacağız.
// =============================
function resolveKantarSignatureSrc(name) {
  const key = (name || '').trim().toUpperCase();
  const map = {
    "BURAK KARATAŞ": "signatures/burak_karatas.png",
    "BEKİR DOĞRU": "signatures/bekir_dogru.png",
    "BATUHAN KOCABAY": "signatures/batuhan_kocabay.png",
    "BATUHAN CINAR": "signatures/batuhan_cinar.png"
  };
  return map[key] || "";
}

function refreshKantarSignaturePreview() {
  const input = document.getElementById('imzaKantarAd');
  const img = document.getElementById('imzaKantarImg');
  const ph = document.getElementById('imzaKantarPlaceholder');
  if (!input || !img || !ph) return;

  const src = resolveKantarSignatureSrc(input.value);
  if (src) {
    img.onerror = () => {
      img.style.display = 'none';
      ph.style.display = 'block';
      ph.textContent = 'İmza bulunamadı';
    };
    img.src = src;
    img.style.display = 'block';
    ph.style.display = 'none';
  } else {
    try { img.removeAttribute('src'); } catch(_) {}
    img.style.display = 'none';
    ph.style.display = 'block';
    ph.textContent = 'İmza otomatik gelecek';
  }
}

// =============================
// KANTAR seçimi kalıcı olsun (kullanıcı bazlı)
// - Her login ID için ayrı saklar.
// - Kullanıcı değiştirmezse form açıldığında otomatik doldurur.
// =============================
const KANTAR_PREF_PREFIX = 'pref_kantar_default_v1_';

function getCurrentUserIdSafe() {
  try {
    return String(localStorage.getItem('currentUserId') || '').trim().toUpperCase();
  } catch (e) {
    return '';
  }
}

function getKantarPrefKey() {
  const uid = getCurrentUserIdSafe();
  return KANTAR_PREF_PREFIX + (uid || 'GLOBAL');
}

function loadSavedKantarName() {
  try {
    const key = getKantarPrefKey();
    const v1 = localStorage.getItem(key);
    if (v1 && String(v1).trim()) return String(v1).trim();
    const vG = localStorage.getItem(KANTAR_PREF_PREFIX + 'GLOBAL');
    return (vG && String(vG).trim()) ? String(vG).trim() : '';
  } catch (e) {
    return '';
  }
}

function persistKantarName(name) {
  try {
    const key = getKantarPrefKey();
    const v = String(name || '').trim();
    if (v) localStorage.setItem(key, v);
    else localStorage.removeItem(key);
  } catch (e) {}
}

function bindKantarSignaturePicker() {
  const input = document.getElementById('imzaKantarAd');
  if (!input) return;
  // Aynı input'a tekrar tekrar listener bağlamayalım
  if (input.__kantarBound) {
    // Form tekrar açıldıysa: kayıtlı kantarı uygula
    try {
      const saved = loadSavedKantarName();
      if (!(input.value || '').trim() && saved) input.value = saved;
    } catch (e) {}
    refreshKantarSignaturePreview();
    return;
  }
  input.__kantarBound = true;

  // Browserın eski otomatik doldurmasını bastıralım
  input.setAttribute('autocomplete', 'off');

  // Form ilk açıldığında kayıtlı kantarı otomatik getir
  try {
    const saved = loadSavedKantarName();
    if (!(input.value || '').trim() && saved) input.value = saved;
  } catch (e) {}

  const persistNow = () => {
    persistKantarName(input.value);
  };

  // Görsel önizleme + kalıcı kayıt
  input.addEventListener('input', () => {
    refreshKantarSignaturePreview();
    // ✅ Kullanıcı yazarken/ seçerken anında kaydet ("blur/change" kaçarsa da kaybolmasın)
    persistNow();
  });
  input.addEventListener('change', () => {
    refreshKantarSignaturePreview();
    persistNow();
  });
  input.addEventListener('blur', () => {
    persistNow();
  });

  refreshKantarSignaturePreview();
}

function showTakipFormu(vehicle) {
            const formContainer = document.getElementById('takipFormu');

            
            // ✅ Raporlar / tekrar yazdır için aktif araç referansı
            try { window.__activeTakipVehicleId = vehicle && vehicle.id ? String(vehicle.id) : ''; } catch(e) {}
            try { window.__activeTakipVehiclePlate = (vehicle && vehicle.cekiciPlaka) ? String(vehicle.cekiciPlaka) : ''; } catch(e) {}
            try { window.__activeTakipVehicle = vehicle || null; } catch(e) {}
// ✅ Olası takılma: üstte kalan seçim overlay'leri inputları kilitlemesin
            try { document.getElementById('quickPickOverlay')?.remove(); } catch(_) {}
            try { const psb = document.getElementById('plateSearchBox'); if (psb) psb.style.display = 'none'; } catch(_) {}

            // ✅ Takip formu sıra no: ekranda öneri göster (sayacı artırmadan)
            function getLocalDateKey() {
                const d = new Date();
                const yyyy = d.getFullYear();
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                const dd = String(d.getDate()).padStart(2, '0');
                return `${yyyy}-${mm}-${dd}`;
            }

            function getSuggestedYuklemeSirasi() {
                try {
                    const todayKey = getLocalDateKey();
                    const lastDate = localStorage.getItem('yuklemeSirasiDate');
                    const counter = parseInt(localStorage.getItem('yuklemeSirasiCounter') || '0', 10);
                    if (lastDate !== todayKey) return 1;
                    return (Number.isFinite(counter) ? counter : 0) + 1;
                } catch (e) {
                    return 1;
                }
            }

            // ✅ Enter ile sonraki alana geç (takip formu içinde)
            function enableEnterNavigation(rootEl) {
                if (!rootEl || rootEl.__enterNavBound) return;
                rootEl.__enterNavBound = true;

                rootEl.addEventListener('keydown', function (e) {
                    if (e.key !== 'Enter') return;

                    const target = e.target;
                    if (!target) return;

                    const tag = (target.tagName || '').toLowerCase();
                    const isField = tag === 'input' || tag === 'select' || tag === 'textarea';
                    if (!isField) return;

                    // textarea'da yeni satır istenirse Ctrl+Enter
                    if (tag === 'textarea' && (e.ctrlKey || e.metaKey)) return;

                    e.preventDefault();

                    const focusables = Array.from(rootEl.querySelectorAll('input, select, textarea, button'))
                        .filter(el => !el.disabled && el.type !== 'hidden' && el.offsetParent !== null);

                    const idx = focusables.indexOf(target);
                    if (idx === -1) return;
                    const next = focusables[idx + 1] || focusables[0];
                    next.focus();
                }, true);
            }

            formContainer.innerHTML = `

            <div id="takipFormWarn" class="form-warn hidden"></div>

                <div style="width: 100%; font-family: Arial, sans-serif; font-size: 11pt; line-height: 1.2; background: white; box-sizing: border-box;" class="bg-white">
                    <!-- Başlık -->
                    <div style="text-align: center; margin-bottom: 6mm;">
                        <h1 style="font-size: 18pt; font-weight: bold; margin: 0 0 2mm 0; color: #2c3e50;">SEVKİYAT YÜKLEMESİ TAKİP FORMU</h1>
                    </div>

                    <!-- Şoför Bilgileri - YENİ DÜZEN -->
<div style="border: 2px solid #d9534f; padding: 4mm; background: #fffacd; margin-bottom: 4mm;" class="highlight-section">

  <div style="font-size: 14pt; font-weight: bold; margin-bottom: 6mm; color: #d9534f; text-decoration: underline; text-align:center;" class="highlight-title">
    ŞOFÖR BİLGİLERİ:
  </div>

  <!-- ✅ Grid'i komple ortalayan wrapper -->
  <div style="max-width: 1100px; margin: 0 auto;">

    <!-- ✅ 2 Kolon: sabit genişlik + ortalama -->
    <div style="display: grid; grid-template-columns: 220px 360px; gap: 10mm; justify-content: center; align-items: start;">

      <!-- Sol Taraf - Şoför Bilgileri -->
      <div>
        <div style="margin-bottom: 6mm;">
          <strong style="font-size: 11pt; display: block; margin-bottom: 1mm;">ŞOFÖR ADI SOYADI:</strong>
          <div style="display:flex; gap:6px; align-items:center;">
            <input
              type="text"
              id="soforBilgi"
              class="form-input highlight-field"
              style="font-weight:bold; font-size:13pt; color:#2c3e50; height:8mm;"
              value="${(vehicle.soforAdi || '') + (vehicle.soforSoyadi ? ' ' + vehicle.soforSoyadi : '')}"
              placeholder="Şoför adı soyadı"
            >
</div>
        </div>

        <div style="margin-bottom: 6mm;">
          <strong style="font-size: 11pt; display: block; margin-bottom: 1mm;">T.C. KİMLİK NO:</strong>
          <input
            type="text"
            id="tcBilgi"
            class="form-input highlight-field"
            style="font-weight:bold; font-size:13pt; color:#2c3e50; height:8mm;"
            value="${vehicle.tcKimlik || ''}"
            placeholder="T.C. kimlik"
          >
        </div>

        <div>
          <strong style="font-size: 11pt; display: block; margin-bottom: 1mm;">İLETİŞİM:</strong>
          <input
            type="text"
            id="iletisimBilgi"
            class="form-input highlight-field"
            style="font-weight:bold; font-size:13pt; color:#2c3e50; height:8mm;"
            value="${formatTRPhone(vehicle.iletisim || '')}"
            placeholder="İletişim"
          >
        </div>
      </div>

      <!-- Sağ Taraf - Yükleme Bilgileri -->
      <div>

        <!-- Yükleme Sırası / Tarih -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; margin-bottom: 6mm;">
          <div>
  <strong style="font-size: 11pt; display: block; margin-bottom: 1mm;">
    YÜKLEME SIRASI
  </strong>

  <input
    type="text"
    class="form-input"
    id="yuklemeSirasi"
    style="
      font-size: 12pt;
      font-weight: bold;
      height: 8mm;
      border: 2px solid #3498db;
      width: 100%;
      background-color: #ffffff;
    "
  >

  <div style="
    font-size: 9pt;
    color: #6b7280;
    margin-top: 1mm;
    font-style: italic;
  ">
    🛈 Boş bırakırsan Yazdır’da otomatik atanır
  </div>
</div>

          <div>
            <strong style="font-size: 11pt; display: block; margin-bottom: 1mm;">TARİH</strong>
            <span style="font-weight: bold; font-size: 13pt; color: #d9534f; display: block; height: 8mm; line-height: 8mm;">
              ${new Date().toLocaleDateString('tr-TR')}
            </span>
          </div>
        </div>

        <!-- Çekici / Dorse -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; margin-bottom: 6mm;">
          
<div>
  <strong style="font-size: 11pt; display: block; margin-bottom: 1mm;">ÇEKİCİ PLAKA</strong>

  <div style="display:flex; gap:6px; align-items:center;">
    <input
      type="text"
      id="cekiciPlakaBilgi"
      class="form-input highlight-field"
      style="font-weight:bold; font-size:14pt; color:#2c3e50; height:8mm; flex:1;"
      value="${vehicle.cekiciPlaka || ''}"
      placeholder="Çekici plaka"
    >
    <button type="button" id="plakaBulBtn"
      style="white-space:nowrap; background:#f3f4f6; border:1px solid #d1d5db; color:#111827; padding:6px 10px; border-radius:10px; font-weight:800; height:8mm;">
      🔎 Bul
    </button>
  </div>

  <datalist id="plakaSuggestList"></datalist>

  <div id="plateSearchBox"
    style="display:none; position:fixed; z-index:2147483647; border:1px solid #d1d5db; border-radius:10px; background:#fff; max-height:160px; overflow:auto; box-shadow:0 8px 24px rgba(0,0,0,.18);">
  </div>
</div>

          <div>
            <strong style="font-size: 11pt; display: block; margin-bottom: 1mm;">DORSE PLAKA</strong>
            <input
              type="text"
              id="dorsePlakaBilgi"
              class="form-input highlight-field"
              style="font-weight:bold; font-size:14pt; color:#2c3e50; height:8mm;"
              value="${vehicle.dorsePlaka || ''}"
              placeholder="Dorse plaka"
            >
          </div>
        </div>

        <!-- Ek Alanlar -->
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 6mm; margin-top: 2mm;">
          <div>
            <strong style="font-size:11pt; display:block; margin-bottom:1mm;">SEVK YERİ</strong>
            <input type="text" id="sevkYeri" class="form-input" autocomplete="off">
          </div>

          <div>
            <strong style="font-size:11pt; display:block; margin-bottom:1mm;">TONAJ</strong>
            <input type="text" id="tonaj" class="form-input">
          </div>

          <div>
            <strong style="font-size:11pt; display:block; margin-bottom:1mm;">AMBALAJ BİLGİSİ</strong>
            <input type="text" id="ambalajBilgisi" class="form-input">
          </div>

          <div>
            <strong style="font-size:11pt; display:block; margin-bottom:1mm;">SEPERATÖR BİLGİSİ</strong>
            <input type="text" id="seperatorBilgisi" class="form-input">
          </div>
        </div>

      </div> <!-- Sağ Taraf -->

    </div> <!-- 2 kolon grid -->
  </div>   <!-- max-width wrapper -->
</div>

<!-- Ana Form Tablosu -->



                    <!-- Ana Form Tablosu -->
                    <table style="width: 100%; border-collapse: collapse; margin-bottom: 4mm; font-size: 11pt;">
                        <tr>
                            <td style="border: 1px solid #000; padding: 4mm; width: 35%;"><strong style="font-size: 11pt;">FİRMA /MÜŞTERİ KODU</strong></td>
                            <td style="border: 1px solid #000; padding: 0;">
                                <select class="firma-select" id="firmaSelect" style="font-size: 11pt;">
                                    <option value="">Seçiniz veya elle yazın</option>
                                    ${firmaListesi.map(firma => `<option value="${getFirmaKodOnly(firma)}">${getFirmaKodOnly(firma)}</option>`).join('')}
                                </select>
                                <div style="display:flex; gap:6px; align-items:center; padding: 3mm; margin-top: 2mm;">
                                  <input type="text" class="form-input" style="border: none; width: 100%; padding: 0; font-size: 12pt; font-weight: bold;" id="firmaKodu" placeholder="Veya firma/müşteri kodu giriniz" autocomplete="off">
                                  <button type="button" id="firmaAraBtn" style="white-space:nowrap; background:#f3f4f6; border:1px solid #d1d5db; color:#111827; padding:6px 10px; border-radius:10px; font-weight:800;">🔎 Bul</button>
                                </div>
                            </td>
                        </tr>
                        <tr>
                            <td style="border: 1px solid #000; padding: 3mm;"><strong style="font-size: 11pt;">MALZEME</strong></td>
                            <td style="border: 1px solid #000; padding: 0;">
                                <select class="malzeme-select" id="malzemeSelect" style="font-size: 11pt;">
                                    <option value="">Seçiniz veya elle yazın</option>
                                    ${malzemeListesi.map(malzeme => `<option value="${malzeme}">${malzeme}</option>`).join('')}
                                </select>
                                <div style="display:flex; gap:6px; align-items:center; padding: 3mm; margin-top: 2mm;">
                                  <input type="text" class="form-input" style="border: none; width: 100%; padding: 0; font-size: 12pt; font-weight: bold;" id="malzeme" placeholder="Veya malzeme bilgisi giriniz" autocomplete="off">
                                  <button type="button" id="malzemeAraBtn" style="white-space:nowrap; background:#f3f4f6; border:1px solid #d1d5db; color:#111827; padding:6px 10px; border-radius:10px; font-weight:800;">🔎 Bul</button>
                                </div>
                            </td>
                        </tr>
                        <tr>
  <!-- SOL: başlık -->
  <td style="border: 1px solid #000; padding: 3mm; width: 35%; vertical-align: middle;">
    <strong style="font-size: 11pt;">AMBALAJ CİNSİ</strong>
  </td>

  <!-- SAĞ: seçenekler -->
  <td class="ambalaj-section" style="border: 1px solid #000; padding: 3mm; width: 65%; box-sizing:border-box;">
    
    <!-- Başlıklar -->
    <div style="display:grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 4mm; font-weight:bold; font-size:11pt; width:100%; box-sizing:border-box; margin-bottom:2mm;">
      <div>BBT</div>
      <div>BOŞ BBT</div>
      <div>ÇUVAL</div>
      <div>BOŞ ÇUVAL</div>
      <div>PALET</div>
      <div>TORBA</div>
    </div>

    <!-- Miktar -->
    <div style="display:grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 4mm; width:100%; box-sizing:border-box;">
      <input type="text" id="bbt" class="form-input" placeholder="Miktar" style="width:100%; box-sizing:border-box;">
      <input type="text" id="bosBbt" class="form-input" placeholder="Miktar" style="width:100%; box-sizing:border-box;">
      <input type="text" id="cuval" class="form-input" placeholder="Miktar" style="width:100%; box-sizing:border-box;">
      <input type="text" id="bosCuval" class="form-input" placeholder="Miktar" style="width:100%; box-sizing:border-box;">
      <input type="text" id="palet" class="form-input" placeholder="Miktar" style="width:100%; box-sizing:border-box;">
      <input type="text" id="torba" class="form-input" placeholder="Miktar" style="width:100%; box-sizing:border-box;">
    </div>

  </td>
</tr>

                            <td style="border: 1px solid #000; padding: 3mm;"><strong style="font-size: 11pt;">YÜKLEME NOTU</strong></td>
                            <td style="border: 1px solid #000; padding: 0;">
                                <textarea class="form-input" style="border: none; width: 100%; padding: 3mm; height: 15mm; resize: none; font-size: 9pt; font-weight: 600;" id="yuklemeNotu" placeholder="Yükleme notu giriniz"></textarea>
                            </td>
                        </tr>
                    </table>

                    <!-- İmza Bölümü - 4 KUTU + İSİM -->
<div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 3mm; margin-bottom: 2mm;">
  <div class="signature-box">
    <strong style="font-size: 11pt;">KANTAR</strong>
    <input id="imzaKantarAd" type="text" class="form-input" placeholder="İsim / İmza" list="kantarPersonelList" autocomplete="off" spellcheck="false">
    <datalist id="kantarPersonelList">
      <option value="BURAK KARATAŞ"></option>
      <option value="BEKİR DOĞRU"></option>
      <option value="BATUHAN KOCABAY"></option>
      <option value="BATUHAN CINAR"></option>
    </datalist>
    <div style="margin-top:6px; height:32mm; border:1px dashed rgba(0,0,0,.35); border-radius:8px; display:flex; align-items:center; justify-content:center; overflow:hidden; background:#fff;">
      <img id="imzaKantarImg" alt="Kantar İmzası" style="max-width:100%; max-height:100%; display:none;">
      <div id="imzaKantarPlaceholder" style="font-size:10pt; opacity:.65;">İmza otomatik gelecek</div>
    </div>
  </div>

  <div class="signature-box">
    <strong style="font-size: 11pt;">SEVKİYAT SAHA</strong>
    <input id="imzaSahaAd" type="text" class="form-input" placeholder="İsim / İmza">
  </div>

  <div class="signature-box">
    <strong style="font-size: 11pt;">YÜKLEYEN GÖREVLİ</strong>
    <input id="imzaYukleyenAd" type="text" class="form-input" placeholder="İsim / İmza">
  </div>

  <div class="signature-box">
    <strong style="font-size: 11pt;">KALİTE KONTROL</strong>
    <input id="imzaKaliteAd" type="text" class="form-input" placeholder="İsim / İmza">
  </div>
</div>

            `;


            // ✅ KANTAR personel seçimi -> imzayı otomatik göster
            try { bindKantarSignaturePicker(); } catch(e) { console.warn('Kantar imza bağlama hatası', e); }


            // 🔁 Şoför Sorunları butonunu başlıktaki (Yazdır/Önizleme/Kapat) buton grubuna taşı
            try {
              // Eğer buton yoksa oluştur
              let issuesBtn = document.getElementById('takipIssuesBtn');
              if (!issuesBtn) {
                issuesBtn = document.createElement('button');
                issuesBtn.id = 'takipIssuesBtn';
                issuesBtn.type = 'button';
                issuesBtn.className = 'bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700';
                issuesBtn.innerHTML = '⚠️ Şoför Sorunları (<span id="takipIssuesCnt">0</span>)';
              }
              const headerBtnRow = document.getElementById('yazdirButton')?.parentElement;
              const kapatBtn = document.getElementById('kapatButton');
              if (headerBtnRow) {
                // Kapat'ın hemen soluna yerleştir
                if (kapatBtn && kapatBtn.parentElement === headerBtnRow) {
                  headerBtnRow.insertBefore(issuesBtn, kapatBtn);
                } else {
                  headerBtnRow.appendChild(issuesBtn);
                }
              }
            } catch(e) {}



            // ⚠️ Takip Formu: Şoför Sorunları butonu
            try {
              const cnt = getIssueCount(vehicle.cekiciPlaka);
              const cntEl = document.getElementById('takipIssuesCnt');
              if (cntEl) cntEl.textContent = String(cnt);
              const btn = document.getElementById('takipIssuesBtn');
              if (btn) {
                btn.style.background = cnt>0 ? '#ef4444' : '#374151';
                addOnce(btn,'click',()=> openIssuesModal(vehicle.cekiciPlaka));
              }
            } catch(e){}

            // ✅ Takip Formu: Plaka/Dorse otomatik doldur (format) ama sonradan manuel düzeltilebilir
            // - Kullanıcı yazdıkça plaka formatı uygulanır.
            try {
              const pEl = document.getElementById('cekiciPlakaBilgi');
              const dEl = document.getElementById('dorsePlakaBilgi');

              if (pEl) {
                addOnce(pEl, 'input', () => {
                  try { pEl.value = formatPlakaForInput(pEl.value); } catch(_) {}
                });
                // açılışta da formatla
                try { pEl.value = formatPlakaForInput(pEl.value); } catch(_) {}
              }

              if (dEl) {
                addOnce(dEl, 'input', () => {
                  try { dEl.value = formatPlakaForInput(dEl.value); } catch(_) {}
                });
                try { dEl.value = formatPlakaForInput(dEl.value); } catch(_) {}
              }
            } catch(e){}

            // ✅ Takip Formu: Çekici plaka prefix araması (ör: 06...) + plaka bazlı şoför görünümü
            // - Login/Excel tarafına dokunmaz. Sadece takip formu içinde arama kolaylığı sağlar.
            try {
              const plateEl = document.getElementById('cekiciPlakaBilgi');
              const boxEl   = document.getElementById('plateSearchBox');
              const dlEl    = document.getElementById('plakaSuggestList');
              const bulBtn  = document.getElementById('plakaBulBtn');

              const nameEl = document.getElementById('soforBilgi');
              const tcEl   = document.getElementById('tcBilgi');
              const telEl  = document.getElementById('iletisimBilgi');

              const plateKey = (s) => String(s || '').toUpperCase().replace(/\s+/g,'').trim();

              const uniq = (arr) => {
                const seen = new Set(); const out = [];
                (arr || []).forEach(x => {
                  const k = plateKey(x);
                  if (!k || seen.has(k)) return;
                  seen.add(k); out.push(x);
                });
                return out;
              };

              const getAllPlates = () => {
                const plates = (state.vehicles || []).map(v => v && v.cekiciPlaka).filter(Boolean);
                return uniq(plates);
              };

              const getMatches = (prefix) => {
                const p = plateKey(prefix);
                if (!p) return [];
                return getAllPlates()
                  .filter(pl => plateKey(pl).startsWith(p))
                  .slice(0, 30);
              };

const getVehiclesByPlate = (plate) => {
  const p = plateKey(plate);
  return (state.vehicles || []).filter(v => plateKey(v?.cekiciPlaka) === p);
};

// Geriye uyumluluk: ilk kaydı döndürür
const getVehicleByPlate = (plate) => {
  const list = getVehiclesByPlate(plate);
  return (list && list.length) ? list[0] : null;
};

// ✅ Aynı plaka birden fazla kişi/araç kaydında varsa seçim ver
const openDriverPickForSamePlate = (plate, matches, onPick) => {
  try {
    const overlayId = 'driverPickOverlay';
    const old = document.getElementById(overlayId);
    if (old) old.remove();

    const escapeHtml = (s)=>String(s||'')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');

    const overlay = document.createElement('div');
    overlay.id = overlayId;
    overlay.style.cssText = [
      'position:fixed','inset:0','z-index:1000003','background:rgba(0,0,0,.25)',
      'display:flex','align-items:flex-start','justify-content:center','padding:16px'
    ].join(';') + ';';

    const card = document.createElement('div');
    card.style.cssText = [
      'width:min(620px, 96vw)','margin-top:10vh','background:#fff','border:1px solid #e5e7eb',
      'border-radius:12px','box-shadow:0 10px 30px rgba(0,0,0,.22)','overflow:hidden'
    ].join(';') + ';';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #e5e7eb;';
    header.innerHTML = `<strong style="font-size:14px;">${escapeHtml(plate)} plakası birden fazla kayıtta var — seçim yap</strong>`;

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'border:none;background:transparent;font-size:16px;cursor:pointer;opacity:.75;';
    closeBtn.onclick = ()=> overlay.remove();
    header.appendChild(closeBtn);

    const list = document.createElement('div');
    list.style.cssText = 'max-height:55vh;overflow:auto;';

    const rows = (matches || []).map((v, i) => {
      const name = ((v?.soforAdi || '') + (v?.soforSoyadi ? ' ' + v.soforSoyadi : '')).trim() || 'İsimsiz';
      const tc = String(v?.tcKimlik || '').trim();
      const tel = String(v?.iletisim || '').trim();
      const right = [tc && ('TC: ' + tc), tel && ('Tel: ' + tel)].filter(Boolean).join(' • ');
      return `
        <button type="button" data-idx="${i}"
          style="width:100%;text-align:left;padding:10px 12px;border:none;background:transparent;cursor:pointer;border-bottom:1px solid #f3f4f6;">
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;">
            <div style="display:flex;flex-direction:column;gap:2px;min-width:0;">
              <strong style="font-size:13px;">${escapeHtml(name)}</strong>
              <span style="color:#6b7280;font-size:11px;">${escapeHtml(right || '')}</span>
            </div>
            <span style="background:#111827;color:#fff;border-radius:10px;padding:6px 10px;font-weight:800;">GETİR</span>
          </div>
        </button>
      `;
    }).join('');

    list.innerHTML = rows || `<div style="padding:12px;color:#6b7280;">Kayıt bulunamadı</div>`;

    card.appendChild(header);
    card.appendChild(list);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e)=>{ if (e.target === overlay) overlay.remove(); });

    list.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-idx]');
      if (!btn) return;
      const idx = parseInt(btn.getAttribute('data-idx'), 10);
      const chosen = (matches || [])[idx];
      if (chosen) {
        try { onPick(chosen); } catch(_) {}
        overlay.remove();
      }
    });
  } catch(e) {
    // fallback: ilk kaydı al
    try { onPick(matches?.[0] || null); } catch(_) {}
  }
};

const applyDriverForPlate = (plate) => {
  const p = String(plate || '').trim();
  if (!p) return;

  // 1) Öncelik: araç kayıtları (aynı plaka birden fazla kayıtsa SEÇTİR)
  try {
    const matches = getVehiclesByPlate(p) || [];
    if (matches.length > 1) {
      // geçmişte seçilen şoförü (varsa) liste başına al
      try {
        const hist = soforHistoryStorage.list(p) || [];
        const h = hist[0] || null;
        if (h) {
          const hName = String(h.name || '').trim().toUpperCase();
          const hTc = String(h.tc || '').trim();
          const hPhone = String(h.phone || '').trim();

          matches.sort((a,b) => {
            const aName = (((a?.soforAdi||'') + (a?.soforSoyadi?(' '+a.soforSoyadi):'')).trim()).toUpperCase();
            const bName = (((b?.soforAdi||'') + (b?.soforSoyadi?(' '+b.soforSoyadi):'')).trim()).toUpperCase();
            const aTc = String(a?.tcKimlik || '').trim();
            const bTc = String(b?.tcKimlik || '').trim();
            const aPh = String(a?.iletisim || '').trim();
            const bPh = String(b?.iletisim || '').trim();

            const aHit = (hTc && aTc === hTc) || (hPhone && aPh === hPhone) || (hName && aName === hName);
            const bHit = (hTc && bTc === hTc) || (hPhone && bPh === hPhone) || (hName && bName === hName);
            return (bHit?1:0) - (aHit?1:0);
          });
        }
      } catch(_) {}

      openDriverPickForSamePlate(p, matches, (v) => {
        if (!v) return;
        const n1 = ((v.soforAdi || '') + (v.soforSoyadi ? ' ' + v.soforSoyadi : '')).trim();
        if (nameEl) nameEl.value = n1 || '';
        if (tcEl) tcEl.value = v.tcKimlik || '';
        if (telEl) telEl.value = formatTRPhone(v.iletisim || '');

        // seçimi geçmişe yaz (sonraki sefer otomatik gelsin)
        try {
          soforHistoryStorage.add(p, { name: n1, tc: String(v.tcKimlik||'').trim(), phone: String(v.iletisim||'').trim() });
        } catch(_) {}
      });
      return;
    }

    if (matches.length === 1) {
      const v = matches[0];

      // geçmiş varsa (tek kayıtta bile) otomatik doldurabilir
      try {
        const hist = soforHistoryStorage.list(p) || [];
        const d = hist[0];
        if (d) {
          if (nameEl) nameEl.value = d.name || '';
          if (tcEl) tcEl.value = d.tc || '';
          if (telEl) telEl.value = formatTRPhone(d.phone || '');
          return;
        }
      } catch(_) {}

      const n1 = ((v.soforAdi || '') + (v.soforSoyadi ? ' ' + v.soforSoyadi : '')).trim();
      if (nameEl) nameEl.value = n1 || '';
      if (tcEl) tcEl.value = v.tcKimlik || '';
      if (telEl) telEl.value = formatTRPhone(v.iletisim || '');
      return;
    }
  } catch(e) {}

  // 2) Araç kaydı yoksa: geçmişten doldur
  try {
    const hist = soforHistoryStorage.list(p) || [];
    const d = hist[0];
    if (d) {
      if (nameEl) nameEl.value = d.name || '';
      if (tcEl) tcEl.value = d.tc || '';
      if (telEl) telEl.value = formatTRPhone(d.phone || '');
      return;
    }
  } catch(e) {}
};

              const getDriversForPlate = (plate) => {
                const list = [];
                // 1) geçmişten (2 kişi)
                try {
                  const hist = soforHistoryStorage.list(plate) || [];
                  hist.slice(0, 2).forEach(d => {
                    const label = [d.name, d.phone].filter(Boolean).join(' • ');
                    if (label) list.push(label);
                  });
                } catch(e) {}

                // 2) araç kaydından (2 şoför alanı)
                if (list.length === 0) {
                  try {
                    const v = getVehicleByPlate(plate);
                    if (v) {
                      const n1 = ((v.soforAdi || '') + ' ' + (v.soforSoyadi || '')).trim();
                      const n2 = ((v.sofor2Adi || '') + ' ' + (v.sofor2Soyadi || '')).trim();
                      [n1, n2].filter(Boolean).forEach(n => list.push(n));
                    }
                  } catch(e) {}
                }

                return list.slice(0, 2);
              };

              const hideBox = () => {
                if (!boxEl) return;
                boxEl.style.display = 'none';
                boxEl.innerHTML = '';
              };

              const positionBox = () => {
                if (!plateEl || !boxEl) return;
                try {
                  const r = plateEl.getBoundingClientRect();
                  boxEl.style.position = 'fixed';
                  boxEl.style.left = Math.round(r.left) + 'px';
                  boxEl.style.top  = Math.round(r.bottom + 4) + 'px';
                  boxEl.style.width = Math.round(r.width) + 'px';
                  boxEl.style.zIndex = '2147483647';
                } catch(e) {}
              };

              const pickPlate = (p) => {
                if (!plateEl) return;
                plateEl.value = formatPlakaForInput(p);

                // ✅ DORSE PLAKA otomatik doldur (plaka seçildiğinde)
                try {
                  const v = getVehicleByPlate(p);
                  const dEl = document.getElementById('dorsePlakaBilgi');
                  if (dEl) {
                    const rawDorse = v?.dorsePlaka || v?.dorsePlakaBilgi || v?.dorse_plaka || v?.dorse || '';
                    dEl.value = formatPlakaForInput(String(rawDorse || ''));
                    try { dEl.dispatchEvent(new Event('input', { bubbles:true })); } catch(_) {}
                    try { dEl.dispatchEvent(new Event('change', { bubbles:true })); } catch(_) {}
                  }
                } catch(_) {}

                // şoför alanlarını doldur
                applyDriverForPlate(p);

                // mevcut şoför dropdown'unu refresh etsin
                try { plateEl.dispatchEvent(new Event('change', { bubbles:true })); } catch(e) {}

                hideBox();
                try { plateEl.focus(); } catch(e) {}
              };

              const renderBox = (prefix) => {
                if (!plateEl || !boxEl || !dlEl) return;

                const matches = getMatches(prefix);

                // datalist (tarayıcı önerisi)
                dlEl.innerHTML = matches.map(p => `<option value="${p}"></option>`).join('');

                // 2 karakterden kısa ise kutu açma
                const pfx = plateKey(prefix);
                if (!pfx || pfx.length < 2) { hideBox(); return; }

                const rows = matches.slice(0, 10).map(p => {
                  const drivers = getDriversForPlate(p);
                  const right = drivers.length ? `<span style="color:#6b7280; font-size:10pt;">${drivers.join(' / ')}</span>` : '';
                  return `
                    <button type="button" class="w-full text-left px-3 py-2 hover:bg-gray-100" data-plate="${encodeURIComponent(p)}">
                      <div style="display:flex; justify-content:space-between; gap:10px;">
                        <strong>${p}</strong>
                        ${right}
                      </div>
                    </button>
                  `;
                }).join('');

                if (!rows) { hideBox(); return; }

                boxEl.innerHTML = rows;
                positionBox();
                boxEl.style.display = 'block';
              };

              // seçim (tıklama)
              if (boxEl) {
                addOnce(boxEl, 'mousedown', (ev) => {
                  // blur olmadan seçebilmek için mousedown
                  const btn = ev.target?.closest?.('button[data-plate]');
                  if (!btn) return;
                  ev.preventDefault();
                  const p = decodeURIComponent(btn.getAttribute('data-plate') || '');
                  if (p) pickPlate(p);
                });
              }

              // input/odak/blur
              if (plateEl) {
                addOnce(plateEl, 'input', () => renderBox(plateEl.value));
                addOnce(plateEl, 'focus', () => renderBox(plateEl.value));
                addOnce(plateEl, 'blur',  () => setTimeout(hideBox, 180));

                // ✅ ENTER: Firma/Malzeme gibi "Bul" ekranını aç
                addOnce(plateEl, 'keydown', (ev) => {
                  if (ev.key !== 'Enter') return;
                  ev.preventDefault();
                  try { bulBtn?.click(); } catch(_) {}
                });
              }

              // Bul butonu
              if (bulBtn) {
                addOnce(bulBtn, 'click', () => {
                  if (!plateEl) return;
                  // ✅ Firma/Malzeme Bul gibi: ayrı seçim ekranı aç
                  try {
                    const opts = getAllPlates();
                    _openPlatePick({
                      title: 'Çekici Plaka Seç',
                      query: (plateEl.value || ''),
                      options: opts,
                      onPick: (val)=>{ if (val) pickPlate(val); }
                    });
                  } catch(e) {
                    // fallback: eski inline kutu
                    renderBox(plateEl.value);
                    plateEl.focus();
                  }
                });
              }

              // pencere/scroll değişince kutuyu güncelle
              addOnce(window, 'resize', positionBox);
              addOnce(window, 'scroll', positionBox, true);

            } catch(e) {}

            // Malzeme seçimi event listener
            const malzemeSelect = document.getElementById('malzemeSelect');
            const malzemeInput = document.getElementById('malzeme');
            
            if (malzemeSelect && malzemeInput) {
                addOnce(malzemeSelect, 'change', function() {
                    if (this.value) {
                        malzemeInput.value = this.value;
                    }
                });
                
                addOnce(malzemeInput, 'input', function() {
                    if (this.value) {
                        malzemeSelect.value = '';
                    }
                });
            }

            // Firma seçimi event listener - ✅ PROMPT YOK: Çoklu malzeme varsa dropdown ile seçilecek
const firmaSelect = document.getElementById('firmaSelect');
const firmaInput  = document.getElementById('firmaKodu');

const malzemeInput2  = document.getElementById('malzeme');
const malzemeSelect2 = document.getElementById('malzemeSelect');
const ambalajInput   = document.getElementById('ambalajBilgisi');
const notTextarea    = document.getElementById('yuklemeNotu');

// 🔧 Global ref: takip formundaki sevkYeri input'u (showTakipFormu içinde set edilir)
let sevkYeriInput = null;

// Malzeme dropdown'u "tam liste"ye döndürmek için
const buildFullMalzemeOptionsHTML = () => {
  return `<option value="">Seçiniz veya elle yazın</option>` + (malzemeListesi || [])
    .map(m => `<option value="${m}">${m}</option>`).join('');
};

let currentFirmaMatches = [];

const applyMatch = (es) => {
  if (!es) return;
  if (malzemeInput2)  malzemeInput2.value = es.malzeme || '';
  if (malzemeSelect2) malzemeSelect2.value = es.malzeme || '';
  if (ambalajInput)   ambalajInput.value = es.ambalajBilgisi || '';
  if (notTextarea)    notTextarea.value = es.yuklemeNotu || '';
  if (sevkYeriInput)  sevkYeriInput.value = es.sevkYeri || '';
};

const resetMatchFields = () => {
  if (malzemeInput2)  malzemeInput2.value = '';
  if (ambalajInput)   ambalajInput.value = '';
  if (notTextarea)    notTextarea.value = '';
  if (sevkYeriInput)  sevkYeriInput.value = '';
};

// Firmaya göre eşleşme uygula (PROMPT YOK)
const handleFirma = (firma) => {
  const f = (firma || '').trim();
  currentFirmaMatches = (f && eslestirmeStorage.getByFirma) ? (eslestirmeStorage.getByFirma(f) || []) : [];

  if (!malzemeSelect2) return;

  // Eşleşme yoksa: malzeme dropdown'u full listeye dönsün, alanları otomatik doldurma
  if (currentFirmaMatches.length === 0) {
    malzemeSelect2.innerHTML = buildFullMalzemeOptionsHTML();
    return;
  }

  // Eşleşme varsa: dropdown'u sadece o firmaya ait malzemelerle doldur
  malzemeSelect2.innerHTML =
    `<option value="">Malzeme Seçiniz</option>` +
    currentFirmaMatches.map(es => `<option value="${es.malzeme}">${es.malzeme}</option>`).join('');

  // Tek eşleşme varsa otomatik uygula
  if (currentFirmaMatches.length === 1) {
    applyMatch(currentFirmaMatches[0]);
  } else {
    // Çokluysa kullanıcı dropdown'dan seçsin
    resetMatchFields();
  }
};

if (firmaSelect && firmaInput) {
  firmaSelect.addEventListener('change', function () {
    const val = this.value || '';
    firmaInput.value = val;
    handleFirma(val);
  });

  firmaInput.addEventListener('input', function () {
    const val = (this.value || '').trim();
    firmaSelect.value = '';
    handleFirma(val);
  });
}

// Malzeme seçilince eşleşme varsa otomatik uygula
if (malzemeSelect2) {
  malzemeSelect2.addEventListener('change', function () {
    const secilen = this.value || '';

    // Normal davranış: dropdown seçimini input'a yaz
    if (malzemeInput2 && secilen) malzemeInput2.value = secilen;

    if (!secilen || currentFirmaMatches.length === 0) return;

    const es = currentFirmaMatches.find(e => (e.malzeme || '') === secilen);
    if (es) applyMatch(es);
  });
}


// 🔎 Takip Formu: Firma/Malzeme hızlı arama (buton)
// - Input'a "HP" yaz -> Bul -> listeden seç
function _openQuickPick({ title, query, options, onPick }) {
  const escapeHtml = (s)=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

  const all = (options || []).filter(Boolean).map(x => String(x));
  const initial = String(query || '').trim();

  // Eğer hiç sonuç yoksa
  if (all.length === 0) { alert('❌ Sonuç bulunamadı.'); return; }
  // Tek sonuç varsa direkt seç
  if (all.length === 1) { onPick(all[0]); return; }

  // Öncekini kapat
  const overlayId = 'quickPickOverlay';
  const old = document.getElementById(overlayId);
  if (old) old.remove();

  // Siyah arka plan YOK: sadece küçük modal (arka plan transparent)
  const overlay = document.createElement('div');
  overlay.id = overlayId;
  overlay.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:1000001',
    'background:transparent',
    'display:flex',
    'align-items:flex-start',
    'justify-content:center',
    'padding:16px',
    'pointer-events:auto'
  ].join(';') + ';';

  const card = document.createElement('div');
  card.style.cssText = [
    'width:min(520px, 94vw)',
    'margin-top:10vh',
    'background:#fff',
    'border:1px solid #e5e7eb',
    'border-radius:12px',
    'box-shadow:0 10px 30px rgba(0,0,0,.18)',
    'overflow:hidden'
  ].join(';') + ';';

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #e5e7eb;';
  header.innerHTML = `<strong style="font-size:14px;">${title || 'Seç'}</strong>`;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'border:none;background:transparent;font-size:16px;cursor:pointer;opacity:.75;';
  closeBtn.onmouseenter = ()=> closeBtn.style.opacity = '1';
  closeBtn.onmouseleave = ()=> closeBtn.style.opacity = '.75';
  header.appendChild(closeBtn);

  const searchWrap = document.createElement('div');
  searchWrap.style.cssText = 'padding:10px 12px;border-bottom:1px solid #f3f4f6;';
  const input = document.createElement('input');
  input.type = 'text';
  input.value = initial;
  input.placeholder = 'Ara... (HP, HP2 gibi yaz)';
  input.className = 'form-input';
  input.style.cssText = 'width:100%;height:8mm;font-weight:bold;';
  searchWrap.appendChild(input);

  const listWrap = document.createElement('div');
  listWrap.style.cssText = 'max-height:55vh;overflow:auto;';

  const hint = document.createElement('div');
  hint.style.cssText = 'padding:8px 12px;color:#6b7280;font-size:12px;border-top:1px solid #f3f4f6;';
  hint.textContent = '↑↓ ile gez, Enter ile seç, Esc ile kapat';

  card.appendChild(header);
  card.appendChild(searchWrap);
  card.appendChild(listWrap);
  card.appendChild(hint);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  // ✅ Aday listelerini doldur (sevk yeri / ambalaj)
  try {
    const ambC = (candidates && Array.isArray(candidates.ambalaj)) ? candidates.ambalaj : [];
    const sevC = (candidates && Array.isArray(candidates.sevkYeri)) ? candidates.sevkYeri : [];

    const selAmb = card.querySelector('#xr_ambalajCand');
    const selSev = card.querySelector('#xr_sevkYeriCand');

    const addOpts = (sel, arr) => {
      if (!sel) return;
      for (const v of (arr || [])) {
        const opt = document.createElement('option');
        opt.value = String(v || '');
        opt.textContent = String(v || '');
        sel.appendChild(opt);
      }
    };

    addOpts(selSev, sevC);
    addOpts(selAmb, ambC);

    // seçilince inputu doldur
    if (selSev) selSev.addEventListener('change', () => {
      const v = selSev.value || '';
      if (v) {
        const inp = card.querySelector('#xr_sevkYeri');
        if (inp) inp.value = v;
      }
    });
    if (selAmb) selAmb.addEventListener('change', () => {
      const v = selAmb.value || '';
      if (v) {
        const inp = card.querySelector('#xr_ambalaj');
        if (inp) inp.value = v;
      }
    });
  } catch(e){}

  // ✅ Aynı Excel oturumunda hızlı doldurma: YD/Firma anahtarına göre
  try {
    const key = normalizeYdKey(ydKey || chosen?.ydKey || chosen?.firma || '');
    if (key) {
      if (!window.__quickDefaultsByKey) window.__quickDefaultsByKey = {};
      const d = window.__quickDefaultsByKey[key];
      if (d) {
        const sevInp = card.querySelector('#xr_sevkYeri');
        const ambInp = card.querySelector('#xr_ambalaj');
        if (sevInp && !String(sevInp.value||'').trim() && String(d.sevkYeri||'').trim()) sevInp.value = d.sevkYeri;
        if (ambInp && !String(ambInp.value||'').trim() && String(d.ambalaj||'').trim()) ambInp.value = d.ambalaj;
      }
    }
  } catch(e){}

  let filtered = [];
  let activeIndex = 0;

  const render = () => {
    const q = (input.value || '').trim().toLowerCase();
    filtered = q ? all.filter(x => x.toLowerCase().includes(q)) : all.slice();

    // 0 sonuç
    if (filtered.length === 0) {
      listWrap.innerHTML = `<div style="padding:12px;color:#6b7280;">Sonuç yok</div>`;
      activeIndex = 0;
      return;
    }

    // Çok uzun olmasın
    const show = filtered.slice(0, 200);
    listWrap.innerHTML = show.map((val, i) => {
      const active = i === activeIndex ? 'background:#f3f4f6;' : '';
      return `<button type="button" data-idx="${i}" style="width:100%;text-align:left;padding:10px 12px;border:none;background:transparent;cursor:pointer;${active}">${escapeHtml(val)}</button>`;
    }).join('');
  };

  const pick = (val) => {
    try { onPick(val); } catch(e) { console.error(e); }
    const el = document.getElementById(overlayId);
    if (el) el.remove();
  };

  // Click outside closes
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  closeBtn.addEventListener('click', ()=> overlay.remove());

  listWrap.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-idx]');
    if (!btn) return;
    const i = parseInt(btn.getAttribute('data-idx'), 10);
    const val = (filtered || [])[i];
    if (val) pick(val);
  });

  input.addEventListener('input', () => { activeIndex = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { overlay.remove(); return; }
    if (!filtered || filtered.length === 0) return;

    if (e.key === 'ArrowDown') { e.preventDefault(); activeIndex = Math.min(activeIndex + 1, Math.min(filtered.length, 200) - 1); render(); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); activeIndex = Math.max(activeIndex - 1, 0); render(); return; }
    if (e.key === 'Enter') { e.preventDefault(); const val = filtered[activeIndex]; if (val) pick(val); return; }
  });

  // İlk render
  render();
  setTimeout(()=> { input.focus(); input.select(); }, 0);
}

// ✅ Takip Formu: Çekici Plaka "Bul" ekranı (Firma/Malzeme Bul ile aynı UX)
// - Arama kutusu + liste + her satırda "GETİR" butonu
// - Login / Excel okuma tarafına dokunmaz
function _openPlatePick({ title='Çekici Plaka Seç', query='', options=[], onPick }) {
  const escapeHtml = (s)=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

  const all = (options || []).filter(Boolean).map(x => String(x));
  const initial = String(query || '').trim();

  if (all.length === 0) { alert('❌ Kayıtlı çekici plaka bulunamadı.'); return; }

  const overlayId = 'quickPickOverlay_plate';
  const old = document.getElementById(overlayId);
  if (old) old.remove();

  const overlay = document.createElement('div');
  overlay.id = overlayId;
  overlay.style.cssText = [
    'position:fixed','inset:0','z-index:1000002','background:transparent',
    'display:flex','align-items:flex-start','justify-content:center','padding:16px','pointer-events:auto'
  ].join(';') + ';';

  const card = document.createElement('div');
  card.style.cssText = [
    'width:min(620px, 96vw)','margin-top:10vh','background:#fff','border:1px solid #e5e7eb',
    'border-radius:12px','box-shadow:0 10px 30px rgba(0,0,0,.18)','overflow:hidden'
  ].join(';') + ';';

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #e5e7eb;';
  header.innerHTML = `<strong style="font-size:14px;">${escapeHtml(title || 'Çekici Plaka Seç')}</strong>`;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'border:none;background:transparent;font-size:16px;cursor:pointer;opacity:.75;';
  closeBtn.onmouseenter = ()=> closeBtn.style.opacity = '1';
  closeBtn.onmouseleave = ()=> closeBtn.style.opacity = '.75';
  header.appendChild(closeBtn);

  const searchWrap = document.createElement('div');
  searchWrap.style.cssText = 'padding:10px 12px;border-bottom:1px solid #f3f4f6;';
  const input = document.createElement('input');
  input.type = 'text';
  input.value = initial;
  input.placeholder = 'Plaka ara... (06, 34ABC123 gibi)';
  input.className = 'form-input';
  input.style.cssText = 'width:100%;height:8mm;font-weight:bold;';
  searchWrap.appendChild(input);

  const listWrap = document.createElement('div');
  listWrap.style.cssText = 'max-height:55vh;overflow:auto;';

  const hint = document.createElement('div');
  hint.style.cssText = 'padding:8px 12px;color:#6b7280;font-size:12px;border-top:1px solid #f3f4f6;';
  hint.textContent = '↑↓ ile gez, Enter ile GETİR, Esc ile kapat';

  card.appendChild(header);
  card.appendChild(searchWrap);
  card.appendChild(listWrap);
  card.appendChild(hint);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  // ✅ Aday listelerini doldur (sevk yeri / ambalaj)
  try {
    const ambC = (candidates && Array.isArray(candidates.ambalaj)) ? candidates.ambalaj : [];
    const sevC = (candidates && Array.isArray(candidates.sevkYeri)) ? candidates.sevkYeri : [];

    const selAmb = card.querySelector('#xr_ambalajCand');
    const selSev = card.querySelector('#xr_sevkYeriCand');

    const addOpts = (sel, arr) => {
      if (!sel) return;
      for (const v of (arr || [])) {
        const opt = document.createElement('option');
        opt.value = String(v || '');
        opt.textContent = String(v || '');
        sel.appendChild(opt);
      }
    };

    addOpts(selSev, sevC);
    addOpts(selAmb, ambC);

    // seçilince inputu doldur
    if (selSev) selSev.addEventListener('change', () => {
      const v = selSev.value || '';
      if (v) {
        const inp = card.querySelector('#xr_sevkYeri');
        if (inp) inp.value = v;
      }
    });
    if (selAmb) selAmb.addEventListener('change', () => {
      const v = selAmb.value || '';
      if (v) {
        const inp = card.querySelector('#xr_ambalaj');
        if (inp) inp.value = v;
      }
    });
  } catch(e){}

  // ✅ Aynı Excel oturumunda hızlı doldurma: YD/Firma anahtarına göre
  try {
    const key = normalizeYdKey(ydKey || chosen?.ydKey || chosen?.firma || '');
    if (key) {
      if (!window.__quickDefaultsByKey) window.__quickDefaultsByKey = {};
      const d = window.__quickDefaultsByKey[key];
      if (d) {
        const sevInp = card.querySelector('#xr_sevkYeri');
        const ambInp = card.querySelector('#xr_ambalaj');
        if (sevInp && !String(sevInp.value||'').trim() && String(d.sevkYeri||'').trim()) sevInp.value = d.sevkYeri;
        if (ambInp && !String(ambInp.value||'').trim() && String(d.ambalaj||'').trim()) ambInp.value = d.ambalaj;
      }
    }
  } catch(e){}

  let filtered = [];
  let activeIndex = 0;

  const render = () => {
  const q = (input.value || '').trim().toLowerCase();

  // Arama değiştiyse: tekrar 20'ye dön + index sıfırla
  if (q !== state.lastQuery) {
    state.lastQuery = q;
    state.visibleCount = state.pageSize;
    activeIndex = 0;
  }

  filtered = q ? all.filter(x => x.toLowerCase().includes(q)) : all.slice();
  state.lastTotal = filtered.length;

  const btn = document.getElementById('showMoreButton');

  // 0 sonuç
  if (filtered.length === 0) {
    listWrap.innerHTML = `<div style="padding:12px;color:#6b7280;">Sonuç yok</div>`;
    activeIndex = 0;
    if (btn) btn.style.display = 'none';
    return;
  }

  // Gösterilecek kayıt sayısı (20,40,60... max toplam)
  const visible = filtered.slice(0, Math.min(state.visibleCount, filtered.length));

  // activeIndex görünür aralığın dışına taşmasın
  if (activeIndex >= visible.length) activeIndex = 0;

  listWrap.innerHTML = visible.map((val, i) => {
    const active = i === activeIndex ? 'background:#f3f4f6;' : '';
    return `<button type="button" data-idx="${i}" style="width:100%;text-align:left;padding:10px 12px;border:none;background:transparent;cursor:pointer;${active}">${escapeHtml(val)}</button>`;
  }).join('');

  // Buton: toplam 20'den fazlaysa göster, metin güncelle
  if (btn) {
    if (filtered.length <= state.pageSize) {
      btn.style.display = 'none';
    } else {
      btn.style.display = '';
      btn.textContent =
        (state.visibleCount >= filtered.length)
          ? 'Gizle'
          : `Devamını Göster (+${state.pageSize})`;
    }
  }
};

  const pick = (val) => {
    try { onPick(val); } catch(e) { console.error(e); }
    const el = document.getElementById(overlayId);
    if (el) el.remove();
  };

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  closeBtn.addEventListener('click', ()=> overlay.remove());

  listWrap.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-getir]');
    if (btn) {
      const i = parseInt(btn.getAttribute('data-getir'), 10);
      const val = (filtered || [])[i];
      if (val) pick(val);
      return;
    }
    const row = e.target.closest('div[data-idx]');
    if (!row) return;
    const i = parseInt(row.getAttribute('data-idx'), 10);
    const val = (filtered || [])[i];
    if (val) pick(val);
  });

  input.addEventListener('input', () => { activeIndex = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { overlay.remove(); return; }
    if (!filtered || filtered.length === 0) return;

    if (e.key === 'ArrowDown') { e.preventDefault(); activeIndex = Math.min(activeIndex + 1, Math.min(filtered.length, 200) - 1); render(); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); activeIndex = Math.max(activeIndex - 1, 0); render(); return; }
    if (e.key === 'Enter') { e.preventDefault(); const val = filtered[activeIndex]; if (val) pick(val); return; }
  });

  render();
  setTimeout(()=> { input.focus(); input.select(); }, 0);
}

try {
  const firmaAraBtn = document.getElementById('firmaAraBtn');
  const malzemeAraBtn = document.getElementById('malzemeAraBtn');

  const firmaKoduEl = document.getElementById('firmaKodu');
  const malzemeEl = document.getElementById('malzeme');

  if (firmaAraBtn) addOnce(firmaAraBtn, 'click', ()=>{
    // PİYASA yüklüyse: firma seçmek yerine sipariş listesi aç
    try {
      if (window.piyasa && typeof window.piyasa.hasOrders === 'function' && window.piyasa.hasOrders()) {
        window.piyasa.openOrderPicker();
        return;
      }
    } catch(_) {}
    const q = (document.getElementById('firmaKodu')?.value || '').trim();
    const opts = (firmaListesi || []).map(f => getFirmaKodOnly(f)).filter(Boolean);
    _openQuickPick({
      title: 'Firma/Müşteri Kodu Seç',
      query: q,
      options: opts,
      onPick: (val)=>{
        if (firmaInput) { firmaInput.value = val; handleFirma(val); }
        if (firmaSelect) firmaSelect.value = '';
      }
    });
  });

  if (malzemeAraBtn) addOnce(malzemeAraBtn, 'click', ()=>{
    const q = (document.getElementById('malzeme')?.value || '').trim();
    const opts = (malzemeListesi || []).slice();
    _openQuickPick({
      title: 'Malzeme Seç',
      query: q,
      options: opts,
      onPick: (val)=>{
        if (malzemeInput2) malzemeInput2.value = val;
        if (malzemeSelect2) malzemeSelect2.value = val;
        // Eşleşme uygula (varsa)
        if (currentFirmaMatches && currentFirmaMatches.length) {
          const es = currentFirmaMatches.find(e => (e.malzeme || '') === val);
          if (es) applyMatch(es);
        }
      }
    });
  });

  // ⌨️ Enter ile "Bul" çalıştır (HP yaz -> Enter)
  if (firmaKoduEl) addOnce(firmaKoduEl, 'keydown', (e)=>{ if (e.key === 'Enter') { e.preventDefault(); firmaAraBtn?.click(); } });
  if (malzemeEl) addOnce(malzemeEl, 'keydown', (e)=>{ if (e.key === 'Enter') { e.preventDefault(); malzemeAraBtn?.click(); } });

} catch(e){}


            // Modal'ı göster
            // ⛔ Datalist önerileri kapatıldı (siyah öneri kutusu çıkmasın)
            // ✅ Kullanıcı seçim/yazım yaptıkça hafızaya al (rahatsız etmez)
            const firmaKoduInput = document.getElementById('firmaKodu');
            const malzemeInput3 = document.getElementById('malzeme');
            sevkYeriInput = document.getElementById('sevkYeri');

            // ✅ İSTEK: Takip formu her açılışta BOŞ (Excel okuma doldurur).
            try { resetTakipFormUI(); } catch (e) {}

            // ✅ İSTEK: Takip formu BUTONUNA basınca YÜKLEME SIRASI boş gelmesin.
            // Burada sadece ekranda gösterilecek değer atanır; sayaç/arttırma yapılmaz.
            try {
              const ysEl = document.getElementById('yuklemeSirasi');
              if (ysEl && !(ysEl.value || '').trim()) {
                const snapYS = (vehicle && vehicle.lastPrintSnapshot && vehicle.lastPrintSnapshot.yuklemeSirasi)
                  ? String(vehicle.lastPrintSnapshot.yuklemeSirasi).trim()
                  : '';
                if (snapYS && /^\d+$/.test(snapYS)) ysEl.value = snapYS;
                else ysEl.value = String(getSuggestedYuklemeSirasi());
              }
            } catch(e) {}

            // ✅ Enter ile alanlar arasında dolaş
            enableEnterNavigation(document.getElementById('takipFormuModal') || formContainer);

            document.getElementById('takipFormuModal').classList.remove('hidden');

            // ✅ İlk odağı ver: bazen odak kaçıp yazı yazmıyor gibi görünebiliyor
            setTimeout(()=>{ try { document.getElementById('soforBilgi')?.focus(); } catch(_) {} }, 0);

            // 📄 Günlük Excel varsa otomatik doldur (plaka eşleşmesi)
            try { applyShipmentToTakipForm(vehicle); } catch(e) {}

}

        // Takip Formunu Kapat
        function kapatForm() {
            try { document.getElementById('quickPickOverlay')?.remove(); } catch(_) {}
            try { const psb = document.getElementById('plateSearchBox'); if (psb) { psb.style.display = 'none'; psb.innerHTML=''; } } catch(_) {}
            document.getElementById('takipFormuModal').classList.add('hidden');
            
        }

        // =========================
        // ✅ Takip Formu: zorunlu alan kontrolü + yazdırınca otomatik temizleme
        // =========================
        function _clearTakipFormErrors(){
            try {
                document.querySelectorAll('#takipFormuModal .input-error').forEach(el => el.classList.remove('input-error'));
            } catch(e){}
            const w = document.getElementById('takipFormWarn');
            if (w) { w.classList.add('hidden'); w.textContent = ''; }
        }

        function resetTakipFormUI(){
            _clearTakipFormErrors();
            // ✅ KANTAR ismi/ imzası kullanıcı değiştirene kadar kalsın
            // (form temizlenirken silme; yazdırırken tekrar seçim istemesin)
            let keepKantar = '';
            try {
                keepKantar = (document.getElementById('imzaKantarAd')?.value || '').trim();
                if (!keepKantar) keepKantar = (loadSavedKantarName() || '').trim();
            } catch(e) { keepKantar = ''; }

            const ids = [
                'firmaKodu','malzeme','sevkYeri','tonaj','ambalajBilgisi','seperatorBilgisi',
                'bbt','bosBbt','cuval','bosCuval','palet','torba',
                'yuklemeNotu','yuklemeSirasi',
                // imzaKantarAd bilerek temizlenmiyor
                'imzaSahaAd','imzaYukleyenAd','imzaKaliteAd'
            ];
            ids.forEach(id => {
                const el = document.getElementById(id);
                if (!el) return;
                const tag = (el.tagName || '').toLowerCase();
                if (tag === 'select') el.value = '';
                else el.value = '';
            });

            // ✅ KANTAR'ı geri uygula + önizlemeyi güncelle
            try {
                const k = document.getElementById('imzaKantarAd');
                if (k && keepKantar) k.value = keepKantar;
                if (k) { persistKantarName(k.value); }
                refreshKantarSignaturePreview();
            } catch(e) {}

            // dropdown'ları da sıfırla
            try { const fs = document.getElementById('firmaSelect'); if (fs) fs.value = ''; } catch(e){}
            try { const ms = document.getElementById('malzemeSelect'); if (ms) ms.value = ''; } catch(e){}
        }

        function validateTakipForm(){
            _clearTakipFormErrors();

            const required = [
                { id:'firmaKodu', label:'Firma/Müşteri Kodu' },
                { id:'malzeme',   label:'Malzeme' },
                { id:'sevkYeri',  label:'Sevk Yeri' }
            ];

            const missing = [];
            let firstEl = null;

            required.forEach(r => {
                const el = document.getElementById(r.id);
                const val = (el && 'value' in el) ? String(el.value || '').trim() : '';
                if (!val) {
                    missing.push(r.label);
                    if (el) {
                        el.classList.add('input-error');
                        if (!firstEl) firstEl = el;
                    }
                }
            });

            if (missing.length) {
                const w = document.getElementById('takipFormWarn');
                if (w) {
                    w.textContent = '⚠️ Zorunlu alanlar eksik: ' + missing.join(', ');
                    w.classList.remove('hidden');
                } else {
                    alert('⚠️ Zorunlu alanlar eksik: ' + missing.join(', '));
                }
                try { firstEl && firstEl.focus(); } catch(e){}
                return false;
            }

            return true;
        }


        // ✅ Takip Formu'nda kullanıcı manuel düzeltme yapınca
        //    aynı Firma+Malzeme için eşleştirmeyi otomatik günceller (Ambalaj/Not/SevkYeri).
        function upsertEslestirmeFromTakipForm(){
            try {
                const firma = (document.getElementById('firmaKodu')?.value || '').trim();
                const malzeme = (document.getElementById('malzeme')?.value || '').trim();
                if (!firma || !malzeme) return;

                const ambalajBilgisi = (document.getElementById('ambalajBilgisi')?.value || '').trim();
                const yuklemeNotu = (document.getElementById('yuklemeNotu')?.value || '').trim();
                const sevkYeri = (document.getElementById('sevkYeri')?.value || '').trim();

                const existing = eslestirmeListesi.find(es => es.firma === firma && es.malzeme === malzeme);
                if (existing && existing.id) {
                    // Sadece boş değilse üzerine yaz
                    const patch = {};
                    if (ambalajBilgisi) patch.ambalajBilgisi = ambalajBilgisi;
                    if (yuklemeNotu) patch.yuklemeNotu = yuklemeNotu;
                    if (sevkYeri) patch.sevkYeri = sevkYeri;
                    if (Object.keys(patch).length) eslestirmeStorage.update(existing.id, patch);
                } else {
                    eslestirmeStorage.add(firma, malzeme, ambalajBilgisi, yuklemeNotu, sevkYeri);
                }
            } catch(e){}
        }

        // ✅ Takip Formu'nda şoför bilgilerini plaka bazlı hafızaya yaz
        // - Bu sayede aynı plakaya birden fazla şoför geldiğinde hızlı seçim yapılabilir.
        function saveSoforHistoryFromTakipForm() {
            try {
                const plakaEl = document.getElementById('cekiciPlakaBilgi');
                const plaka = plakaEl ? (('value' in plakaEl) ? plakaEl.value : plakaEl.textContent) : '';
                const plate = formatPlakaForInput(String(plaka || '')).trim();
                if (!plate) return;

                const nameEl = document.getElementById('soforBilgi');
                const tcEl = document.getElementById('tcBilgi');
                const telEl = document.getElementById('iletisimBilgi');

                const name = nameEl ? (('value' in nameEl) ? nameEl.value : nameEl.textContent) : '';
                const tc = tcEl ? (('value' in tcEl) ? tcEl.value : tcEl.textContent) : '';
                const telRaw = telEl ? (('value' in telEl) ? telEl.value : telEl.textContent) : '';
                const tel = formatTRPhone(String(telRaw || ''));

                soforHistoryStorage.add(plate, { name: String(name || '').trim(), tc: String(tc || '').trim(), phone: String(tel || '').trim() });
            } catch (e) {
                // sessiz
            }
        }


        // Print penceresi (print.js) yazdırma bittikten sonra bunu çağırır
        window.afterTakipPrint = function(){
            // Not: afterprint olayı "Yazdır" ve "İptal" için aynı çalışabilir.
            // Bu yüzden kullanıcıdan kısa bir onay alıp ancak o zaman sayaç/printCount gibi
            // kalıcı değişiklikleri yapıyoruz.

            try { window.__afterTakipPrintRequested = false; } catch(e){}

            const pending = window.__pendingPrintCommit;
            if (pending) {
                let ok = false;
                try {
                    ok = confirm(
                      'Yazdırma penceresinde TARAYICI "Yazdır" butonuna basıp çıktı aldın mı?\n\n' +
                      'EVET = Yükleme sırası kesinleşir / sayaç ilerler.\n' +
                      'HAYIR = Hiçbir şey değişmez (tekrar yazdırabilirsin).'
                    );
                } catch(e) { ok = false; }

                if (!ok) {
                    // değişiklik yapma, form açık kalsın
                    try {
                        const w = document.getElementById('takipFormWarn');
                        if (w) {
                            w.textContent = '⚠️ Yazdırma iptal edildi. Yükleme sırası ve sayaç değiştirilmedi.';
                            w.classList.remove('hidden');
                        }
                    } catch(e) {}
                    try { window.__pendingPrintCommit = null; } catch(e) {}
                    return;
                }

                // ✅ 1) Yükleme sırası sayacını kesinleştir (günlük)
                try {
                    const ys = parseInt(String(pending.yuklemeSirasi || '').trim() || '0', 10);
                    if (Number.isFinite(ys) && ys >= 1) {
                        const d = new Date();
                        const todayKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
                        localStorage.setItem('yuklemeSirasiDate', todayKey);
                        localStorage.setItem('yuklemeSirasiCounter', String(ys));
                    }
                } catch(e) {}

                // ✅ 2) Yazdırma raporu + printCount kesinleştir
                try {
                    const vid = String(pending.vehicleId || '').trim();
                    const nowTs = pending.nowTs || Date.now();
                    if (vid && vid !== 'manual') {
                        const cur = (state.vehicles || []).find(v => String(v.id) === String(vid));
                        if (cur) {
                            const nextCount = (parseInt(cur.printCount || '0', 10) || 0) + 1;
                            const snap = pending.snapshot || cur.lastPrintSnapshot || null;
                            const updated = { ...cur, printCount: nextCount, lastPrintedAt: nowTs, lastPrintSnapshot: snap };
                            try { window.storage?.save('vehicle_' + updated.id, updated); } catch(e) {}
                            state.vehicles = (state.vehicles || []).map(v => String(v.id) === String(updated.id) ? updated : v);

                            try {
                                window.Report?.addEvent('PRINT', {
                                    vehicleId: updated.id,
                                    plaka: updated.cekiciPlaka || pending.plaka || '',
                                    kayitTarihi: updated.kayitTarihi || '',
                                    printCount: nextCount,
                                    lastPrintedAt: nowTs
                                });
                            } catch(e) {}
                        }
                    } else {
                        try {
                            window.Report?.addEvent('PRINT', {
                                vehicleId: vid || 'manual',
                                plaka: pending.plaka || '',
                                printCount: 1,
                                lastPrintedAt: nowTs
                            });
                        } catch(e) {}
                    }
                } catch(e) {}

                try { window.__pendingPrintCommit = null; } catch(e) {}
            }

            try { resetTakipFormUI(); } catch(e){}
            try { kapatForm(); } catch(e){}
        };


        // Takip Formunu Yazdır (print.js içine taşındı)


        // Firma Yönetim Modalını Göster
        function showFirmaYonetimModal() {
            const modal = document.getElementById('firmaYonetimModal');
            const firmaListesiContainer = document.getElementById('firmaListesi');
            
            // Firma listesini doldur
            firmaListesiContainer.innerHTML = '';
            
            if (firmaListesi.length === 0) {
                firmaListesiContainer.innerHTML = '<div class="p-4 text-center text-gray-500">Henüz firma eklenmemiş.</div>';
            } else {
                firmaListesi.forEach((firma, index) => {
                    const firmaItem = document.createElement('div');
                    firmaItem.className = 'firma-item';
                    firmaItem.innerHTML = `
                        <span>${firma}</span>
                        <div class="firma-actions">
                            <button class="firma-duzenle-btn text-blue-600 hover:text-blue-800" data-index="${index}">
                                ✏️
                            </button>
                            <button class="firma-sil-btn text-red-600 hover:text-red-800" data-index="${index}">
                                🗑️
                            </button>
                        </div>
                    `;
                    firmaListesiContainer.appendChild(firmaItem);
                });
            }
            
            // Event listener'ları ekle
            document.querySelectorAll('.firma-duzenle-btn').forEach(btn => {
                btn.addEventListener('click', function() {
                    const index = parseInt(this.getAttribute('data-index'));
                    const yeniFirma = prompt('Firma adını düzenleyin:', firmaListesi[index]);
                    if (yeniFirma && yeniFirma.trim() !== '') {
                        if (firmaStorage.update(index, yeniFirma.trim())) {
                            showFirmaYonetimModal(); // Listeyi yenile
                        } else {
                            alert('Firma düzenlenirken bir hata oluştu!');
                        }
                    }
                });
            });
            
            document.querySelectorAll('.firma-sil-btn').forEach(btn => {
                btn.addEventListener('click', function() {
                    const index = parseInt(this.getAttribute('data-index'));
                    if (confirm(`"${firmaListesi[index]}" firmasını silmek istediğinizden emin misiniz?`)) {
                        if (firmaStorage.delete(index)) {
                            showFirmaYonetimModal(); // Listeyi yenile
                        } else {
                            alert('Firma silinirken bir hata oluştu!');
                        }
                    }
                });
            });
            
            // Modal'ı göster
            modal.classList.remove('hidden');
        }

        // Eşleştirme Modalını Göster
        function showEslestirmeModal() {
            const modal = document.getElementById('eslestirmeModal');
            // Eşleştirme özelliği kaldırıldı: modal yoksa hiçbir şey yapma
            if (!modal) { try{ showToast && showToast('ℹ️ Eşleştirme kaldırıldı. Excel okuma ile devam.'); }catch(e){} return; }
            const eslestirmeListesiContainer = document.getElementById('eslestirmeListesi');
            const firmaSelect = document.getElementById('eslestirmeFirmaSelect');
            const malzemeSelect = document.getElementById('eslestirmeMalzemeSelect');
            const firmaInput = document.getElementById('eslestirmeFirmaInput');
            const malzemeInput = document.getElementById('eslestirmeMalzemeInput');
            
            // Inputları temizle
            firmaInput.value = '';
            malzemeInput.value = '';
            
            // Select'leri doldur
            firmaSelect.innerHTML = '<option value="">Firma seçin</option>';
            firmaListesi.forEach(firma => {
                firmaSelect.innerHTML += `<option value="${getFirmaKodOnly(firma)}">${getFirmaKodOnly(firma)}</option>`;
            });
            
            malzemeSelect.innerHTML = '<option value="">Malzeme seçin</option>';
            malzemeListesi.forEach(malzeme => {
                malzemeSelect.innerHTML += `<option value="${malzeme}">${malzeme}</option>`;
            });
            
            // Select değişikliklerini dinle
            addOnce(firmaSelect, 'change', function() {
                if (this.value) {
                    firmaInput.value = '';
                }
            });
            
            addOnce(malzemeSelect, 'change', function() {
                if (this.value) {
                    malzemeInput.value = '';
                }
            });
            
            // Input değişikliklerini dinle
            addOnce(firmaInput, 'input', function() {
                if (this.value) {
                    firmaSelect.value = '';
                }
            });
            
            addOnce(malzemeInput, 'input', function() {
                if (this.value) {
                    malzemeSelect.value = '';
                }
            });
            
            // Eşleştirme listesini doldur
            eslestirmeListesiContainer.innerHTML = '';
            
            if (eslestirmeListesi.length === 0) {
                eslestirmeListesiContainer.innerHTML = '<div class="p-4 text-center text-gray-500">Henüz eşleştirme eklenmemiş.</div>';
            } else {
                eslestirmeListesi.forEach((eslestirme, index) => {
                    const eslestirmeItem = document.createElement('div');
                    eslestirmeItem.className = 'eslestirme-item';
                    eslestirmeItem.innerHTML = `
  <div>
    <div><strong>Firma:</strong> ${eslestirme.firma}</div>
    <div><strong>Malzeme:</strong> ${eslestirme.malzeme}</div>
    ${eslestirme.ambalajBilgisi ? `<div><strong>Ambalaj:</strong> ${eslestirme.ambalajBilgisi}</div>` : ''}
    ${eslestirme.sevkYeri ? `<div><strong>Sevk Yeri:</strong> ${eslestirme.sevkYeri}</div>` : ''}
    ${eslestirme.yuklemeNotu ? `<div><strong>Not:</strong> ${eslestirme.yuklemeNotu}</div>` : ''}
  </div>
  <div class="eslestirme-actions">
    <button class="eslestirme-duzenle-btn text-blue-600 hover:text-blue-800" data-id="${eslestirme.id}">
      ✏️
    </button>
    <button class="eslestirme-sil-btn text-red-600 hover:text-red-800" data-id="${eslestirme.id}">
      🗑️
    </button>
  </div>
`;

                    eslestirmeListesiContainer.appendChild(eslestirmeItem);
                });
            }
            
            // Event listener'ları ekle
            document.querySelectorAll('.eslestirme-sil-btn').forEach(btn => {
  btn.addEventListener('click', function() {
    const id = this.getAttribute('data-id');
    const es = eslestirmeListesi.find(x => x.id === id);
    if (!es) return;

    if (confirm(`"${es.firma}" - "${es.malzeme}" eşleştirmesini silmek istediğinizden emin misiniz?`)) {
      if (eslestirmeStorage.delete(id)) showEslestirmeModal();
      else alert('Eşleştirme silinirken bir hata oluştu!');
    }
  });
});
        

document.querySelectorAll('.eslestirme-duzenle-btn').forEach(btn => {
  btn.addEventListener('click', function() {
    const id = this.getAttribute('data-id');
    const es = eslestirmeListesi.find(x => x.id === id);
    if (!es) return;

    const yeniFirma = prompt('Firma:', es.firma);
    if (yeniFirma === null) return;

    const yeniMalzeme = prompt('Malzeme:', es.malzeme);
    if (yeniMalzeme === null) return;

    const yeniAmbalaj = prompt('Ambalaj Bilgisi (varsayılan):', es.ambalajBilgisi || '');
    if (yeniAmbalaj === null) return;

    const yeniSevk = prompt('Sevk Yeri (varsayılan):', es.sevkYeri || '');
    if (yeniSevk === null) return;

    const yeniNot = prompt('Yükleme Notu (varsayılan):', es.yuklemeNotu || '');
    if (yeniNot === null) return;

    const ok = eslestirmeStorage.update(id, {
      firma: yeniFirma.trim(),
      malzeme: yeniMalzeme.trim(),
      ambalajBilgisi: yeniAmbalaj.trim(),
      sevkYeri: yeniSevk.trim(),
      yuklemeNotu: yeniNot.trim()
    });

    if (!ok) {
      alert('❌ Aynı firma + aynı malzeme zaten var veya güncelleme hatası.');
      return;
    }

    showEslestirmeModal();
  });
});








            // Modal'ı göster
            modal.classList.remove('hidden');
        }

        // Firma Yönetim Modalını Kapat
        function kapatFirmaModal() {
            document.getElementById('firmaYonetimModal').classList.add('hidden');
        }

        // Eşleştirme Modalını Kapat
        function kapatEslestirmeModal() {
            document.getElementById('eslestirmeModal')?.classList.add('hidden');
        }

        // UI render
        function render() {
            if (!isLoggedIn) return;
            
            const filteredVehicles = filterVehicles();
            
            const hasSearch = !!(state.searchTerm && state.searchTerm.trim());
            const shouldLimit = !hasSearch && !state.showAll;
            const visibleVehicles = shouldLimit ? filteredVehicles.slice(0, state.listLimit) : filteredVehicles;

            const app = document.getElementById('mainApp');
            // ⚠️ Excel tarihi bugünün değilse uyarı göster (ASLA otomatik silme)
            const _excelMeta = (typeof loadDailyMeta === 'function') ? (loadDailyMeta() || {}) : {};
            const _excelCnt  = (typeof loadDailyShipments === 'function') ? ((loadDailyShipments() || []).length || 0) : 0;
            const _todayKey  = (typeof _todayKeyTR === 'function') ? _todayKeyTR() : '';
            let excelWarnHTML = '';
            if (_excelCnt > 0 && _excelMeta && _excelMeta.dateKey && _todayKey && _excelMeta.dateKey !== _todayKey) {
              excelWarnHTML = `<div class="excel-date-warn">⚠️ Bu Excel bugünün değil: <b>${_excelMeta.dateKey}</b> • Kayıt: <b>${_excelCnt}</b> (Otomatik silinmez)</div>`;
            }

            // 🖥️ Kiosk/Status satırı (hızlı özet)
            const _kioskOn = (typeof isKioskModeOn === 'function') ? isKioskModeOn() : false;
            const _piyasaCnt = (typeof _piyasaLoadedCount === 'function') ? _piyasaLoadedCount() : 0;
            // ✅ Excel yükleme bilgileri (raporlar sayfasındaki formatla aynı)
            const _ihrInfoLine = (()=>{
              try {
                if (_excelMeta && _excelMeta.fileName) return `${_excelMeta.fileName} • ${_excelCnt} kayıt`;
                if (_excelCnt) return `${_excelCnt} kayıt`;
              } catch(e) {}
              return '-';
            })();

            const _piyInfoLine = (()=>{
              try {
                const raw = localStorage.getItem('piyasa_state_v1');
                if (!raw) return (_piyasaCnt ? `${_piyasaCnt} satır` : '-');
                const piy = JSON.parse(raw) || {};
                const cnt = Array.isArray(piy.orders) ? piy.orders.length : (_piyasaCnt || 0);
                if (piy && piy.sheet) {
                  return `${piy.sheet}${piy.week ? ' • ' + piy.week + '. hafta' : ''} • ${cnt} satır`;
                }
                return (cnt ? `${cnt} satır` : '-');
              } catch(e) {
                return (_piyasaCnt ? `${_piyasaCnt} satır` : '-');
              }
            })();
            let _todayVehicleCount = 0;
            try { _todayVehicleCount = (state.vehicles || []).filter(v => (typeof _isTodayKayit === 'function') ? _isTodayKayit(v?.kayitTarihi) : false).length; } catch(e) { _todayVehicleCount = 0; }
            const _totalVehicleCount = (state.vehicles || []).length;
            app.innerHTML = `
                <div class="max-w-7xl mx-auto">
                    <!-- Header -->
                    <div class="bg-white rounded-lg shadow-lg p-6 mb-6 app-header">
  <div class="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">

    <!-- SOL SÜTUN: Başlık + Butonlar -->
    <div class="min-w-0">
      <div class="flex items-center gap-3 flex-wrap">
        <img src="data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%27http%3A//www.w3.org/2000/svg%27%20width%3D%2724%27%20height%3D%2724%27%20viewBox%3D%270%200%2036%2024%27%3E%0A%3Crect%20width%3D%2736%27%20height%3D%2724%27%20fill%3D%27%23E30A17%27/%3E%0A%3Ccircle%20cx%3D%2714%27%20cy%3D%2712%27%20r%3D%276%27%20fill%3D%27%23fff%27/%3E%0A%3Ccircle%20cx%3D%2715.5%27%20cy%3D%2712%27%20r%3D%275%27%20fill%3D%27%23E30A17%27/%3E%0A%3Cpolygon%20points%3D%2722%2C12%2027.5%2C10%2024%2C15%2024%2C9%2027.5%2C14%27%20fill%3D%27%23fff%27/%3E%0A%3C/svg%3E" class="w-8 h-8" alt="TR">

        <img style="max-width:400px;" src="https://i.hizliresim.com/3l3zvrz.gif" alt="ff">

        <!-- ARAÇLAR MENÜSÜ -->
        <details class="relative">
          <summary class="list-none cursor-pointer select-none bg-gray-900 text-white px-3 py-2 rounded-lg hover:bg-gray-800 transition text-xs">
            🧰 Araçlar ▾
          </summary>

          <div class="absolute left-0 mt-2 w-56 bg-white rounded-xl shadow-xl border p-2 z-50">
            <a href="plaka.html" target="_blank"
               class="block px-3 py-2 rounded-lg hover:bg-gray-100 text-sm">
              📋 Plaka Ayırma
            </a>

            <!-- 🔗 Eşleştirme kaldırıldı -->
            <div class="my-1 border-t"></div>

            <button id="exportButtonTop"
              class="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-100 text-sm">
              📥 Yedek Al
            </button>

            <button id="importButtonTop"
              class="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-100 text-sm">
              📤 Yedek Yükle
            </button>

            <div class="my-1 border-t"></div>

            <button id="excelUploadButtonTop"
              class="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-100 text-sm"
              title="Günlük sevkiyat Excel'ini yükle (.xlsx)">
              📄 İHRACAT Excel Yükle
            </button>

            <button id="excelClearButtonTop"
              class="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-100 text-sm"
              title="Günlük excel verisini temizle">
              🗑️ İHRACAT Excel Sil
            </button>

            <div class="my-1 border-t"></div>

            <div class="px-3 py-1 text-xs text-gray-500 font-semibold">PİYASA</div>

            <button id="piyasaExcelUploadButtonTop"
              class="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-100 text-sm" title="İç piyasa excel yükle">
              🧾 PİYASA Excel Yükle
            </button>

            <button id="piyasaExcelClearButtonTop"
              class="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-100 text-sm" title="İç piyasa excel verisini temizle">
              🗑️ PİYASA Excel Sil
            </button>
          </div>
        </details>
      </div>

      <!-- BUTONLAR -->
      <div class="mt-3 flex gap-2 flex-wrap">
        <button id="toggleFormButton" class="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition">
          ${state.showForm ? '❌ İptal' : '➕ Yeni Kayıt'}
        </button>

        <button id="raporlarButton" class="bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 transition" title="📊 Raporlar">
          📊 Raporlar
        </button>

        <button id="issuesDashboardButton" class="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition" title="Şoför Sorun Kayıtları">
          ⚠️ Sorunlar
        </button>

        <button style="font-size:small;" id="manualTakipFormButton" class="bg-slate-700 text-white px-4 py-2 rounded-lg hover:bg-slate-800 transition" title="Araç seçmeden manuel takip formu doldur">
          📝 Takip Formu
        </button>

        <button id="logoutButton" class="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition">
          🚪 Çıkış
        </button>
      </div>
    </div>

    <!-- SAĞ SÜTUN: HIZLI GİRİŞ (ORTALI) -->
    <div class="flex justify-center">
      <div class="w-full max-w-xl">
        <div class="flex flex-col gap-1">
          <div class="relative">
            <input type="text" id="quickPlateInput"
              class="w-full pl-4 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
              placeholder="⚡ Hızlı Giriş: Plaka yaz + Enter (F2)">
            <div class="absolute right-3 top-1/2 transform -translate-y-1/2 text-xs text-gray-400 select-none">F2</div>
          </div>
          <div class="flex flex-wrap gap-2 text-xs" id="quickStatusRow">
            <span class="status-chip">Bugün: <b>${_todayVehicleCount}</b></span>
            <span class="status-chip">Toplam: <b>${_totalVehicleCount}</b></span>
            <span id="chipIhracat" class="status-chip ${_excelCnt>0?'chip-ok':'chip-warn'}">İHRACAT: <b id="chipIhracatText">${_excelCnt>0?('Yüklü ('+_excelCnt+')'):'Boş'}</b></span>
            <span id="chipPiyasa" class="status-chip ${_piyasaCnt>0?'chip-ok':'chip-warn'}">PİYASA: <b id="chipPiyasaText">${_piyasaCnt>0?('Yüklü ('+_piyasaCnt+')'):'Boş'}</b></span>
          </div>
          <div style="flex-wrap: nowrap;
						display: flex;
						column-gap: 5px;" class="mt-1 text-[11px] text-gray-600 leading-tight" id="quickExcelInfo">
            <div style="background-color: darkorange;
						display: inline-block;
						padding: 4px;
						border: 1px solid black;
						border-radius: 8px;
						font-size: 11px;
						font-family: cursive;" id="quickIhracatInfoLine" title="${_ihrInfoLine}">📄 İHRACAT Excel: <span id="quickIhracatInfoText" class="font-semibold text-gray-800">${_ihrInfoLine}</span></div>
            <div style="background-color: darkorange;
						display: inline-block;
						padding: 4px;
						border: 1px solid black;
						border-radius: 8px;
						font-size: 11px;
						font-family: cursive;" id="quickPiyasaInfoLine" title="${_piyInfoLine}">🧾 PİYASA Excel: <span id="quickPiyasaInfoText" class="font-semibold text-gray-800">${_piyInfoLine}</span></div>
          </div>
        </div>
      </div>
    </div>

  </div>
</div>

                    ${excelWarnHTML}

                    <!-- Form -->
                    ${state.showForm ? `
                    <div class="bg-white rounded-lg shadow-lg p-6 mb-6">
                        <h2 class="text-xl font-bold text-gray-800 mb-4">
                            ${state.editingId ? '📝 Kayıt Düzenle' : '➕ Yeni Araç Kaydı'}
                        </h2>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-1">🚛 Çekici Plaka *</label>
                                <input type="text" id="cekiciPlaka" value="${state.formData.cekiciPlaka}" 
                                    class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" 
                                    placeholder="34 ABC 123">
                                <div id="plateWarning" class="text-xs mt-1 hidden"></div>
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-1">🚚 Dorse Plaka</label>
                                <input type="text" id="dorsePlaka" value="${state.formData.dorsePlaka}" 
                                    class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" 
                                    placeholder="34 XYZ 456">
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-1">👤 Şoför Adı</label>
                                <input type="text" id="soforAdi" value="${state.formData.soforAdi}" 
                                    class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" 
                                    placeholder="Ahmet">
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-1">👤 Şoför Soyadı</label>
                                <input type="text" id="soforSoyadi" value="${state.formData.soforSoyadi}" 
                                    class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" 
                                    placeholder="Yılmaz">
                            </div>
<div>
                                <label class="block text-sm font-medium text-gray-700 mb-1">📞 İletişim</label>
                                <input type="text" id="iletisim" value="${state.formData.iletisim}" 
                                    class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" 
                                    placeholder="0555 123 45 67">
                                <div id="iletisimWarning" class="text-xs mt-1 hidden"></div>
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-1">🆔 TC Kimlik No</label>
                                <input type="text" id="tcKimlik" value="${state.formData.tcKimlik}" 
                                    maxlength="11"
                                    class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" 
                                    placeholder="12345678901">

                            </div>
<div class="md:col-span-2 flex gap-2 justify-end">
                                <button id="cancelButton" class="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition">
                                    ❌ İptal
                                </button>
                                <button id="saveButton" class="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700 transition">
                                    💾 ${state.editingId ? 'Güncelle' : 'Kaydet'}
                                </button>
                            </div>
                        </div>
                    </div>
                    ` : ''}

                    <!-- Search -->
                    <div class="bg-white rounded-lg shadow-lg p-4 mb-6">
                        <div class="relative">
                            <input type="text" id="searchInput" 
                                class="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" 
                                placeholder="Plaka, şoför adı, soyadı veya kantar personeli ile ara...">
                            <svg class="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
                            </svg>
                        </div>
                    </div>

                    <!-- Vehicle List -->
                    <div id="vehicleList" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        ${filteredVehicles.length === 0 ? `
                        <div class="col-span-full text-center py-12 bg-white rounded-lg shadow-lg">
                            <svg class="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z"/>
                            </svg>
                            <p class="text-gray-500 text-lg">
                                ${state.vehicles.length === 0 ? 'Henüz kayıt yok. Yeni kayıt ekleyin!' : 'Aramanıza uygun kayıt bulunamadı.'}
                            </p>
                        </div>
                        ` : visibleVehicles.map(vehicle => `
                        <div class="vehicle-card bg-white rounded-lg shadow-lg p-5 hover:shadow-xl transition ${issueCardClass(vehicle.cekiciPlaka)}" data-vehicle='${JSON.stringify(vehicle)}'>
                            <div class="flex justify-between items-start mb-3">
                                <div class="flex items-center gap-2">
                                    <svg class="w-6 h-6 text-indigo-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z"/>
                                    </svg>
                                    <h3 class="text-lg font-bold text-indigo-600 break-all">${formatPlaka(vehicle.cekiciPlaka)} ${issuesBadgeHTML(vehicle.cekiciPlaka)}</h3>
                                </div>
                                <div class="flex gap-2 flex-shrink-0">
                                    <button class="edit-btn text-blue-600 hover:text-blue-800 text-xl" data-vehicle='${JSON.stringify(vehicle)}'>
                                        ✏️
                                    </button>
                                    <button class="form-btn text-green-600 hover:text-green-800 text-xl" data-vehicle='${JSON.stringify(vehicle)}' title="Takip Formu">
                                        📋
                                    </button>
                                    <button class="delete-btn text-red-600 hover:text-red-800 text-xl" data-id="${vehicle.id}">
                                        🗑️
                                    </button>
                                </div>
                            </div>
                            <div class="space-y-2 text-sm">
                                ${vehicle.dorsePlaka ? `
                                <div class="flex justify-between gap-2">
                                    <span class="text-gray-600 flex-shrink-0">Dorse:</span>
                                    <span class="font-medium text-right break-all">${formatPlaka(vehicle.dorsePlaka)}</span>
                                </div>` : ''}
                                ${vehicle.soforAdi ? `
                                <div class="flex justify-between gap-2">
                                    <span class="text-gray-600 flex-shrink-0">Şoför:</span>
                                    <span class="font-medium text-right break-words">${vehicle.soforAdi} ${vehicle.soforSoyadi}</span>
                                </div>` : ''}
                                ${vehicle.iletisim ? `
                                <div class="flex justify-between gap-2">
                                    <span class="text-gray-600 flex-shrink-0">İletişim:</span>
                                    <span class="font-medium text-right break-all">${vehicle.iletisim}</span>
                                </div>` : ''}
                                ${vehicle.tcKimlik ? `
<div class="flex justify-between gap-2">
    <span class="text-gray-600 flex-shrink-0">TC Kimlik:</span>
    <span class="font-medium text-right break-all">${maskTc(vehicle.tcKimlik)}</span>
</div>` : ''}

                               
                                
                                <div class="flex justify-between gap-2">
                                    <span class="text-gray-500 text-xs flex-shrink-0">Sorun Durumu:</span>
                                    <span class="text-xs text-right">${issuesStatusHTML(vehicle.cekiciPlaka)}</span>
                                </div>
                                <div class="flex justify-between gap-2 pt-2 border-t">
                                    <span class="text-gray-500 text-xs flex-shrink-0">Kayıt Tarihi:</span>
                                    <span class="text-gray-500 text-xs text-right">${vehicle.kayitTarihi}</span>
                                </div>
                            </div>
                        </div>
                        `).join('')}
                    </div>

                    <!-- Devamını Göster -->
                    ${(!state.searchTerm && filteredVehicles.length > state.listLimit) ? `
                      <div class="mt-4 flex justify-center">
                        <button id="showMoreButton" class="show-more-btn">
                          ${state.showAll ? 'Gizle' : `Devamını Göster (${filteredVehicles.length - state.listLimit})`}
                        </button>
                      </div>
                    ` : ''}
</div>

                    <!-- Stats -->
                    
                    <input id="excelFileInput" type="file" accept=".xlsx,.xls" style="display:none" />
                    <div id="stats" class="mt-6 bg-white rounded-lg shadow-lg p-4">
                        ${state.vehicles.length > 0 ? `
                        <p class="text-center text-gray-600">
                            Toplam <span class="font-bold text-indigo-600">${state.vehicles.length}</span> araç kaydı
                            ${state.searchTerm && filteredVehicles.length !== state.vehicles.length ? 
                                `| Gösterilen: <span class="font-bold text-indigo-600">${filteredVehicles.length}</span>` : ''}
                        </p>
                        ` : ''}
                    </div>
                </div>
            `;

            // Event listener'ları ekle
            attachEventListeners();
        }

        // Plaka formatlama fonksiyonu
// ✅ TR plaka standartlayıcı (il 2 hane + harf 1-3 + rakam 1-4)
// Örn: "03 VK8 78" -> "03 VK 878", "43 LU6 28" -> "43 LU 628", "01 BT9 68" -> "01 BT 968"
// ✅ Sayfa mesajı (alert) yerine hızlı bildirim
function showToast(message, ms = 2200) {
  try {
    const id = 'toastBox';
    let box = document.getElementById(id);
    if (!box) {
      box = document.createElement('div');
      box.id = id;
      box.style.position = 'fixed';
      box.style.right = '16px';
      box.style.bottom = '16px';
      box.style.zIndex = '99999';
      box.style.maxWidth = '320px';
      document.body.appendChild(box);
    }
    const item = document.createElement('div');
    item.textContent = String(message || '');
    item.style.background = 'rgba(0,0,0,0.85)';
    item.style.color = '#fff';
    item.style.padding = '10px 12px';
    item.style.marginTop = '8px';
    item.style.borderRadius = '10px';
    item.style.fontSize = '13px';
    item.style.lineHeight = '1.25';
    item.style.boxShadow = '0 6px 18px rgba(0,0,0,0.25)';
    box.appendChild(item);
    setTimeout(() => { item.remove(); }, ms);
  } catch(e) {}
}

function formatTRPlate(input) {
  if (!input) return '';
  const raw = String(input).toUpperCase().replace(/[^A-Z0-9]/g, '');

  // İlk 2 karakter il kodu olmalı (rakam)
  const il = raw.slice(0, 2);
  if (!/^\d{2}$/.test(il)) return raw;

  const rest = raw.slice(2);

  // Harfler: rest'in başından digit gelene kadar
  let letters = '';
  let digits = '';
  let i = 0;

  while (i < rest.length && /[A-Z]/.test(rest[i])) {
    letters += rest[i];
    i++;
  }

  // Geri kalanlardan sadece rakamları topla (araya yanlışlıkla harf girse bile bozmasın)
  for (; i < rest.length; i++) {
    if (/\d/.test(rest[i])) digits += rest[i];
  }

  letters = letters.slice(0, 3);
  digits = digits.slice(0, 4);

  let out = il;
  if (letters) out += ' ' + letters;
  if (digits) out += ' ' + digits;
  return out.trim();
}

function formatTRPhone(input) {
  const raw = String(input || '');
  let digits = raw.replace(/\D/g, '');
  if (!digits) return '';

  // 10 haneli girildiyse başına 0 ekle
  if (digits.length === 10) digits = '0' + digits;

  // 11 haneden fazlaysa son 11'i al (yanlış yapıştırma durumları)
  if (digits.length > 11) digits = digits.slice(-11);

  if (digits.length < 11) return digits;

  const p1 = digits.slice(0,4);
  const p2 = digits.slice(4,7);
  const p3 = digits.slice(7,9);
  const p4 = digits.slice(9,11);
  return `${p1} ${p2} ${p3} ${p4}`;
}


function formatPlaka(plaka) {
  return formatTRPlate(plaka);
}
            

        // Event listener'ları ekle
        function attachEventListeners() {
            document.getElementById('loginButton')?.addEventListener('click', login);
            document.getElementById('loginId')?.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') login();
            });
            document.getElementById('loginPassword')?.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') login();
            });
            // document.getElementById('eslestirmeButton')?.addEventListener('click', showEslestirmeModal); // kaldırıldı
document.getElementById('raporlarButton')?.addEventListener('click', () => { try { window.open('rapor.html','_blank'); } catch(e){ location.href='rapor.html'; } });
            document.getElementById('exportButtonTop')?.addEventListener('click', exportData);
            document.getElementById('importButtonTop')?.addEventListener('click', importData);


            // ⚠️ Şoför Sorunları Paneli
            document.getElementById('issuesDashboardButton')?.addEventListener('click', () => openIssuesModal(''));

            // 📝 Manuel Takip Formu (araç seçmeden)
            document.getElementById('manualTakipFormButton')?.addEventListener('click', () => {
              try {
                showTakipFormu({
                  id: 'manual',
                  cekiciPlaka: '',
                  dorsePlaka: '',
                  soforAdi: '',
                  soforSoyadi: '',
                  iletisim: '',
                  tcKimlik: '',
                  defaultFirma: '',
                  defaultMalzeme: '',
                  defaultSevkYeri: '',
                  defaultYuklemeNotu: ''
                });
              } catch (e) {
                // fail safe
                showTakipFormu({ id:'manual' });
              }
            });

            // Plaka yazılınca: sayaç/uyarı güncelle + sorun varsa Enter/blur ile otomatik aç
            const _plateEl = document.getElementById('cekiciPlaka');
            if (_plateEl) {
              safeBind(_plateEl, 'keydown', (e) => {
                if (e.key === 'Enter') {
                  const p = _plateEl.value || '';

                  // ✅ Plaka elle yazılsa bile Excel'den otomatik aday/Sevkiyat seçimi çıksın
                  try { applyShipmentToTakipForm({ cekiciPlaka: p }); } catch (e) {}

                  if (getIssueCount(p) > 0) openIssuesModal(p);
                }
              }, 'issuesEnter');
              safeBind(_plateEl, 'blur', () => {
                const p = _plateEl.value || '';

                // ✅ Plaka elle yazılsa bile Excel'den otomatik aday/Sevkiyat seçimi çıksın
                try { applyShipmentToTakipForm({ cekiciPlaka: p }); } catch (e) {}

                if (getIssueCount(p) > 0) openIssuesModal(p);
              }, 'issuesBlur');
            }

            // Kart içi "SORUN X" butonları zaten document-level delegation ile açılıyor


            // 📄 Excel yükle / sil (günlük sevkiyat)
            document.getElementById('excelUploadButtonTop')?.addEventListener('click', function(){
                const inp = document.getElementById('excelFileInput');
                if (inp) { inp.value = ''; inp.click(); }
            });

            document.getElementById('excelClearButtonTop')?.addEventListener('click', function(){
                const ok = confirm('Günlük Excel verisi silinecek.\n\nDevam edilsin mi?');
                if (!ok) return;
                const r = clearDailyShipments();
              showToast(r ? '✅ Günlük Excel verisi silindi.' : '❌ Silinemedi.');
              try { if (r) window.Report?.addEvent('EXCEL_IHRACAT_CLEARED', {}); } catch(e) {}
              // Temizleme sonrası: uygulama içi cache'leri temizle ve header bilgisini yenile
              try { if (r && typeof purgeStrictExcelCaches === 'function') purgeStrictExcelCaches(); } catch(e) {}
              try { if (r && typeof rebuildListsFromExcelRows === 'function') rebuildListsFromExcelRows([]); } catch(e) {}
              try { window.refreshHeaderExcelInfo && window.refreshHeaderExcelInfo(); } catch(e) {}
            });

            document.getElementById('excelFileInput')?.addEventListener('change', async function(e){
                const f = e.target.files && e.target.files[0];
                // ✅ Günlük sevkiyat import (form otomatik dolsun)
                const res = await importDailyExcel(f);
                if (!res || !res.ok) { showToast('❌ ' + ((res && res.msg) || 'Excel okunamadı.')); return; }
                const meta = (typeof loadDailyMeta === 'function') ? loadDailyMeta() : {};
                const cnt = (typeof loadDailyShipments === 'function') ? (loadDailyShipments().length || 0) : 0;
                showToast((res.msg || '✅ Excel içe aktarıldı.') + ` (Kayıt: ${cnt})`);
                try { window.Report?.addEvent('EXCEL_IHRACAT_LOADED', { fileName: (meta && meta.fileName) || '', count: cnt, dateKey: (meta && meta.dateKey) || '' }); } catch(e) {}
            });

            document.getElementById('toggleFormButton')?.addEventListener('click', toggleForm);
            document.getElementById('logoutButton')?.addEventListener('click', logout);

            // 🖥️ Kiosk toggle
            document.getElementById('kioskToggleButton')?.addEventListener('click', function(){
                try { toggleKioskMode(); } catch(e) {}
            });

            // ⚡ Hızlı giriş kutusu
            const quickInp = document.getElementById('quickPlateInput');
            if (quickInp) {
                quickInp.value = state.quickPlateTerm || '';
                addOnce(quickInp, 'input', (e) => {
                    state.quickPlateTerm = e.target.value;
                }, 'quickInput');
                addOnce(quickInp, 'blur', (e) => {
                    const v = formatPlakaForInput(e.target.value);
                    e.target.value = v;
                    state.quickPlateTerm = v;
                }, 'quickBlur');
                addOnce(quickInp, 'keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        submitQuickPlate();
                    }
                }, 'quickEnter');
            }

            document.getElementById('cancelButton')?.addEventListener('click', resetForm);
            document.getElementById('saveButton')?.addEventListener('click', saveFromForm);

            // Firma ekleme butonu
            document.getElementById('firmaEkleButton')?.addEventListener('click', function() {
                const yeniFirmaInput = document.getElementById('yeniFirmaInput');
                const yeniFirma = yeniFirmaInput.value.trim();
                
                if (yeniFirma === '') {
                    alert('Lütfen bir firma adı giriniz!');
                    return;
                }
                
                if (firmaStorage.add(yeniFirma)) {
                    yeniFirmaInput.value = '';
                    showFirmaYonetimModal(); // Listeyi yenile
                    alert('✅ Firma başarıyla eklendi!');
                } else {
                    alert('Bu firma zaten kayıtlı!');
                }
            });

            // Eşleştirme ekleme butonu

            // ✏️/🗑️ Firma-Malzeme liste işlemleri (tek bind: render tekrarlarında takılmasın)
            addOnce(document.getElementById('eslestirmeFirmaEditBtn'), 'click', () => {
                const sel = document.getElementById('eslestirmeFirmaSelect');
                const val = (sel?.value || '').trim();
                if (!val) { alert('Önce bir firma seçin.'); return; }

                const yeni = prompt('Yeni firma kodu:', val);
                if (yeni === null) return;
                const yeniKod = String(yeni).trim();
                if (!yeniKod) return;

                // 1) Firma listesi
                const idx = firmaListesi.findIndex(f => getFirmaKodOnly(f) === val);
                if (idx >= 0) firmaStorage.update(idx, yeniKod);

                // 2) Eşleştirmelerde firma kodunu da güncelle (yoksa eşleşmeler bozulur)
                try {
                    let changed = false;
                    eslestirmeListesi = (eslestirmeListesi || []).map(es => {
                        if (es && es.firma === val) { changed = true; return { ...es, firma: yeniKod }; }
                        return es;
                    });
                    if (changed) eslestirmeStorage.save();
                } catch (e) {}

                showEslestirmeModal();
            });

            addOnce(document.getElementById('eslestirmeFirmaDeleteBtn'), 'click', () => {
                const sel = document.getElementById('eslestirmeFirmaSelect');
                const val = (sel?.value || '').trim();
                if (!val) { alert('Önce bir firma seçin.'); return; }
                const ok = confirm(`"${val}" firmasını silmek istiyor musunuz?\n\nBu firmaya ait eşleştirmeler de silinir.`);
                if (!ok) return;

                // firma listesi: aynı koda sahip tüm girdileri temizle
                firmaListesi = (firmaListesi || []).filter(f => getFirmaKodOnly(f) !== val);
                firmaStorage.save();

                // eşleştirmeler: firma eşleşmelerini kaldır
                try {
                    eslestirmeListesi = (eslestirmeListesi || []).filter(es => (es && es.firma !== val));
                    eslestirmeStorage.save();
                } catch (e) {}

                showEslestirmeModal();
            });

            addOnce(document.getElementById('eslestirmeMalzemeEditBtn'), 'click', () => {
                const sel = document.getElementById('eslestirmeMalzemeSelect');
                const val = (sel?.value || '').trim();
                if (!val) { alert('Önce bir malzeme seçin.'); return; }

                const yeni = prompt('Yeni malzeme adı:', val);
                if (yeni === null) return;
                const yeniAd = String(yeni).trim();
                if (!yeniAd) return;

                const idx = (malzemeListesi || []).findIndex(mz => String(mz).trim() === val);
                if (idx >= 0) malzemeStorage.update(idx, yeniAd);

                // eşleştirmelerde malzeme adını da güncelle
                try {
                    let changed = false;
                    eslestirmeListesi = (eslestirmeListesi || []).map(es => {
                        if (es && es.malzeme === val) { changed = true; return { ...es, malzeme: yeniAd }; }
                        return es;
                    });
                    if (changed) eslestirmeStorage.save();
                } catch (e) {}

                showEslestirmeModal();
            });

            addOnce(document.getElementById('eslestirmeMalzemeDeleteBtn'), 'click', () => {
                const sel = document.getElementById('eslestirmeMalzemeSelect');
                const val = (sel?.value || '').trim();
                if (!val) { alert('Önce bir malzeme seçin.'); return; }
                const ok = confirm(`"${val}" malzemesini silmek istiyor musunuz?\n\nBu malzemeye ait eşleştirmeler de silinir.`);
                if (!ok) return;

                // malzeme listesi
                malzemeListesi = (malzemeListesi || []).filter(mz => String(mz).trim() !== val);
                malzemeStorage.save();

                // eşleştirmeler
                try {
                    eslestirmeListesi = (eslestirmeListesi || []).filter(es => (es && es.malzeme !== val));
                    eslestirmeStorage.save();
                } catch (e) {}

                showEslestirmeModal();
            });


            addOnce(document.getElementById('eslestirmeEkleButton'), 'click', function() {
                const firmaSelect = document.getElementById('eslestirmeFirmaSelect');
                const malzemeSelect = document.getElementById('eslestirmeMalzemeSelect');
                const firmaInput = document.getElementById('eslestirmeFirmaInput');
                const malzemeInput = document.getElementById('eslestirmeMalzemeInput');
const ambalajBilgisi = document.getElementById('eslestirmeAmbalajInput')?.value.trim() || '';
const yuklemeNotu = document.getElementById('eslestirmeNotInput')?.value.trim() || '';
const sevkYeri = document.getElementById('eslestirmeSevkYeriInput')?.value.trim() || '';
                
                let firma = firmaSelect.value || firmaInput.value.trim();
                let malzeme = malzemeSelect.value || malzemeInput.value.trim();
                
                if (!firma && !malzeme) {
                    alert('Lütfen firma ve/veya malzeme girin!');
                    return;
                }
                
                if (eslestirmeStorage.add(firma, malzeme, ambalajBilgisi, yuklemeNotu, sevkYeri)) {

                    firmaSelect.value = '';
                    malzemeSelect.value = '';
                    firmaInput.value = '';
                    malzemeInput.value = '';
                    document.getElementById('eslestirmeSevkYeriInput') && (document.getElementById('eslestirmeSevkYeriInput').value = '');
                    showEslestirmeModal(); // Listeyi yenile
                    alert('✅ Eşleştirme başarıyla eklendi!');
                } else {
                    alert('Bu eşleştirme zaten kayıtlı!');
                }
            });

            // 🧹 Hafıza Temizle (eşleştirmeleri silmez) - sadece eski öneri/cache kayıtlarını sıfırlar
            addOnce(document.getElementById('eslestirmeMemoryCleanButton'), 'click', function() {
                const ok = confirm('Hafıza (öneriler) temizlenecek.\n\n• Eşleştirmeler SİLİNMEZ\n• Sadece daha önce yazdığınız son firma/malzeme/sevk yeri önerileri temizlenir\n\nDevam edilsin mi?');
                if (!ok) return;
                const result = clearRecentCaches();
                if (result) alert('✅ Hafıza temizlendi.');
                else alert('❌ Hafıza temizlenemedi.');
            });

            // Modal kapatma butonları
            document.getElementById('firmaModalKapatButton')?.addEventListener('click', kapatFirmaModal);
            document.getElementById('eslestirmeModalKapatButton')?.addEventListener('click', kapatEslestirmeModal);

            if (state.showForm) {
                ['cekiciPlaka','dorsePlaka','soforAdi','soforSoyadi','iletisim','tcKimlik'].forEach(field => {
                    const input = document.getElementById(field);
                    if (input) {
                        addOnce(input, 'input', (e) => {
                            let value = e.target.value;
                            if (field === 'cekiciPlaka' || field === 'dorsePlaka') {
                                value = formatPlakaForInput(value);
                            }
                            updateFormData(field, value);
                        });
                    }
                });
            }

            const searchInput = document.getElementById('searchInput');
            if (searchInput) {
                searchInput.value = state.searchTerm;
                searchInput.addEventListener('input', function(e) {
                    state.searchTerm = e.target.value;
                    state.showAll = !!(state.searchTerm && state.searchTerm.trim());
                    window.clearTimeout(window.__searchDebounce);
                    window.__searchDebounce = window.setTimeout(() => {
                        updateVehicleList();
                    }, 120);
                });
            

document.getElementById('showMoreButton')?.addEventListener('click', function () {
  const step = parseInt(state.pageSize, 10) || 20;
  const total = filterVehicles().length;

  // 20, 40, 60... şeklinde gitsin (ilk tıkta 20'ye tamamlar)
  if (state.listLimit < step) {
    state.listLimit = Math.min(step, total);
  } else {
    state.listLimit = Math.min(state.listLimit + step, total);
  }

  render(); // buton/kalan sayı güncellensin
});

}

            document.querySelectorAll('.edit-btn').forEach(btn => {
                btn.addEventListener('click', function() {
                    const vehicle = JSON.parse(this.getAttribute('data-vehicle'));
                    editVehicle(vehicle);
                });
            });

            document.querySelectorAll('.form-btn').forEach(btn => {
                btn.addEventListener('click', function() {
                    const vehicle = JSON.parse(this.getAttribute('data-vehicle'));
                    showTakipFormu(vehicle);
                });
            });

            document.querySelectorAll('.delete-btn').forEach(btn => {
                btn.addEventListener('click', function() {
                    const id = this.getAttribute('data-id');
                    deleteVehicle(id);
                });
            });
// 🖨️ Yazdır / Önizleme (zorunlu alan kontrolü + yazdırınca otomatik temizle)
            document.getElementById('yazdirButton')?.addEventListener('click', () => {
                try { validateTakipForm(); } catch(e) {}

                // ✅ KANTAR: seçimi zorunlu tekrar tekrar istemesin
                // - Boşsa kayıtlı kantarı bas
                // - Her yazdırmada localStorage'a yaz (kaybolmasın)
                try {
                    const k = document.getElementById('imzaKantarAd');
                    if (k) {
                        const cur = (k.value || '').trim();
                        if (!cur) {
                            const saved = (loadSavedKantarName() || '').trim();
                            if (saved) k.value = saved;
                        }
                        persistKantarName(k.value);
                        refreshKantarSignaturePreview();
                    }
                } catch(e) {}
                // boşsa otomatik sıra ata
                try {
                    const ys = document.getElementById('yuklemeSirasi');
                    if (ys && !(ys.value || '').trim()) ys.value = String(getSuggestedYuklemeSirasi());
                } catch(e){}
                // ✅ Şoför geçmişini kaydet (plaka sabit, şoför değişebilir)
                try { saveSoforHistoryFromTakipForm(); } catch(e) {}

                // ✅ Yazdırma sonrası (tarayıcı iptal/print ayrımı vermez): ONAY ile kesinleştir
                // - Sayaç/printCount gibi kalıcı veriler burada güncellenmez.
                // - afterTakipPrint içinde kullanıcı "Çıktı alındı" derse commit edilir.
                try {
                    const nowTs = Date.now();
                    const get = (id) => (document.getElementById(id)?.value || '').trim();
                    const vid = (window.__activeTakipVehicleId || '').trim() || 'manual';
                    const plateFromForm = (get('cekiciPlakaBilgi') || window.__activeTakipVehiclePlate || '').trim();
                    const snap = (()=>{
                        try{
                            const s = {
                                ts: nowTs,
                                firmaSelect: get('firmaSelect'),
                                firmaKodu: get('firmaKodu'),
                                malzemeSelect: get('malzemeSelect'),
                                malzeme: get('malzeme'),
                                sevkYeri: get('sevkYeri'),
                                ambalajBilgisi: get('ambalajBilgisi'),
                                tonaj: get('tonaj'),
                                yuklemeSirasi: get('yuklemeSirasi'),
                                yuklemeNotu: get('yuklemeNotu')
                            };
                            const any = Object.keys(s).some(k => k !== 'ts' && String(s[k]||'').trim() !== '');
                            return any ? s : null;
                        }catch(e){ return null; }
                    })();

                    window.__pendingPrintCommit = {
                        vehicleId: vid,
                        plaka: plateFromForm,
                        nowTs,
                        yuklemeSirasi: get('yuklemeSirasi'),
                        snapshot: snap
                    };
                } catch(e) {}

                window.__afterTakipPrintRequested = true;
                try { upsertEslestirmeFromTakipForm(); } catch(e){}

                let w = null;
                try { w = window.Print?.yazdirForm({ preview: false }); } catch(e) {}
                try { window.__lastPrintWin = w || null; } catch(e) {}

                // ✅ Fallback: bazı tarayıcılarda opener.afterTakipPrint gelmeyebilir.
                // Pencere kapandıysa afterTakipPrint'i çağır.
                try {
                    if (w && typeof w.closed !== 'undefined') {
                        const t = setInterval(() => {
                            if (!window.__afterTakipPrintRequested) { clearInterval(t); return; }
                            if (w.closed) {
                                clearInterval(t);
                                try { window.afterTakipPrint && window.afterTakipPrint(); } catch(e){}
                            }
                        }, 400);
                    }
                } catch(e) {}
            });

            document.getElementById('onizlemeButton')?.addEventListener('click', () => {
                try { validateTakipForm(); } catch(e) {}

                // ✅ Önizleme de aynı: KANTAR otomatik gelsin
                try {
                    const k = document.getElementById('imzaKantarAd');
                    if (k) {
                        const cur = (k.value || '').trim();
                        if (!cur) {
                            const saved = (loadSavedKantarName() || '').trim();
                            if (saved) k.value = saved;
                        }
                        persistKantarName(k.value);
                        refreshKantarSignaturePreview();
                    }
                } catch(e) {}
                try {
                    const ys = document.getElementById('yuklemeSirasi');
                    if (ys && !(ys.value || '').trim()) ys.value = String(getSuggestedYuklemeSirasi());
                } catch(e){}
                // ✅ Şoför geçmişini kaydet (plaka sabit, şoför değişebilir)
                try { saveSoforHistoryFromTakipForm(); } catch(e) {}
                try { upsertEslestirmeFromTakipForm(); } catch(e){}
                window.Print?.yazdirForm({ preview: true });
            });

            document.getElementById('kapatButton')?.addEventListener('click', kapatForm);        
  // Telefon formatı: 0555 022 75 53
  const telInp = document.getElementById('iletisim');
  if (telInp) {
    const apply = () => {
      const v = formatTRPhone(telInp.value);
      telInp.value = v;
      updateFormData('iletisim', v);
    };
    telInp.addEventListener('input', apply);
    telInp.addEventListener('blur', apply);
  }

}

        
        // ✅ Kısayollar (4 kullanıcı için hız): / arama odak, Esc temizle, Enter ilk kaydı aç
        function focusSearchInput() {
            const s = document.getElementById('searchInput');
            if (s) {
                s.focus();
                // imleci sona al
                const v = s.value || '';
                s.setSelectionRange(v.length, v.length);
            }
        }

        function clearSearch() {
            state.searchTerm = '';
            state.showAll = false;
            const s = document.getElementById('searchInput');
            if (s) s.value = '';
            updateVehicleList();
            focusSearchInput();
        }


        // ⚡ Hızlı giriş (F2): plaka yaz + Enter -> kayıt aç / yoksa yeni kayıt
        function focusQuickPlateInput() {
            const q = document.getElementById('quickPlateInput');
            if (q) {
                q.focus();
                const v = q.value || '';
                try { q.setSelectionRange(0, v.length); } catch(_) {}
                return;
            }
            // fallback
            focusSearchInput();
        }

        function _plateKey(s){
            return String(s || '').toUpperCase().replace(/[\s-]+/g,'').trim();
        }

        function _todayDateVariantsTR(){
            try {
              const d = new Date();
              const dd = String(d.getDate()).padStart(2,'0');
              const mm = String(d.getMonth()+1).padStart(2,'0');
              const yyyy = d.getFullYear();
              const v1 = `${d.getDate()}.${mm}.${yyyy}`;
              const v2 = `${dd}.${mm}.${yyyy}`;
              const v3 = d.toLocaleDateString('tr-TR');
              const set = new Set([v1, v2, v3]);
              return Array.from(set).filter(Boolean);
            } catch(e){
              return [];
            }
        }

        function _isTodayKayit(kayitTarihi){
            const kt = String(kayitTarihi || '').trim();
            if (!kt) return false;
            const datePart = kt.split(' ')[0];
            const vars = _todayDateVariantsTR();
            if (vars.includes(datePart)) return true;
            return vars.some(v => kt.includes(v));
        }

        function _pickLatestById(list){
            const arr = Array.isArray(list) ? list.slice() : [];
            arr.sort((a,b)=> (parseInt(b?.id||'0',10)||0) - (parseInt(a?.id||'0',10)||0));
            return arr[0] || null;
        }

        function findBestVehicleByPlate(plate){
            const key = _plateKey(plate);
            if (!key) return null;
            const matches = (state.vehicles || []).filter(v => _plateKey(v?.cekiciPlaka) === key);
            if (!matches.length) return null;
            const todays = matches.filter(v => _isTodayKayit(v?.kayitTarihi));
            if (todays.length) return _pickLatestById(todays);
            return _pickLatestById(matches);
        }

        function openNewRecordWithPlate(plate){
            try {
              state.editingId = null;
              state.showForm = true;
              state.showAll = false;
              state.searchTerm = '';
              state.formData = {
                cekiciPlaka: formatPlakaForInput(plate),
                dorsePlaka: '',
                soforAdi: '',
                soforSoyadi: '',
                sofor2Adi: '',
                sofor2Soyadi: '',
                iletisim: '',
                tcKimlik: '',
                defaultFirma: '',
                defaultMalzeme: '',
                defaultSevkYeri: '',
                defaultYuklemeNotu: ''
              };
              render();
              setTimeout(()=>{ try { document.getElementById('soforAdi')?.focus(); } catch(_) {} }, 0);
            } catch(e) {}
        }

        function submitQuickPlate(){
            const inp = document.getElementById('quickPlateInput');
            if (!inp) return;
            const raw = (inp.value || '').trim();
            if (!raw) return;
            const formatted = formatPlakaForInput(raw);
            inp.value = formatted;
            state.quickPlateTerm = formatted;
            const v = findBestVehicleByPlate(formatted);
            if (v) {
                try { showTakipFormu(v); } catch(e) {}
            } else {
                openNewRecordWithPlate(formatted);
            }
        }

        function _piyasaLoadedCount(){
            try {
              const raw = localStorage.getItem('piyasa_state_v1');
              if (!raw) return 0;
              const payload = JSON.parse(raw);
              const orders = payload && payload.orders;
              return Array.isArray(orders) ? orders.length : 0;
            } catch(e){ return 0; }
        }

        function isKioskModeOn(){
            try { return localStorage.getItem('kiosk_mode_v1') === '1'; } catch(e){ return false; }
        }
        function setKioskModeOn(on){
            try { localStorage.setItem('kiosk_mode_v1', on ? '1' : '0'); } catch(e) {}
            try { document.body && document.body.classList.toggle('kiosk-mode', !!on); } catch(e) {}
        }
        function toggleKioskMode(){
            const on = !isKioskModeOn();
            setKioskModeOn(on);
            // fullscreen best-effort
            try {
              if (on) {
                const el = document.documentElement;
                if (el && el.requestFullscreen) el.requestFullscreen();
              } else {
                if (document.exitFullscreen) document.exitFullscreen();
              }
            } catch(e) {}
            try { render(); } catch(e) {}
            setTimeout(()=>{ try { focusQuickPlateInput(); } catch(_) {} }, 0);
        }

        // Global kısayol dinleyici (tek sefer)
        if (!window.__shortcutsBound) {
            window.__shortcutsBound = true;
            document.addEventListener('keydown', function (e) {
                if (!isLoggedIn) return;

                const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
                const typingInField = tag === 'input' || tag === 'textarea' || (e.target && e.target.isContentEditable);
                const activeId = (document.activeElement && document.activeElement.id) ? document.activeElement.id : '';

                // F2 -> Hızlı giriş odak
                if (e.key === 'F2') {
                    e.preventDefault();
                    focusQuickPlateInput();
                    return;
                }

                // F4 -> Yeni Kayıt aç/kapat
                if (e.key === 'F4') {
                    e.preventDefault();
                    document.getElementById('toggleFormButton')?.click();
                    setTimeout(()=>{ try { document.getElementById('cekiciPlaka')?.focus(); } catch(_) {} }, 0);
                    return;
                }

                // "/" -> arama odak (input içinde değilken)
                if (!typingInField && e.key === '/') {
                    e.preventDefault();
                    focusSearchInput();
                    return;
                }

                // ESC -> önce modalları kapat, değilse formu kapat, değilse aramayı temizle
                if (e.key === 'Escape') {
                    const takipModal = document.getElementById('takipFormuModal');
                    if (takipModal && !takipModal.classList.contains('hidden')) {
                        e.preventDefault();
                        try { typeof kapatForm === 'function' ? kapatForm() : takipModal.classList.add('hidden'); } catch(_) { takipModal.classList.add('hidden'); }
                        return;
                    }

                    const firmaModal = document.getElementById('firmaYonetimModal');
                    if (firmaModal && !firmaModal.classList.contains('hidden')) {
                        e.preventDefault();
                        try { typeof kapatFirmaModal === 'function' ? kapatFirmaModal() : firmaModal.classList.add('hidden'); } catch(_) { firmaModal.classList.add('hidden'); }
                        return;
                    }

                    const esModal = document.getElementById('eslestirmeModal');
                    if (esModal && !esModal.classList.contains('hidden')) {
                        e.preventDefault();
                        try { typeof kapatEslestirmeModal === 'function' ? kapatEslestirmeModal() : esModal.classList.add('hidden'); } catch(_) { esModal.classList.add('hidden'); }
                        return;
                    }

                    try {
                      if (typeof state !== 'undefined' && state.showForm) {
                        e.preventDefault();
                        try { typeof resetForm === 'function' ? resetForm() : (state.showForm=false, render()); } catch(_) {}
                        return;
                      }
                    } catch(_) {}

                    if (state.searchTerm && state.searchTerm.trim()) {
                        e.preventDefault();
                        clearSearch();
                        return;
                    }
                    // hiç bir şey yoksa ESC'yi bırak
                    return;
                }

                // Enter -> hızlı girişteyken kayıt aç / yoksa yeni kayıt
                if (e.key === 'Enter') {
                    // 1) Hızlı giriş kutusu
                    if (activeId === 'quickPlateInput') {
                        e.preventDefault();
                        submitQuickPlate();
                        return;
                    }

                    // 2) Yeni kayıt formu açıkken Enter -> Kaydet
                    if (typeof state !== 'undefined' && state.showForm) {
                        const ids = ['cekiciPlaka','dorsePlaka','soforAdi','soforSoyadi','iletisim','tcKimlik'];
                        if (ids.includes(activeId)) {
                            e.preventDefault();
                            document.getElementById('saveButton')?.click();
                            return;
                        }
                    }

                    // 3) Arama kutusundayken ilk kaydı aç
                    const s = document.getElementById('searchInput');
                    if (s && document.activeElement === s) {
                        const filtered = filterVehicles();
                        if (filtered && filtered.length) {
                            e.preventDefault();
                            showTakipFormu(filtered[0]);
                            return;
                        }
                    }
                }
            }, true);
        }

// Input için plaka formatlama fonksiyonu// Input için plaka formatlama fonksiyonu
function formatPlakaForInput(plaka) {
  return formatTRPlate(plaka);
}
            

        // Giriş fonksiyonu
        // SHA-256 helper
async function sha256Hex(text) {
  /* WebCrypto (crypto.subtle) file:// gibi ortamlarda kapalı olabilir */
  try {
    if (window.crypto && window.crypto.subtle) {
      const enc = new TextEncoder().encode(text);
      const digest = await window.crypto.subtle.digest("SHA-256", enc);
      return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
    }
  } catch (e) {}
  return null;
}

// Giriş fonksiyonu (async)
// ✅ Tek yerden giriş (login düşmesini azaltır)
function enterAppWithDelay(ms = 1500) {
  if (isEnteringApp) return;
  isEnteringApp = true;

  const overlay = document.getElementById('loginLoading');
  const loginScreen = document.getElementById('loginScreen');
  const mainApp = document.getElementById('mainApp');

  if (overlay) overlay.classList.remove('hidden');

  window.setTimeout(() => {
    try {
      if (overlay) overlay.classList.add('hidden');
      if (loginScreen) loginScreen.style.display = 'none';
      if (mainApp) mainApp.style.display = 'block';

      loadVehicles();
      isEnteringApp = false;
    } catch (e) {
      console.error('enterAppWithDelay hata:', e);
      isEnteringApp = false;
      // Güvenli fallback
      if (mainApp) mainApp.style.display = 'none';
      if (loginScreen) loginScreen.style.display = 'flex';
      if (overlay) overlay.classList.add('hidden');
      alert('❌ Uygulama yüklenirken hata oluştu. F12 > Console’dan hatayı kontrol edin.');
    }
  }, ms);
}


async function login() {
  const idInput = document.getElementById('loginId');
  const passInput = document.getElementById('loginPassword');
  const id = (idInput.value || '').trim().toUpperCase();
  const password = (passInput.value || '').trim();
  const loginError = document.getElementById('loginError');

  if (loginError) loginError.classList.add('hidden');
  idInput.classList.remove('border-red-500');
  passInput.classList.remove('border-red-500');

  // kullanıcıyı bul
  const user = USERS.find(u => (u.id || '').toUpperCase() === id);
  let ok = false;

  if (user && password) {
    const h = await sha256Hex(AUTH_SALT + password);
    if (h) {
      ok = (h === user.passHash);
    } else {
      // Fallback: file:// gibi ortamlarda WebCrypto yoksa duz sifre kontrolu (offline kullanim)
      ok = (user.passPlain && password === user.passPlain);
    }
  }

  if (ok) {
    isLoggedIn = true;

    // oturumu kaydet
    localStorage.setItem('isLoggedIn', 'true');
    localStorage.setItem('currentUserId', id);

    // ✅ Opsiyonel: kullanıcıya bağlı varsayılan KANTAR (USERS içinde defaultKantar tanımlıysa)
    // Örn: { id:"KANTAR1", ..., defaultKantar:"BURAK KARATAŞ" }
    try {
      if (user && user.defaultKantar) {
        const prefKey = 'pref_kantar_default_v1_' + id;
        if (!localStorage.getItem(prefKey)) {
          localStorage.setItem(prefKey, String(user.defaultKantar).trim());
        }
      }
    } catch (e) {}

    enterAppWithDelay(1500);
    } else {
    alert('❌ Hatalı ID veya Şifre!');
    passInput.value = '';

    if (loginError) loginError.classList.remove('hidden');
    idInput.classList.add('border-red-500');
    passInput.classList.add('border-red-500');
    passInput.focus();
  }
}


        // Çıkış fonksiyonu
      function logout() {
    if (confirm('Çıkış yapmak istediğinizden emin misiniz?')) {
        isLoggedIn = false;

        // ✨ BURASI YENİ: giriş bilgisini sil
        localStorage.removeItem('isLoggedIn');
        localStorage.removeItem('currentUserId');

        document.getElementById('mainApp').style.display = 'none';
        document.getElementById('loginScreen').style.display = 'flex';
        document.getElementById('loginId').value = '';
        document.getElementById('loginPassword').value = '';
    }
}


        // Form toggle
        function toggleForm() {
            state.showForm = !state.showForm;
            if (!state.showForm) {
                resetForm();
            } else {
                render();
            }
        }

        // Kayıt ekle/güncelle
        function saveFromForm() {
            state.formData.cekiciPlaka = document.getElementById('cekiciPlaka').value;
            state.formData.dorsePlaka = document.getElementById('dorsePlaka').value;
            state.formData.soforAdi = document.getElementById('soforAdi').value;
            state.formData.soforSoyadi = document.getElementById('soforSoyadi').value;
            state.formData.sofor2Adi = document.getElementById('sofor2Adi')?.value || '';
            state.formData.sofor2Soyadi = document.getElementById('sofor2Soyadi')?.value || '';
            state.formData.iletisim = document.getElementById('iletisim').value;
            state.formData.tcKimlik = document.getElementById('tcKimlik').value;
            state.formData.defaultFirma = document.getElementById('defaultFirma')?.value || '';
            state.formData.defaultMalzeme = document.getElementById('defaultMalzeme')?.value || '';
            state.formData.defaultSevkYeri = document.getElementById('defaultSevkYeri')?.value || '';
            state.formData.defaultYuklemeNotu = document.getElementById('defaultYuklemeNotu')?.value || '';
            saveVehicle();
        }

        // Düzenle
        function editVehicle(vehicle) {
                        state.formData = {
                cekiciPlaka: vehicle.cekiciPlaka,
                dorsePlaka: vehicle.dorsePlaka,
                soforAdi: vehicle.soforAdi,
                soforSoyadi: vehicle.soforSoyadi,
                sofor2Adi: vehicle.sofor2Adi || '',
                sofor2Soyadi: vehicle.sofor2Soyadi || '',
                iletisim: vehicle.iletisim,
                tcKimlik: vehicle.tcKimlik,
                defaultFirma: vehicle.defaultFirma || '',
                defaultMalzeme: vehicle.defaultMalzeme || '',
                defaultSevkYeri: vehicle.defaultSevkYeri || '',
                defaultYuklemeNotu: vehicle.defaultYuklemeNotu || ''
            };
            state.editingId = vehicle.id;
            state.showForm = true;
            render();
        }

// Sil (neden sor)
function deleteVehicle(id) {
    const vehicle = state.vehicles.find(v => v.id === id);
    const plaka = vehicle?.cekiciPlaka ? formatPlaka(vehicle.cekiciPlaka) : '';

    const reason = prompt('🗑️ Silme nedeni girin (zorunlu):', '');
    if (reason === null) return; // iptal
    const trimmed = String(reason).trim();
    if (!trimmed) {
        alert('❌ Silme nedeni boş olamaz!');
        return;
    }

    const ok = confirm(`⚠️ "${plaka}" kaydını silmek istediğinizden emin misiniz?

Neden: ${trimmed}

Bu işlem geri alınamaz!`);
    if (!ok) return;

    // log (opsiyonel)
    try {
        const log = JSON.parse(localStorage.getItem('deletionLog') || '[]');
        log.unshift({
            ts: new Date().toISOString(),
            userId: (localStorage.getItem('currentUserId') || '').toUpperCase(),
            id,
            cekiciPlaka: vehicle?.cekiciPlaka || '',
            dorsePlaka: vehicle?.dorsePlaka || '',
            sofor: ((vehicle?.soforAdi || '') + ' ' + (vehicle?.soforSoyadi || '')).trim(),
            reason: trimmed
        });
        localStorage.setItem('deletionLog', JSON.stringify(log.slice(0, 200)));
    } catch (e) {
        console.error('deletionLog yazılamadı:', e);
    }

    storage.delete(`vehicle_${id}`);
    state.vehicles = state.vehicles.filter(v => v.id !== id);
    alert('✅ Kayıt silindi!');
    render();
}

         function maskTc(tc) {
    if (!tc || tc.length !== 11) return tc;
    return tc.slice(0, 4) + '*****' + tc.slice(9);
          }
        // Sadece araç listesini güncelle
        function updateVehicleList() {
            if (!isLoggedIn) return;
            const filteredVehicles = filterVehicles();
            const hasSearch = !!(state.searchTerm && state.searchTerm.trim());
            const shouldLimit = !hasSearch && !state.showAll;
            const visibleVehicles = shouldLimit ? filteredVehicles.slice(0, state.listLimit) : filteredVehicles;
            const vehicleListContainer = document.getElementById('vehicleList');
            
            if (!vehicleListContainer) return;
            
            vehicleListContainer.innerHTML = filteredVehicles.length === 0 ? `
                <div class="col-span-full text-center py-12 bg-white rounded-lg shadow-lg">
                    <svg class="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z"/>
                    </svg>
                    <p class="text-gray-500 text-lg">
                        ${state.vehicles.length === 0 ? 'Henüz kayıt yok. Yeni kayıt ekleyin!' : 'Aramanıza uygun kayıt bulunamadı.'}
                    </p>
                </div>
            ` : visibleVehicles.map(vehicle => `
                <div class="vehicle-card bg-white rounded-lg shadow-lg p-5 hover:shadow-xl transition ${issueCardClass(vehicle.cekiciPlaka)}" data-vehicle='${JSON.stringify(vehicle)}'>
                    <div class="flex justify-between items-start mb-3">
                        <div class="flex items-center gap-2">
                            <svg class="w-6 h-6 text-indigo-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z"/>
                            </svg>
                            <h3 class="text-lg font-bold text-indigo-600 break-all">${formatPlaka(vehicle.cekiciPlaka)} ${issuesBadgeHTML(vehicle.cekiciPlaka)}</h3>
                        </div>
                        <div class="flex gap-2 flex-shrink-0">
                            <button class="edit-btn text-blue-600 hover:text-blue-800 text-xl" data-vehicle='${JSON.stringify(vehicle)}'>
                                ✏️
                            </button>
                            <button class="form-btn text-green-600 hover:text-green-800 text-xl" data-vehicle='${JSON.stringify(vehicle)}' title="Takip Formu">
                                📋
                            </button>
                            <button class="delete-btn text-red-600 hover:text-red-800 text-xl" data-id="${vehicle.id}">
                                🗑️
                            </button>
                        </div>
                    </div>
                    <div class="space-y-2 text-sm">
                        ${vehicle.dorsePlaka ? `
                        <div class="flex justify-between gap-2">
                            <span class="text-gray-600 flex-shrink-0">Dorse:</span>
                            <span class="font-medium text-right break-all">${formatPlaka(vehicle.dorsePlaka)}</span>
                        </div>` : ''}
                        ${vehicle.soforAdi ? `
                        <div class="flex justify-between gap-2">
                            <span class="text-gray-600 flex-shrink-0">Şoför:</span>
                            <span class="font-medium text-right break-words">${vehicle.soforAdi} ${vehicle.soforSoyadi}</span>
                        </div>` : ''}
                        ${vehicle.iletisim ? `
                        <div class="flex justify-between gap-2">
                            <span class="text-gray-600 flex-shrink-0">İletişim:</span>
                            <span class="font-medium text-right break-all">${vehicle.iletisim}</span>
                        </div>` : ''}
                        ${vehicle.tcKimlik ? `
<div class="flex justify-between gap-2">
    <span class="text-gray-600 flex-shrink-0">TC Kimlik:</span>
    <span class="font-medium text-right break-all">${maskTc(vehicle.tcKimlik)}</span>
</div>` : ''}
                     
                        
                                <div class="flex justify-between gap-2">
                                    <span class="text-gray-500 text-xs flex-shrink-0">Sorun Durumu:</span>
                                    <span class="text-xs text-right">${issuesStatusHTML(vehicle.cekiciPlaka)}</span>
                                </div>
                                <div class="flex justify-between gap-2 pt-2 border-t">
                            <span class="text-gray-500 text-xs flex-shrink-0">Kayıt Tarihi:</span>
                            <span class="text-gray-500 text-xs text-right">${vehicle.kayitTarihi}</span>
                        </div>
                    </div>
                </div>
            `).join('');
            
            const statsContainer = document.getElementById('stats');
            if (statsContainer && state.vehicles.length > 0) {
                statsContainer.innerHTML = `
                    <p class="text-center text-gray-600">
                        Toplam <span class="font-bold text-indigo-600">${state.vehicles.length}</span> araç kaydı
                        ${state.searchTerm && filteredVehicles.length !== state.vehicles.length ? 
                            `| Gösterilen: <span class="font-bold text-indigo-600">${filteredVehicles.length}</span>` : ''}
                    </p>
                `;
            }

            document.querySelectorAll('.edit-btn').forEach(btn => {
                btn.addEventListener('click', function() {
                    const vehicle = JSON.parse(this.getAttribute('data-vehicle'));
                    editVehicle(vehicle);
                });
            });

            document.querySelectorAll('.form-btn').forEach(btn => {
                btn.addEventListener('click', function() {
                    const vehicle = JSON.parse(this.getAttribute('data-vehicle'));
                    showTakipFormu(vehicle);
                });
            });

            document.querySelectorAll('.delete-btn').forEach(btn => {
                btn.addEventListener('click', function() {
                    const id = this.getAttribute('data-id');
                    deleteVehicle(id);
                });
            });
        }

        // İlk yükleme
        document.addEventListener('DOMContentLoaded', function() {
    // ✨ 1) Tarayıcıda 'isLoggedIn' kaydı var mı diye bak
    const savedLogin = localStorage.getItem('isLoggedIn');
    if (savedLogin === 'true') {
        // Daha önce giriş yapılmış → otomatik giriş yap
        isLoggedIn = true;
        enterAppWithDelay(700);
}

    // ✨ 2) Yine de login butonuna olay bağla (ilk giriş için lazım)
    const loginButton = document.getElementById('loginButton');
    const loginIdInput = document.getElementById('loginId');
    const loginPasswordInput = document.getElementById('loginPassword');

    if (loginButton) {
        loginButton.addEventListener('click', login);
    }

    if (loginIdInput) {
        loginIdInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') login();
        });
    }

    if (loginPasswordInput) {
        loginPasswordInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') login();
        });
    }
});



// ✅ ESC: Takip Formu/Eşleştirme/Diğer modallar kapanır; hiçbiri açık değilse çıkış yapar
if (!window.__escCloseBound) {
  window.__escCloseBound = true;
  document.addEventListener('keydown', function(e) {
    if (e.key !== 'Escape') return;
    if (typeof isLoggedIn !== 'undefined' && !isLoggedIn) return;

    // Önce açık modalları kapat

    // Yeni Araç Kaydı formu açıksa kapat (login'e dönmesin)
    try {
      if (typeof state !== 'undefined' && state.showForm) {
        state.showForm = false;
        try { typeof render === 'function' && render(); } catch(_) {}
        e.preventDefault();
        return;
      }
    } catch(_) {}


    const takipModal = document.getElementById('takipFormuModal');
    if (takipModal && !takipModal.classList.contains('hidden')) {
      try { typeof kapatForm === 'function' ? kapatForm() : takipModal.classList.add('hidden'); } catch (_) { takipModal.classList.add('hidden'); }
      e.preventDefault();
      return;
    }

    const esModal = document.getElementById('eslestirmeModal');
    if (esModal && !esModal.classList.contains('hidden')) {
      try { typeof kapatEslestirmeModal === 'function' ? kapatEslestirmeModal() : esModal.classList.add('hidden'); } catch (_) { esModal.classList.add('hidden'); }
      e.preventDefault();
      return;
    }

    const editModal = document.getElementById('editModal');
    if (editModal && !editModal.classList.contains('hidden')) {
      try { editModal.classList.add('hidden'); } catch (_) {}
      e.preventDefault();
      return;
    }

    // Hiçbiri açık değilse: hiçbir şey yapma (yanlışlıkla çıkış olmasın)
    e.preventDefault();
  }, true);
}


/* ===============================
   EXCEL DÜZELTME PENCERESİ
   (Tonaj/İrsaliye yok)
================================ */


function closeExcelReviewUI(){
  const el = document.getElementById('excelReviewOverlay');
  if (el) el.remove();
}

function openExcelReviewUI({ plate, chosen, candidates, ydKey, onApply }){
  closeExcelReviewUI();

  const overlay = document.createElement('div');
  overlay.id = 'excelReviewOverlay';
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 999999;
    background: rgba(0,0,0,.55);
    display: flex; align-items: flex-start; justify-content: center;
    padding: 24px;
  `;

  const card = document.createElement('div');
  card.style.cssText = `
    width: min(820px, 98vw);
    max-height: 92vh;
    overflow: auto;
    background: #101217;
    color: #fff;
    border: 1px solid rgba(255,255,255,.15);
    border-radius: 16px;
    box-shadow: 0 20px 60px rgba(0,0,0,.5);
    padding: 18px;
  `;

  const inputStyle = `width:100%; padding:10px 12px; border-radius:12px; border:1px solid rgba(255,255,255,.18); background:#0b0d12; color:#fff;`;
  const labelStyle = `font-size:12px; opacity:.85; margin: 10px 0 6px; display:block;`;

  const safe = (v) => (v == null ? '' : String(v));

  card.innerHTML = `
    <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px;">
      <div>
        <div style="font-size:18px; font-weight:800;">🧾 Excel Düzeltme</div>
        <div style="opacity:.85; margin-top:6px; font-size:13px;">
          Plaka: <b>${safe(plate||'')}</b>
        </div>
        <div style="opacity:.75; margin-top:6px; font-size:12px;">
          Excel’den gelen bilgileri kontrol et. Yanlış olanı düzeltip <b>Uygula</b> de.
        </div>
      </div>
      <button id="excelReviewCloseBtn"
        style="background:#2b2f3a;color:#fff;border:1px solid rgba(255,255,255,.18);padding:10px 14px;border-radius:12px;cursor:pointer;">
        Kapat
      </button>
    </div>

    <div style="margin-top:14px; border:1px solid rgba(255,255,255,.12); border-radius:12px; padding:14px;">
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
        <div>
          <label style="${labelStyle}">FİRMA / MÜŞTERİ KODU</label>
          <input id="xr_firma" style="${inputStyle}" value="${safe(chosen?.firma || '')}">
        </div>
        <div>
          <label style="${labelStyle}">MALZEME</label>
          <input id="xr_malzeme" style="${inputStyle}" value="${safe(chosen?.malzeme || '')}">
        </div>

        <div>
          <label style="${labelStyle}">SEVK YERİ</label>
          <select id="xr_sevkYeriCand" style="${inputStyle} padding:8px 10px; margin-bottom:8px;">
            <option value="">(Aday seç / boş bırak)</option>
          </select>
          <input id="xr_sevkYeri" style="${inputStyle}" value="${safe(chosen?.sevkYeri || '')}">
        </div>
        <div>
          <label style="${labelStyle}">AMBALAJ BİLGİSİ</label>
          <select id="xr_ambalajCand" style="${inputStyle} padding:8px 10px; margin-bottom:8px;">
            <option value="">(Aday seç / boş bırak)</option>
          </select>
          <input id="xr_ambalaj" style="${inputStyle}" value="${safe(chosen?.ambalaj || '')}">
        </div>

        <div>
          <label style="${labelStyle}">BBT</label>
          <input id="xr_bbt" style="${inputStyle}" value="${safe(chosen?.bbt || '')}">
        </div>
        <div>
          <label style="${labelStyle}">BOŞ BBT</label>
          <input id="xr_bosBbt" style="${inputStyle}" value="${safe(chosen?.bosBbt || '')}">
        </div>

        <div>
          <label style="${labelStyle}">ÇUVAL</label>
          <input id="xr_cuval" style="${inputStyle}" value="${safe(chosen?.cuval || '')}">
        </div>
        <div>
          <label style="${labelStyle}">BOŞ ÇUVAL</label>
          <input id="xr_bosCuval" style="${inputStyle}" value="${safe(chosen?.bosCuval || '')}">
        </div>

        <div>
          <label style="${labelStyle}">PALET</label>
          <input id="xr_palet" style="${inputStyle}" value="${safe(chosen?.palet || '')}">
        </div>
      </div>

      <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:14px;">
        <button id="excelReviewCancelBtn"
          style="background:#2b2f3a;color:#fff;border:1px solid rgba(255,255,255,.18);padding:10px 14px;border-radius:12px;cursor:pointer;">
          İptal
        </button>
        <button id="excelReviewApplyBtn"
          style="background:#22c55e;color:#0b0d12;border:none;padding:10px 14px;border-radius:12px;cursor:pointer;font-weight:900;">
          Uygula
        </button>
      </div>
    </div>
  `;

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  // ✅ Aday listelerini doldur (sevk yeri / ambalaj)
  try {
    const ambC = (candidates && Array.isArray(candidates.ambalaj)) ? candidates.ambalaj : [];
    const sevC = (candidates && Array.isArray(candidates.sevkYeri)) ? candidates.sevkYeri : [];

    const selAmb = card.querySelector('#xr_ambalajCand');
    const selSev = card.querySelector('#xr_sevkYeriCand');

    const addOpts = (sel, arr) => {
      if (!sel) return;
      for (const v of (arr || [])) {
        const opt = document.createElement('option');
        opt.value = String(v || '');
        opt.textContent = String(v || '');
        sel.appendChild(opt);
      }
    };

    addOpts(selSev, sevC);
    addOpts(selAmb, ambC);

    // seçilince inputu doldur
    if (selSev) selSev.addEventListener('change', () => {
      const v = selSev.value || '';
      if (v) {
        const inp = card.querySelector('#xr_sevkYeri');
        if (inp) inp.value = v;
      }
    });
    if (selAmb) selAmb.addEventListener('change', () => {
      const v = selAmb.value || '';
      if (v) {
        const inp = card.querySelector('#xr_ambalaj');
        if (inp) inp.value = v;
      }
    });
  } catch(e){}

  // ✅ Aynı Excel oturumunda hızlı doldurma: YD/Firma anahtarına göre
  try {
    const key = normalizeYdKey(ydKey || chosen?.ydKey || chosen?.firma || '');
    if (key) {
      if (!window.__quickDefaultsByKey) window.__quickDefaultsByKey = {};
      const d = window.__quickDefaultsByKey[key];
      if (d) {
        const sevInp = card.querySelector('#xr_sevkYeri');
        const ambInp = card.querySelector('#xr_ambalaj');
        if (sevInp && !String(sevInp.value||'').trim() && String(d.sevkYeri||'').trim()) sevInp.value = d.sevkYeri;
        if (ambInp && !String(ambInp.value||'').trim() && String(d.ambalaj||'').trim()) ambInp.value = d.ambalaj;
      }
    }
  } catch(e){}

  const close = () => closeExcelReviewUI();
  card.querySelector('#excelReviewCloseBtn').addEventListener('click', close);
  card.querySelector('#excelReviewCancelBtn').addEventListener('click', close);

  card.querySelector('#excelReviewApplyBtn').addEventListener('click', () => {
    const fixed = {
      ydKey: normalizeYdKey(ydKey || chosen?.ydKey || chosen?.firma || ''),
      firma: (document.getElementById('xr_firma')?.value || '').trim(),
      malzeme: (document.getElementById('xr_malzeme')?.value || '').trim(),
      sevkYeri: (document.getElementById('xr_sevkYeri')?.value || '').trim(),
      ambalaj: (document.getElementById('xr_ambalaj')?.value || '').trim(),
      bbt: (document.getElementById('xr_bbt')?.value || '').trim(),
      bosBbt: (document.getElementById('xr_bosBbt')?.value || '').trim(),
      cuval: (document.getElementById('xr_cuval')?.value || '').trim(),
      bosCuval: (document.getElementById('xr_bosCuval')?.value || '').trim(),
      palet: (document.getElementById('xr_palet')?.value || '').trim(),
    };
    
    // ✅ Kullanıcı düzeltmesini FIRMA bazlı hafızaya al (özellikle Sevk Yeri / Liman)
    try{
      const fk = _normFirmaKey(fixed.firma);
      const newSevk = String(fixed.sevkYeri || '').trim();
      if (fk && newSevk) {
        setFirmaOverride(fixed.firma, { sevkYeri: newSevk });
      }
    }catch(e){}
try { onApply && onApply(fixed); } catch(e){}
    close();
  });
}


/* ===============================
   ⚠️ ŞOFÖR / PLAKA SORUN KAYDI
   - Plaka girince otomatik uyarı
   - Tarih + not + opsiyonel foto
================================ */

const ISSUE_STORAGE_KEY = 'driverIssuesByPlate_v1';

function _normPlate(p){
  return (p || '').toLowerCase().replace(/\s+/g,'').replace(/[^a-z0-9ığüşöç]/gi,'');
}

function loadIssuesMap(){
  try { return JSON.parse(localStorage.getItem(ISSUE_STORAGE_KEY) || '{}') || {}; } catch(e){ return {}; }
}

function saveIssuesMap(map){
  try { localStorage.setItem(ISSUE_STORAGE_KEY, JSON.stringify(map || {})); } catch(e){}
}

function getIssues(plate){
  const key = _normPlate(plate);
  const map = loadIssuesMap();
  return Array.isArray(map[key]) ? map[key] : [];
}

function getIssueCount(plate){
  return getIssues(plate).length;
}

function addIssue(plate, issue){
  const key = _normPlate(plate);
  if (!key) return;
  const map = loadIssuesMap();
  if (!Array.isArray(map[key])) map[key] = [];
  map[key].unshift(issue); // newest first
  saveIssuesMap(map);
}

function deleteIssue(plate, idx){
  const key = _normPlate(plate);
  const map = loadIssuesMap();
  if (!Array.isArray(map[key])) return;
  map[key].splice(idx,1);
  saveIssuesMap(map);
}
function updateIssue(plate, idx, patch){
  const key = _normPlate(plate);
  const map = loadIssuesMap();
  if (!Array.isArray(map[key])) return false;
  if (idx < 0 || idx >= map[key].length) return false;
  const prev = map[key][idx] || {};
  map[key][idx] = { ...prev, ...(patch || {}) };
  saveIssuesMap(map);
  return true;
}

function clearIssues(plate){
  const key = _normPlate(plate);
  if (!key) return false;
  const map = loadIssuesMap();
  if (map && Object.prototype.hasOwnProperty.call(map, key)) {
    delete map[key];
    saveIssuesMap(map);
    return true;
  }
  return false;
}
function clearAllIssues(){
  saveIssuesMap({});
}



function issueCardClass(plate){
  // 1 tane bile sorun varsa kart kırmızı olsun (kalıcı; kullanıcı manuel siler)
  const cnt = getIssueCount(plate);
  return cnt > 0 ? 'border-2 border-red-500 bg-red-50' : '';
}
function issuesBadgeHTML(plate){
  const cnt = getIssueCount(plate);
  const p = _normPlate(plate);
  if (!p) return '';
  if (cnt > 0) {
    return `<button class="issues-open ml-2 text-xs px-2 py-1 rounded-full bg-red-600 text-white font-bold" data-plate="${p}" title="Sorun kayıtlarını gör">SORUN ${cnt}</button>`;
  }
  return `<button class="issues-open ml-2 text-xs px-2 py-1 rounded-full bg-gray-200 text-gray-700 font-semibold" data-plate="${p}" title="Sorun ekle / gör">SORUN 0</button>`;
}

function issuesStatusHTML(plate){
  const cnt = getIssueCount(plate);
  if (cnt > 0) return `<span style="color:#dc2626;font-weight:800">⚠️ ${cnt} sorun var</span>`;
  return `<span style="color:#16a34a;font-weight:800">✅ Sorun yok</span>`;
}

function updateIssuesIndicators(){
  // Kartlardaki butonları ve sayıları güncellemek için yeniden render zaten yapıyor.
  // Ama formda plaka yazarken sadece takip butonunu/yerel göstergeleri güncelleyelim.
  try {
    const plate = document.getElementById('cekiciPlaka')?.value || '';
    const cnt = getIssueCount(plate);
    const btn = document.getElementById('issuesQuickBtn');
    if (btn) {
      btn.textContent = `⚠️ Şoför Sorunları (${cnt})`;
      btn.style.background = cnt>0 ? '#ef4444' : '#374151';
    }
  } catch(e){}
}

function closeIssuesModal(){
  const el = document.getElementById('issuesOverlay');
  if (el) el.remove();
}

async function fileToDataUrl(file){
  return new Promise((resolve,reject)=>{
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function openIssuesModal(plateOrEmpty){
  const initialPlate = (plateOrEmpty || '').trim();
  closeIssuesModal();

  const overlay = document.createElement('div');
  overlay.id = 'issuesOverlay';
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:1000000;
    background:rgba(0,0,0,.6);
    display:flex;justify-content:center;align-items:flex-start;
    padding:24px;
  `;

  const card = document.createElement('div');
  card.style.cssText = `
    width:min(980px, 98vw);
    background:#0b0d12;
    color:#fff;
    border:1px solid rgba(255,255,255,.12);
    border-radius:16px;
    padding:16px;
    max-height:92vh;
    overflow:auto;
  `;

  const nowLocal = () => {
    const d=new Date();
    const pad=n=>String(n).padStart(2,'0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
      <div>
        <div style="font-size:18px;font-weight:900;">⚠️ Şoför / Plaka Sorun Kayıtları</div>
        <div style="opacity:.8;font-size:12px;margin-top:4px;">Plaka girince otomatik açılır. Buradan tarih + not + foto ekleyebilirsin.</div>
      </div>
      <button id="issuesCloseBtn" style="background:#2b2f3a;color:#fff;border:1px solid rgba(255,255,255,.15);padding:8px 12px;border-radius:12px;cursor:pointer;">Kapat</button>
    </div>

    <div style="display:grid;grid-template-columns: 220px 1fr;gap:10px;margin-top:12px;align-items:end;">
      <div>
        <div style="font-size:12px;opacity:.85;margin-bottom:6px;">Plaka</div>
        <input id="issuesPlateInput" placeholder="34ABC123" style="width:100%;padding:10px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.18);background:#111827;color:#fff;" value="${initialPlate}">
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;align-items:center;">
        <label style="display:flex;gap:8px;align-items:center;font-size:12px;opacity:.9;user-select:none;">
          <input id="issuesShowClosed" type="checkbox" style="transform:scale(1.15);">
          Kapatılanları Göster
        </label>
        <button id="issuesRefreshBtn" style="background:#374151;color:#fff;border:none;padding:10px 12px;border-radius:12px;cursor:pointer;font-weight:800;">Listele</button>
        <button id="issuesClearPlateBtn" style="background:#7c2d12;color:#fff;border:none;padding:10px 12px;border-radius:12px;cursor:pointer;font-weight:900;">Sorunları Temizle</button>
      </div>
    </div>

    <div style="margin-top:14px;border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:12px;">
      <div style="font-weight:900;margin-bottom:10px;">➕ Yeni Sorun Ekle</div>
      <div style="display:grid;grid-template-columns: 220px 220px 1fr;gap:10px;align-items:end;">
        <div>
          <div style="font-size:12px;opacity:.85;margin-bottom:6px;">Tarih / Saat</div>
          <input id="issuesDateInput" type="datetime-local" style="width:100%;padding:10px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.18);background:#111827;color:#fff;" value="${nowLocal()}">
        </div>
        <div>
          <div style="font-size:12px;opacity:.85;margin-bottom:6px;">Sorun Tipi</div>
          <select id="issuesTypeSelect" style="width:100%;padding:10px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.18);background:#111827;color:#fff;">
            <option value="">(Seçiniz)</option>
            <option value="Baret Takmama">Baret Takmama</option>
            <option value="Kantar Tartışması">Kantar Tartışması</option>
            <option value="Sevkiyat Personeliyle Tartışma">Sevkiyat Personeliyle Tartışma</option>
            <option value="Saha Kuralına Uymama">Saha Kuralına Uymama</option>
            <option value="Sıra / Yoğunluk İhlali">Sıra / Yoğunluk İhlali</option>
            <option value="Diğer">Diğer</option>
          </select>
          <div style="margin-top:6px;font-size:11px;opacity:.75;">Not: Tip seçilince açıklama otomatik gelir (dilersen düzenle).</div>
        </div>
        <div>
          <div style="font-size:12px;opacity:.85;margin-bottom:6px;">Olay Notu</div>
          <input id="issuesNoteInput" placeholder="Örn: Kantarda sıra kuralına uymadı, personele bağırdı..." style="width:100%;padding:10px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.18);background:#111827;color:#fff;">
        </div>
      </div>

      <div style="display:flex;gap:10px;align-items:center;justify-content:flex-end;margin-top:10px;flex-wrap:wrap;">
        <input id="issuesPhotoInput" type="file" accept="image/*" capture="environment" style="color:#fff;">
        <button id="issuesAddBtn" style="background:#ef4444;color:#fff;border:none;padding:10px 12px;border-radius:12px;cursor:pointer;font-weight:900;">Kaydet</button>
      </div>
      <div id="issuesAddMsg" style="margin-top:8px;font-size:12px;opacity:.85;"></div>
    </div>

    <div style="margin-top:14px;">
      <div style="font-weight:900;margin-bottom:8px;">📌 Geçmiş Kayıtlar</div>
      <div id="issuesList"></div>
    </div>
  `;

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  // ✅ Aday listelerini doldur (sevk yeri / ambalaj)
  try {
    const ambC = (candidates && Array.isArray(candidates.ambalaj)) ? candidates.ambalaj : [];
    const sevC = (candidates && Array.isArray(candidates.sevkYeri)) ? candidates.sevkYeri : [];

    const selAmb = card.querySelector('#xr_ambalajCand');
    const selSev = card.querySelector('#xr_sevkYeriCand');

    const addOpts = (sel, arr) => {
      if (!sel) return;
      for (const v of (arr || [])) {
        const opt = document.createElement('option');
        opt.value = String(v || '');
        opt.textContent = String(v || '');
        sel.appendChild(opt);
      }
    };

    addOpts(selSev, sevC);
    addOpts(selAmb, ambC);

    // seçilince inputu doldur
    if (selSev) selSev.addEventListener('change', () => {
      const v = selSev.value || '';
      if (v) {
        const inp = card.querySelector('#xr_sevkYeri');
        if (inp) inp.value = v;
      }
    });
    if (selAmb) selAmb.addEventListener('change', () => {
      const v = selAmb.value || '';
      if (v) {
        const inp = card.querySelector('#xr_ambalaj');
        if (inp) inp.value = v;
      }
    });
  } catch(e){}

  // ✅ Aynı Excel oturumunda hızlı doldurma: YD/Firma anahtarına göre
  try {
    const key = normalizeYdKey(ydKey || chosen?.ydKey || chosen?.firma || '');
    if (key) {
      if (!window.__quickDefaultsByKey) window.__quickDefaultsByKey = {};
      const d = window.__quickDefaultsByKey[key];
      if (d) {
        const sevInp = card.querySelector('#xr_sevkYeri');
        const ambInp = card.querySelector('#xr_ambalaj');
        if (sevInp && !String(sevInp.value||'').trim() && String(d.sevkYeri||'').trim()) sevInp.value = d.sevkYeri;
        if (ambInp && !String(ambInp.value||'').trim() && String(d.ambalaj||'').trim()) ambInp.value = d.ambalaj;
      }
    }
  } catch(e){}

  const close = () => closeIssuesModal();
  card.querySelector('#issuesCloseBtn').addEventListener('click', close);
  overlay.addEventListener('click', (e)=>{ if (e.target === overlay) close(); });

  // ✅ Sorun tipi şablonları (daha resmi dil)
  const ISSUE_TEMPLATES = {
    'Baret Takmama': 'Sahada baretsiz gezmekte, yapılan uyarılara rağmen kişisel koruyucu donanım kurallarına uymamaktadır.',
    'Kantar Tartışması': 'Kantar giriş/çıkış süreçlerinde personele yönelik uygunsuz üslup kullanarak tartışmaya girmektedir.',
    'Sevkiyat Personeliyle Tartışma': 'Sevkiyat personelinin yönlendirmelerine uymayarak tartışmaya girmektedir.',
    'Saha Kuralına Uymama': 'Saha düzeni ve işleyiş kurallarına riayet etmemekte, yapılan uyarılara rağmen kurallara uymamaktadır.',
    'Sıra / Yoğunluk İhlali': 'Sahada yoğunluk oluşmaması için belirlenen sıra/düzen uygulamasına uymayarak akışı olumsuz etkilemektedir.',
    'Diğer': ''
  };

  // Tip seçilince notu otomatik doldur (kullanıcı isterse düzenler)
  const typeSel = card.querySelector('#issuesTypeSelect');
  const noteInp = card.querySelector('#issuesNoteInput');
  if (typeSel && noteInp) {
    typeSel.addEventListener('change', ()=>{
      const t = String(typeSel.value || '');
      const tmpl = ISSUE_TEMPLATES[t] || '';
      if (tmpl) noteInp.value = tmpl;
    });
  }

  const renderList = (plate) => {
    const listEl = document.getElementById('issuesList');
    if (!listEl) return;

    const norm = _normPlate(plate);
    const showClosed = !!document.getElementById('issuesShowClosed')?.checked;

    // 🔎 Plaka boşsa: tüm sorunlu plakaları listele
    if (!norm) {
      const map = loadIssuesMap();
      const keys = Object.keys(map || {}).filter(k => Array.isArray(map[k]) && map[k].length > 0);

      if (keys.length === 0) {
        listEl.innerHTML = `<div style="opacity:.8">✅ Kayıtlı sorun bulunamadı.</div>`;
        return;
      }

      // En çok sorunu olan en üste
      keys.sort((a,b) => (map[b].length||0) - (map[a].length||0));

      listEl.innerHTML = keys.map(k => {
        let items = Array.isArray(map[k]) ? map[k] : [];
        if (!showClosed) items = items.filter(it => (it && it.status) !== 'closed');
        const headPlate = (k || '').toUpperCase();
        const inner = items.map((it, idx) => {
          const dt = it.dateLocal || it.dateISO || '';
          const type = (it.type || '').toString().replace(/</g,'&lt;').replace(/>/g,'&gt;');
          const note = (it.note || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
          const addedBy = (it.addedBy || '').toString().replace(/</g,'&lt;').replace(/>/g,'&gt;');
          const isClosed = (it.status === 'closed');
          const hasPhoto = !!it.photo;

          const statusBadge = isClosed
            ? `<span style="background:#16a34a;color:#fff;font-weight:900;font-size:11px;padding:3px 8px;border-radius:999px;">KAPATILDI</span>`
            : `<span style="background:#ef4444;color:#fff;font-weight:900;font-size:11px;padding:3px 8px;border-radius:999px;">AÇIK</span>`;

          return `
            <div style="border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:12px;margin-top:10px;background:${isClosed ? '#0b1d12' : '#0f172a'};opacity:${isClosed ? '.85' : '1'};">
              <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
                <div style="min-width:0;">
                  <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                    <div style="font-weight:900;color:#fca5a5;">⚠️ ${dt}</div>
                    ${statusBadge}
                    ${type ? `<span style="background:#334155;color:#fff;font-weight:800;font-size:11px;padding:3px 8px;border-radius:999px;">${type}</span>` : ``}
                  </div>
                  ${addedBy ? `<div style="margin-top:6px;font-size:12px;opacity:.9;">👤 Ekleyen: <b>${addedBy}</b></div>` : ``}
                  <div style="margin-top:6px;white-space:pre-wrap;">${note}</div>
                  ${isClosed ? `<div style="margin-top:6px;font-size:12px;opacity:.85;">✅ Kapanış: ${(it.closedAtLocal || '').toString().replace(/</g,'&lt;').replace(/>/g,'&gt;')}${it.closedBy ? ` • 👤 ${String(it.closedBy).replace(/</g,'&lt;').replace(/>/g,'&gt;')}` : ''}</div>` : ``}
                </div>
                <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end;">
                  <button class="issueEditBtn" data-plate="${k}" data-idx="${idx}" style="background:#374151;color:#fff;border:none;padding:8px 10px;border-radius:10px;cursor:pointer;">Düzenle</button>
                  <button class="issueToggleBtn" data-plate="${k}" data-idx="${idx}" style="background:${isClosed ? '#0ea5e9' : '#16a34a'};color:#fff;border:none;padding:8px 10px;border-radius:10px;cursor:pointer;">${isClosed ? 'Aç' : 'Kapat'}</button>
                  <button class="issueDelBtn" data-plate="${k}" data-idx="${idx}" style="background:#ef4444;color:#fff;border:none;padding:8px 10px;border-radius:10px;cursor:pointer;">Sil</button>
                </div>
              </div>
              ${hasPhoto ? `<div style="margin-top:10px;"><img src="${it.photo}" style="max-width:100%;border-radius:12px;border:1px solid rgba(255,255,255,.12)"></div>` : ``}
            </div>
          `;

        }).join('');

        return `
          <div style="border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:12px;margin-bottom:12px;background:#111827;">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
              <div style="font-weight:1000;font-size:14px;">🚗 ${headPlate}</div>
              <div style="opacity:.85;font-size:12px;">Toplam: ${items.length}</div>
            </div>
            ${inner}
          </div>
        `;
      }).join('');

      // bind edit/delete (tüm plakalar)
      Array.from(card.querySelectorAll('.issueEditBtn')).forEach(btn=>{
        btn.addEventListener('click', async ()=>{
          const p = btn.dataset.plate || document.getElementById('issuesPlateInput')?.value || '';
          const i = Number(btn.dataset.idx);
          const itemsNow = getIssues(p);
          const cur = itemsNow[i] || {};
          const newType = prompt('Sorun Tipi:', cur.type || '');
          const newNote = prompt('Olay Notu:', cur.note || '');
          if (newNote == null) return;
          const newDate = prompt('Tarih/Saat (örn: 26.12.2025 14:30):', cur.dateLocal || '');
          const patch = {
            type: String(newType || '').trim(),
            note: String(newNote || '').trim(),
            dateLocal: newDate ? String(newDate).trim() : (cur.dateLocal || ''),
            dateISO: (()=>{
              if (!newDate) return cur.dateISO || '';
              const tryD = new Date(newDate);
              if (!isNaN(tryD.getTime())) return tryD.toISOString();
              return cur.dateISO || '';
            })()
          };
          if (!patch.note) { alert('❗ Sorun notu boş olamaz.'); return; }
          updateIssue(p, i, patch);
          renderList(''); // tüm listeyi yenile
          try { render(); } catch(e){}
        });
      });

      Array.from(card.querySelectorAll('.issueDelBtn')).forEach(btn=>{
        btn.addEventListener('click', async ()=>{
          const p = btn.dataset.plate || document.getElementById('issuesPlateInput')?.value || '';
          const i = Number(btn.dataset.idx);
          deleteIssue(p, i);
          renderList('');
          try { render(); } catch(e){}
        });
      });

      // ✅ Kapat / Aç
      Array.from(card.querySelectorAll('.issueToggleBtn')).forEach(btn=>{
        btn.addEventListener('click', ()=>{
          const p = btn.dataset.plate || '';
          const i = Number(btn.dataset.idx);
          const itemsNow = getIssues(p);
          const cur = itemsNow[i] || {};
          const isClosed = (cur.status === 'closed');
          const actor = (document.getElementById('imzaKantarAd')?.value || '').trim();
          if (isClosed) {
            updateIssue(p, i, { status:'open', closedAtISO:'', closedAtLocal:'', closedBy:'' });
          } else {
            const d = new Date();
            updateIssue(p, i, { status:'closed', closedAtISO:d.toISOString(), closedAtLocal:d.toLocaleString('tr-TR'), closedBy: actor });
          }
          renderList('');
          try { render(); } catch(e){}
        });
      });

      return;
    }

    // 🔎 Plaka doluysa: sadece o plakayı listele
    let items = getIssues(norm);
    if (!showClosed) items = items.filter(it => (it && it.status) !== 'closed');
    const cnt = items.length;

    if (cnt === 0) {
      listEl.innerHTML = `<div style="opacity:.8">✅ Bu plakaya kayıtlı sorun yok.</div>`;
      return;
    }

    listEl.innerHTML = items.map((it, idx) => {
      const dt = it.dateLocal || it.dateISO || '';
      const type = (it.type || '').toString().replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const note = (it.note || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const addedBy = (it.addedBy || '').toString().replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const isClosed = (it.status === 'closed');
      const hasPhoto = !!it.photo;

      const statusBadge = isClosed
        ? `<span style="background:#16a34a;color:#fff;font-weight:900;font-size:11px;padding:3px 8px;border-radius:999px;">KAPATILDI</span>`
        : `<span style="background:#ef4444;color:#fff;font-weight:900;font-size:11px;padding:3px 8px;border-radius:999px;">AÇIK</span>`;

      return `
        <div style="border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:12px;margin-bottom:10px;background:${isClosed ? '#0b1d12' : '#0f172a'};opacity:${isClosed ? '.85' : '1'};">
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
            <div style="min-width:0;">
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                <div style="font-weight:900;color:#fca5a5;">⚠️ ${dt}</div>
                ${statusBadge}
                ${type ? `<span style="background:#334155;color:#fff;font-weight:800;font-size:11px;padding:3px 8px;border-radius:999px;">${type}</span>` : ``}
              </div>
              ${addedBy ? `<div style="margin-top:6px;font-size:12px;opacity:.9;">👤 Ekleyen: <b>${addedBy}</b></div>` : ``}
              <div style="margin-top:6px;white-space:pre-wrap;">${note}</div>
              ${isClosed ? `<div style="margin-top:6px;font-size:12px;opacity:.85;">✅ Kapanış: ${(it.closedAtLocal || '').toString().replace(/</g,'&lt;').replace(/>/g,'&gt;')}${it.closedBy ? ` • 👤 ${String(it.closedBy).replace(/</g,'&lt;').replace(/>/g,'&gt;')}` : ''}</div>` : ``}
            </div>
            <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end;">
              <button class="issueEditBtn" data-plate="${norm}" data-idx="${idx}" style="background:#374151;color:#fff;border:none;padding:8px 10px;border-radius:10px;cursor:pointer;">Düzenle</button>
              <button class="issueToggleBtn" data-plate="${norm}" data-idx="${idx}" style="background:${isClosed ? '#0ea5e9' : '#16a34a'};color:#fff;border:none;padding:8px 10px;border-radius:10px;cursor:pointer;">${isClosed ? 'Aç' : 'Kapat'}</button>
              <button class="issueDelBtn" data-plate="${norm}" data-idx="${idx}" style="background:#ef4444;color:#fff;border:none;padding:8px 10px;border-radius:10px;cursor:pointer;">Sil</button>
            </div>
          </div>
          ${hasPhoto ? `<div style="margin-top:10px;"><img src="${it.photo}" style="max-width:100%;border-radius:12px;border:1px solid rgba(255,255,255,.12)"></div>` : ``}
        </div>
      `;

    }).join('');

    // edit binds
    Array.from(card.querySelectorAll('.issueEditBtn')).forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        const p = btn.dataset.plate || document.getElementById('issuesPlateInput')?.value || '';
        const i = Number(btn.dataset.idx);
        const itemsNow = getIssues(p);
        const cur = itemsNow[i] || {};
        const newType = prompt('Sorun Tipi:', cur.type || '');
          const newNote = prompt('Olay Notu:', cur.note || '');
        if (newNote == null) return;
        const newDate = prompt('Tarih/Saat (örn: 26.12.2025 14:30):', cur.dateLocal || '');
        const patch = {
        type: String(newType || '').trim(),
        note: String(newNote || '').trim(),
          dateLocal: newDate ? String(newDate).trim() : (cur.dateLocal || ''),
          // dateISO'yu newDate parse edebilirse güncelle
          dateISO: (()=>{
            if (!newDate) return cur.dateISO || '';
            const tryD = new Date(newDate);
            if (!isNaN(tryD.getTime())) return tryD.toISOString();
            return cur.dateISO || '';
          })()
        };
        if (!patch.note) { alert('❗ Sorun notu boş olamaz.'); return; }
        updateIssue(p, i, patch);
        renderList(p);
        try { render(); } catch(e){}
      });
    });

    // delete binds
    Array.from(card.querySelectorAll('.issueDelBtn')).forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        const p = btn.dataset.plate || document.getElementById('issuesPlateInput')?.value || '';
        const i = Number(btn.dataset.idx);
        deleteIssue(p, i);
        renderList(p);
        try { render(); } catch(e){}
      });
    });

    // ✅ Kapat / Aç
    Array.from(card.querySelectorAll('.issueToggleBtn')).forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const p = btn.dataset.plate || document.getElementById('issuesPlateInput')?.value || '';
        const i = Number(btn.dataset.idx);
        const itemsNow = getIssues(p);
        const cur = itemsNow[i] || {};
        const isClosed = (cur.status === 'closed');
        const actor = (document.getElementById('imzaKantarAd')?.value || '').trim();
        if (isClosed) {
          updateIssue(p, i, { status:'open', closedAtISO:'', closedAtLocal:'', closedBy:'' });
        } else {
          const d = new Date();
          updateIssue(p, i, { status:'closed', closedAtISO:d.toISOString(), closedAtLocal:d.toLocaleString('tr-TR'), closedBy: actor });
        }
        renderList(p);
        try { render(); } catch(e){}
      });
    });
  };

  const doRefresh = () => renderList(document.getElementById('issuesPlateInput').value || '');
  card.querySelector('#issuesRefreshBtn').addEventListener('click', doRefresh);

  try { card.querySelector('#issuesShowClosed')?.addEventListener('change', doRefresh); } catch(e){}

  const clearBtn = card.querySelector('#issuesClearPlateBtn');
  if (clearBtn){
    clearBtn.addEventListener('click', ()=>{
      const p = document.getElementById('issuesPlateInput')?.value || '';
      if (!_normPlate(p)) { alert('❗ Önce plaka giriniz.'); return; }
      if (!confirm('Bu plakanın TÜM sorun kayıtları silinsin mi?')) return;
      clearIssues(p);
      doRefresh();
      try { render(); } catch(e){}
    });
  }

  card.querySelector('#issuesAddBtn').addEventListener('click', async ()=>{
    const plate = document.getElementById('issuesPlateInput').value || '';
    const note  = (document.getElementById('issuesNoteInput').value || '').trim();
    const dateV = document.getElementById('issuesDateInput').value || '';
    const msgEl = document.getElementById('issuesAddMsg');

    if (!_normPlate(plate)) { msgEl.textContent = '❗ Plaka boş olamaz.'; return; }
    if (!note) { msgEl.textContent = '❗ Sorun notu yaz.'; return; }

    let photo = '';
    const file = document.getElementById('issuesPhotoInput')?.files?.[0];
    if (file) {
      try { photo = await fileToDataUrl(file); } catch(e){ photo=''; }
    }

    const d = dateV ? new Date(dateV) : new Date();
    const type = (document.getElementById('issuesTypeSelect')?.value || '').trim();
    const addedBy = (document.getElementById('imzaKantarAd')?.value || '').trim();
    const issue = {
      type,
      note,
      photo,
      addedBy,
      status: 'open',
      closedAtISO: '',
      closedAtLocal: '',
      closedBy: '',
      dateISO: d.toISOString(),
      dateLocal: d.toLocaleString('tr-TR')
    };
    addIssue(plate, issue);
    document.getElementById('issuesNoteInput').value = '';
    try { document.getElementById('issuesTypeSelect').value = ''; } catch(e){}
    document.getElementById('issuesPhotoInput').value = '';
    msgEl.textContent = '✅ Kaydedildi.';
    doRefresh();
    try { render(); } catch(e){}
  });

  // initial list
  doRefresh();
}

function autoOpenIssuesIfExists(plate){
  const cnt = getIssueCount(plate);
  if (cnt > 0) openIssuesModal(plate);
}

// Global delegation: kartlardaki issues-open butonları
document.addEventListener('click', (e)=>{
  const t = e.target;
  if (t && t.classList && t.classList.contains('issues-open')) {
    e.preventDefault();
    const plateKey = t.getAttribute('data-plate') || '';
    // plateKey normalized; modal plate input ham da olabilir
    openIssuesModal(plateKey);
  }
});