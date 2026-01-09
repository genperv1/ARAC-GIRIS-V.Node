// server.js
// Express server + SQLite (sqlite3) + static file serving

const path = require('path');
const fs = require('fs');
const express = require('express');
const bodyParser = express.json;
const sqlite3 = require('sqlite3').verbose();

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_FILE = path.join(DATA_DIR, 'app.db');
const db = new sqlite3.Database(DB_FILE, (err)=>{
  if (err) console.error('DB connection error:', err);
  else console.log('Connected to SQLite database');
});

function prepareSchema(){
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS vehicles(
      id TEXT PRIMARY KEY,
      cekiciPlaka TEXT,
      dorsePlaka TEXT,
      data TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS daily_rows(
      id TEXT PRIMARY KEY,
      plaka TEXT,
      data TEXT,
      created_at INTEGER
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS events(
      id TEXT PRIMARY KEY,
      type TEXT,
      data TEXT,
      ts INTEGER
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS problems(
      id TEXT PRIMARY KEY,
      plate TEXT,
      data TEXT,
      ts INTEGER
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS kv_store(
      key TEXT PRIMARY KEY,
      value TEXT
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS report(
      id TEXT PRIMARY KEY,
      type TEXT,
      data TEXT,
      ts INTEGER
    )`);
  });
}

prepareSchema();

const app = express();
// allow larger JSON payloads for full backup restores
app.use(bodyParser({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Root route -> GIRIS.html (MUST be before static middleware)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'GIRIS.html'));
});

// Serve static files from project root (so front-end files remain accessible)
app.use(express.static(path.join(__dirname)));

// API prefix
const api = express.Router();

// Vehicles
api.get('/vehicles', (req, res) => {
  db.all('SELECT id, cekiciPlaka, dorsePlaka, data FROM vehicles', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const parsed = (rows || []).map(r => {
      try { return JSON.parse(r.data); } catch(e){ return { id: r.id, cekiciPlaka: r.cekiciPlaka, dorsePlaka: r.dorsePlaka }; }
    });
    res.json(parsed);
  });
});

api.get('/vehicles/:id', (req, res) => {
  const id = req.params.id;
  db.get('SELECT data FROM vehicles WHERE id = ?', [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Not found' });
    try { return res.json(JSON.parse(row.data)); } catch(e){ return res.json({ raw: row.data }); }
  });
});

api.post('/vehicles', (req, res) => {
  const v = req.body || {};
  const id = String(v.id || (Date.now().toString() + Math.random().toString(16).slice(2)));
  db.run(
    'INSERT OR REPLACE INTO vehicles(id, cekiciPlaka, dorsePlaka, data) VALUES(?,?,?,?)',
    [id, v.cekiciPlaka || '', v.dorsePlaka || '', JSON.stringify(Object.assign({}, v, { id }))],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ ok: true, id });
    }
  );
});

api.put('/vehicles/:id', (req, res) => {
  const id = req.params.id;
  const v = req.body || {};
  db.run(
    'INSERT OR REPLACE INTO vehicles(id, cekiciPlaka, dorsePlaka, data) VALUES(?,?,?,?)',
    [id, v.cekiciPlaka || '', v.dorsePlaka || '', JSON.stringify(Object.assign({}, v, { id }))],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ ok: true, id });
    }
  );
});

api.delete('/vehicles/:id', (req, res) => {
  const id = req.params.id;
  db.run('DELETE FROM vehicles WHERE id = ?', [id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true });
  });
});

// Daily rows
api.get('/daily_rows', (req, res) => {
  db.all('SELECT data FROM daily_rows ORDER BY created_at DESC', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json((rows || []).map(r => { try { return JSON.parse(r.data); } catch(e){ return r.data; } }));
  });
});

api.post('/daily_rows', (req, res) => {
  const r = req.body || {};
  const id = String(r.id || (Date.now().toString() + Math.random().toString(16).slice(2)));
  const created = Number(r.created_at || Date.now());
  db.run(
    'INSERT OR REPLACE INTO daily_rows(id, plaka, data, created_at) VALUES(?,?,?,?)',
    [id, r.plaka || '', JSON.stringify(Object.assign({}, r, { id })), created],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ ok: true, id });
    }
  );
});

api.delete('/daily_rows/:id', (req, res) => {
  const id = req.params.id;
  db.run('DELETE FROM daily_rows WHERE id = ?', [id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true });
  });
});

// Export DB file (download)
api.get('/export/db', (req, res) => {
  const fp = DB_FILE;
  if (!fs.existsSync(fp)) return res.status(404).send('No DB');
  res.download(fp, 'arac_giris.sqlite');
});

// Piyasa state endpoints (store small JSON blobs in kv_store)
api.get('/piyasa', (req, res) => {
  db.get('SELECT value FROM kv_store WHERE key = ?', ['piyasa_state_v1'], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.json({});
    try { return res.json(JSON.parse(row.value)); } catch(e){ return res.json({}); }
  });
});

api.post('/piyasa', (req, res) => {
  const payload = req.body || {};
  const raw = JSON.stringify(payload);
  db.run('INSERT OR REPLACE INTO kv_store(key, value) VALUES(?,?)', ['piyasa_state_v1', raw], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true });
  });
});

// Generic KV endpoints for other keys (daily shipments, meta, etc.)
api.get('/kv/:key', (req, res) => {
  const key = req.params.key;
  db.get('SELECT value FROM kv_store WHERE key = ?', [key], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.json(null);
    try { return res.json(JSON.parse(row.value)); } catch(e){ return res.json(row.value); }
  });
});

api.post('/kv/:key', (req, res) => {
  const key = req.params.key;
  const v = req.body && req.body.value !== undefined ? req.body.value : req.body;
  const raw = (typeof v === 'string') ? v : JSON.stringify(v);
  db.run('INSERT OR REPLACE INTO kv_store(key, value) VALUES(?,?)', [key, raw], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true });
  });
});

// Reports (events) endpoints - use existing events table
api.get('/reports', (req, res) => {
  db.all('SELECT id, type, data, ts FROM report ORDER BY ts DESC', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const parsed = (rows || []).map(r => {
      try { return { id: r.id, type: r.type, data: JSON.parse(r.data), ts: r.ts }; } catch(e){ return { id: r.id, type: r.type, data: r.data, ts: r.ts }; }
    });
    res.json(parsed);
  });
});

api.post('/reports', (req, res) => {
  const body = req.body || {};
  const id = String(body.id || (Date.now().toString() + Math.random().toString(16).slice(2)));
  const type = body.type || '';
  const data = body.data !== undefined ? body.data : body;
  const raw = (typeof data === 'string') ? data : JSON.stringify(data);
  const ts = Number(body.ts || Date.now());
  db.run('INSERT OR REPLACE INTO report(id, type, data, ts) VALUES(?,?,?,?)', [id, type, raw, ts], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true, id });
  });
});

api.delete('/reports', (req, res) => {
  db.run('DELETE FROM report', (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true });
  });
});

// Problems (driver/plate issues) - store each issue as a row in problems
api.get('/problems', (req, res) => {
  const plateQuery = req.query.plate || '';
  if (plateQuery) {
    const plate = String(plateQuery || '');
    db.all('SELECT id, data FROM problems WHERE plate = ? ORDER BY ts DESC', [plate], (err, rows) => {
      if (err) { console.error('GET /problems?plate SQL error', err); return res.status(500).json({ error: err.message }); }
      const parsed = (rows || []).map(r => { try { return Object.assign({ id: r.id }, JSON.parse(r.data)); } catch(e){ return { id: r.id, raw: r.data }; } });
      res.json(parsed);
    });
    return;
  }
  db.all('SELECT id, data, plate FROM problems ORDER BY ts DESC', (err, rows) => {
    if (err) { console.error('GET /problems SQL error', err); return res.status(500).json({ error: err.message }); }
    const parsed = (rows || []).map(r => { try { return Object.assign({ id: r.id, plate: r.plate }, JSON.parse(r.data)); } catch(e){ return { id: r.id, plate: r.plate, raw: r.data }; } });
    res.json(parsed);
  });
});

api.get('/problems/:id', (req, res) => {
  const id = req.params.id;
  db.get('SELECT data FROM problems WHERE id = ?', [id], (err, row) => {
    if (err) { console.error('GET /problems/:id SQL error', err); return res.status(500).json({ error: err.message }); }
    if (!row) return res.status(404).json({ error: 'Not found' });
    try { return res.json(JSON.parse(row.data)); } catch(e){ return res.json({ raw: row.data }); }
  });
});

api.post('/problems', (req, res) => {
  const body = req.body || {};
  const id = String(body.id || (Date.now().toString() + Math.random().toString(16).slice(2)));
  const plate = String(body.plate || '');
  const data = body.data !== undefined ? body.data : body;
  const raw = (typeof data === 'string') ? data : JSON.stringify(data);
  const ts = Number(body.ts || Date.now());
  db.run('INSERT OR REPLACE INTO problems(id, plate, data, ts) VALUES(?,?,?,?)', [id, plate, raw, ts], (err) => {
    if (err) { console.error('POST /problems SQL error', err); return res.status(500).json({ error: err.message }); }
    res.json({ ok: true, id });
  });
});

api.put('/problems/:id', (req, res) => {
  const id = req.params.id;
  const body = req.body || {};
  const plate = String(body.plate || '');
  const data = body.data !== undefined ? body.data : body;
  const raw = (typeof data === 'string') ? data : JSON.stringify(data);
  const ts = Number(body.ts || Date.now());
  db.run('INSERT OR REPLACE INTO problems(id, plate, data, ts) VALUES(?,?,?,?)', [id, plate, raw, ts], (err) => {
    if (err) { console.error('PUT /problems/:id SQL error', err); return res.status(500).json({ error: err.message }); }
    res.json({ ok: true, id });
  });
});

api.delete('/problems/:id', (req, res) => {
  const id = req.params.id;
  db.run('DELETE FROM problems WHERE id = ?', [id], (err) => {
    if (err) { console.error('DELETE /problems/:id SQL error', err); return res.status(500).json({ error: err.message }); }
    res.json({ ok: true });
  });
});

// delete all problems for a plate
api.delete('/problems/plate/:plate', (req, res) => {
  const plate = String(req.params.plate || '');
  db.run('DELETE FROM problems WHERE plate = ?', [plate], (err) => {
    if (err) { console.error('DELETE /problems/plate/:plate SQL error', err); return res.status(500).json({ error: err.message }); }
    res.json({ ok: true });
  });
});

// delete all problems
api.delete('/problems', (req, res) => {
  db.run('DELETE FROM problems', (err) => {
    if (err) { console.error('DELETE /problems SQL error', err); return res.status(500).json({ error: err.message }); }
    res.json({ ok: true });
  });
});

// Migration helper: migrate legacy localStorage dump (kv_store.report_events_v1) into report table
api.post('/migrate/reports-from-kv', (req, res) => {
  db.get('SELECT value FROM kv_store WHERE key = ?', ['report_events_v1'], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'no kv report_events_v1' });
    let arr = [];
    try { arr = JSON.parse(row.value); } catch(e) { return res.status(400).json({ error: 'invalid json in kv' }); }
    if (!Array.isArray(arr)) return res.status(400).json({ error: 'expected array' });

    const insert = db.prepare('INSERT OR REPLACE INTO report(id, type, data, ts) VALUES(?,?,?,?)');
    let processed = 0;
    arr.forEach(it => {
      try {
        const id = it.id || ('EV' + Date.now().toString(36) + Math.random().toString(16).slice(2));
        const type = it.type || '';
        const data = (typeof it.data === 'string') ? it.data : JSON.stringify(it.data || {});
        const ts = Number(it.ts || Date.now());
        insert.run(id, type, data, ts);
        processed++;
      } catch(e) {}
    });
    insert.finalize(() => {
      return res.json({ ok: true, processed });
    });
  });
});

// Restore a full JSON backup into SQLite (storageDump)
api.post('/restore-full', (req, res) => {
  const allData = req.body || {};
  const hasStorageDump = allData && allData.storageDump && typeof allData.storageDump === 'object';
  const hasVehiclesArray = Array.isArray(allData.vehicles);
  if (!hasStorageDump && !hasVehiclesArray) {
    return res.status(400).json({ error: 'invalid backup payload' });
  }

  let processed = 0;
  db.serialize(() => {
    const insertVehicle = db.prepare('INSERT OR REPLACE INTO vehicles(id, cekiciPlaka, dorsePlaka, data) VALUES(?,?,?,?)');
    const insertDaily = db.prepare('INSERT OR REPLACE INTO daily_rows(id, plaka, data, created_at) VALUES(?,?,?,?)');
    const upsertKV = db.prepare('INSERT OR REPLACE INTO kv_store(key, value) VALUES(?,?)');

    // If top-level vehicles array provided (legacy export), insert them
    if (hasVehiclesArray) {
      allData.vehicles.forEach(vehicle => {
        try {
          const id = String(vehicle.id || (Date.now().toString() + Math.random().toString(16).slice(2)));
          insertVehicle.run(id, vehicle.cekiciPlaka || '', vehicle.dorsePlaka || '', JSON.stringify(Object.assign({}, vehicle, { id })), (e)=>{});
          processed++;
        } catch(e) {}
      });
    }

    if (hasStorageDump) {
      const dump = allData.storageDump;

      // If dump contains a 'vehicles' key (stringified array), import it first
      if (dump.vehicles) {
        try {
          const parsedVehicles = typeof dump.vehicles === 'string' ? JSON.parse(dump.vehicles) : dump.vehicles;
          if (Array.isArray(parsedVehicles)) {
            parsedVehicles.forEach(vehicle => {
              try {
                const id = String(vehicle.id || (Date.now().toString() + Math.random().toString(16).slice(2)));
                insertVehicle.run(id, vehicle.cekiciPlaka || '', vehicle.dorsePlaka || '', JSON.stringify(Object.assign({}, vehicle, { id })), (e)=>{});
                processed++;
              } catch(e) {}
            });
          }
        } catch(e) {}
      }

      Object.keys(dump).forEach(k => {
        const raw = dump[k];
        // try to parse JSON; if fails, keep as string
        let parsed = null;
        try { parsed = JSON.parse(raw); } catch(e) { parsed = null; }

        try {
          if (String(k).startsWith('vehicle_')) {
            // vehicle_<id>
            const id = String(k).slice(8);
            const dataObj = parsed && typeof parsed === 'object' ? parsed : { id, raw: raw };
            insertVehicle.run(id, dataObj.cekiciPlaka || '', dataObj.dorsePlaka || '', JSON.stringify(Object.assign({}, dataObj, { id })), (e)=>{});
            processed++;
            return;
          }

          if (String(k).startsWith('auto_backup_')) {
            const id = k;
            const created = parsed && parsed.ts ? Date.parse(parsed.ts) || Date.now() : Date.now();
            insertDaily.run(id, '', JSON.stringify(parsed || raw), Number(created), (e)=>{});
            processed++;
            return;
          }

          // special: piyasa_state_v1 -> kv
          if (k === 'piyasa_state_v1') {
            upsertKV.run(k, typeof raw === 'string' ? raw : JSON.stringify(raw), (e)=>{});
            processed++;
            return;
          }

          // default: store into kv_store to preserve other localStorage keys
          upsertKV.run(k, typeof raw === 'string' ? raw : JSON.stringify(raw), (e)=>{});
          processed++;
        } catch(e) {
          // ignore individual failures
        }
      });
    }

    insertVehicle.finalize();
    insertDaily.finalize();
    upsertKV.finalize();
  });

  res.json({ ok: true, processed });
});

// Simple health
api.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api', api);
app.use(api); // Also mount routes at root level (e.g., /vehicles, /daily_rows)

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
