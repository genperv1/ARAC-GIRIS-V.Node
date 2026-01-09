// storage.js
// Araç kayıtlarını SQLite (sunucu) üzerinde tutar, memory cache + localStorage fallback ile.
// API endpoints: GET /api/vehicles, POST /api/vehicles, DELETE /api/vehicles/:id
(() => {
  const storage = {
    _KEY: 'vehicles',
    _cache: null,
    _loaded: false,

    _readAll: async () => {
      // Server'dan oku
      try {
        const resp = await fetch('/api/vehicles');
        if (resp.ok) {
          const vehicles = await resp.json();
          storage._cache = Array.isArray(vehicles) ? vehicles : [];
          storage._loaded = true;
          // localStorage'a da yedek olarak kaydet
          try { localStorage.setItem(storage._KEY, JSON.stringify(storage._cache)); } catch (e) {}
          return storage._cache;
        }
      } catch (e) {}

      // Fallback: localStorage
      try {
        const raw = localStorage.getItem(storage._KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          storage._cache = Array.isArray(parsed) ? parsed : [];
          storage._loaded = true;
          return storage._cache;
        }
      } catch (e) {}

      storage._cache = [];
      storage._loaded = true;
      return storage._cache;
    },

    _writeAll: async (vehicles) => {
      const arr = Array.isArray(vehicles) ? vehicles : [];
      storage._cache = arr;

      // Server'a yaz (SQLite)
      try {
        for (const v of arr) {
          await fetch('/api/vehicles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(v)
          });
        }
      } catch (e) {}

      // localStorage fallback
      try { localStorage.setItem(storage._KEY, JSON.stringify(arr)); } catch (e) {}
    },

    // SENKRON: cache'i döndür (hızlı fallback)
    loadAll: () => {
      if (Array.isArray(storage._cache)) return storage._cache;
      // Try localStorage
      try {
        const raw = localStorage.getItem(storage._KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          storage._cache = Array.isArray(parsed) ? parsed : [];
          return storage._cache;
        }
      } catch (e) {}
      storage._cache = [];
      return storage._cache;
    },

    save: (key, data) => {
      const vehicles = storage.loadAll();
      const id =
        (data && data.id) ? String(data.id) :
        (String(key).startsWith('vehicle_') ? String(key).slice(8) : null);

      if (!id) return;

      const idx = vehicles.findIndex(v => String(v.id) === id);
      if (idx >= 0) vehicles[idx] = data;
      else vehicles.push(data);

      storage._cache = vehicles;
      try { localStorage.setItem(storage._KEY, JSON.stringify(vehicles)); } catch (e) {}

      // Arkada server'a yaz (fire-and-forget)
      try {
        fetch('/api/vehicles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        }).catch(()=>{});
      } catch (e) {}
    },

    load: (key) => {
      const vehicles = storage.loadAll();
      const id = String(key).startsWith('vehicle_') ? String(key).slice(8) : null;
      if (!id) return null;
      return vehicles.find(v => String(v.id) === id) || null;
    },

    delete: (key) => {
      const vehicles = storage.loadAll();
      const id = String(key).startsWith('vehicle_') ? String(key).slice(8) : null;
      if (!id) return;

      const filtered = vehicles.filter(v => String(v.id) !== id);
      storage._cache = filtered;
      try { localStorage.setItem(storage._KEY, JSON.stringify(filtered)); } catch (e) {}

      // Arkada server'dan sil (fire-and-forget)
      try {
        fetch(`/api/vehicles/${id}`, { method: 'DELETE' }).catch(()=>{});
      } catch (e) {}
    }
  };

  window.storage = storage;

  // Boot: cache'i server'dan yükle (arka planda, UI bloklamadan)
  try {
    setTimeout(() => {
      storage._readAll().catch(()=>{});
    }, 0);
  } catch (e) {}
})();
