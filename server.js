// server.js
// Express server + PostgreSQL (pg) + static file serving
require("dotenv").config();

const path = require("path");
const fs = require("fs");
const express = require("express");
const bodyParser = express.json;

const { Pool } = require("pg");
const cron = require('node-cron');

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing in environment (.env)");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  // Render Internal DB URL genelde SSL istemez.
  // External URL ile bağlanıyorsan bazen gerekir:
  // ssl: { rejectUnauthorized: false },
});

async function prepareSchema() {
  // TEXT id + TEXT json payload yaklaşımını bozmuyoruz
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vehicles(
      id TEXT PRIMARY KEY,
      cekiciPlaka TEXT,
      dorsePlaka TEXT,
      data TEXT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS daily_rows(
      id TEXT PRIMARY KEY,
      plaka TEXT,
      data TEXT,
      created_at BIGINT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS events(
      id TEXT PRIMARY KEY,
      type TEXT,
      data TEXT,
      ts BIGINT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS problems(
      id TEXT PRIMARY KEY,
      plate TEXT,
      data TEXT,
      ts BIGINT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS kv_store(
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS report(
      id TEXT PRIMARY KEY,
      type TEXT,
      data TEXT,
      ts BIGINT
    );
  `);

  // (opsiyonel) indexler
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_daily_rows_created_at ON daily_rows(created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_problems_plate_ts ON problems(plate, ts DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_report_ts ON report(ts DESC);`);
}

// Report cleanup: deletes reports older than configured months
const REPORT_RETENTION_MONTHS = Number(process.env.REPORT_RETENTION_MONTHS || '1');
const REPORT_CLEAN_CRON = process.env.REPORT_CLEAN_CRON || '0 0 1 * *'; // at 00:00 on day 1 of each month

async function deleteOldReports(months = REPORT_RETENTION_MONTHS) {
  try {
    const cutoff = Date.now() - Number(months) * 30 * 24 * 60 * 60 * 1000;
    const res = await q('DELETE FROM report WHERE ts < $1', [cutoff]);
    try { console.log(`Monthly cleanup: deleted ${res.rowCount || 0} reports older than ${months} month(s)`); } catch(e) {}
  } catch (e) {
    console.error('Failed to delete old reports:', e.message || e);
  }
}

// küçük helper: query + hata log
async function q(text, params = []) {
  try {
    return await pool.query(text, params);
  } catch (e) {
    console.error("SQL error:", e.message, "\nQuery:", text, "\nParams:", params);
    throw e;
  }
}

const app = express();
app.use(bodyParser({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Root route -> GIRIS.html (MUST be before static middleware)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "GIRIS.html"));
});

// Serve static files from project root
app.use(express.static(path.join(__dirname)));

const api = express.Router();

// Vehicles
api.get("/vehicles", async (req, res) => {
  try {
    const r = await q("SELECT id, cekiciPlaka, dorsePlaka, data FROM vehicles");
    const parsed = (r.rows || []).map((row) => {
      try {
        return JSON.parse(row.data);
      } catch {
        return { id: row.id, cekiciPlaka: row.cekiciplaka, dorsePlaka: row.dorseplaka };
      }
    });
    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.get("/vehicles/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const r = await q("SELECT data FROM vehicles WHERE id = $1", [id]);
    if (!r.rows[0]) return res.status(404).json({ error: "Not found" });
    try {
      return res.json(JSON.parse(r.rows[0].data));
    } catch {
      return res.json({ raw: r.rows[0].data });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.post("/vehicles", async (req, res) => {
  try {
    const v = req.body || {};
    const id = String(v.id || (Date.now().toString() + Math.random().toString(16).slice(2)));

    const cekiciPlaka = v.cekiciPlaka || "";
    const dorsePlaka = v.dorsePlaka || "";
    const raw = JSON.stringify(Object.assign({}, v, { id }));

    // INSERT OR REPLACE -> UPSERT
    await q(
      `
      INSERT INTO vehicles(id, cekiciPlaka, dorsePlaka, data)
      VALUES($1,$2,$3,$4)
      ON CONFLICT (id) DO UPDATE SET
        cekiciPlaka = EXCLUDED.cekiciPlaka,
        dorsePlaka = EXCLUDED.dorsePlaka,
        data = EXCLUDED.data
      `,
      [id, cekiciPlaka, dorsePlaka, raw]
    );

    res.json({ ok: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.put("/vehicles/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const v = req.body || {};
    const cekiciPlaka = v.cekiciPlaka || "";
    const dorsePlaka = v.dorsePlaka || "";
    const raw = JSON.stringify(Object.assign({}, v, { id }));

    await q(
      `
      INSERT INTO vehicles(id, cekiciPlaka, dorsePlaka, data)
      VALUES($1,$2,$3,$4)
      ON CONFLICT (id) DO UPDATE SET
        cekiciPlaka = EXCLUDED.cekiciPlaka,
        dorsePlaka = EXCLUDED.dorsePlaka,
        data = EXCLUDED.data
      `,
      [id, cekiciPlaka, dorsePlaka, raw]
    );

    res.json({ ok: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.delete("/vehicles/:id", async (req, res) => {
  try {
    const id = req.params.id;
    await q("DELETE FROM vehicles WHERE id = $1", [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Daily rows
api.get("/daily_rows", async (req, res) => {
  try {
    const r = await q("SELECT data FROM daily_rows ORDER BY created_at DESC");
    res.json((r.rows || []).map((x) => {
      try {
        return JSON.parse(x.data);
      } catch {
        return x.data;
      }
    }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.post("/daily_rows", async (req, res) => {
  try {
    const row = req.body || {};
    const id = String(row.id || (Date.now().toString() + Math.random().toString(16).slice(2)));
    const created = Number(row.created_at || Date.now());
    const plaka = row.plaka || "";
    const raw = JSON.stringify(Object.assign({}, row, { id }));

    await q(
      `
      INSERT INTO daily_rows(id, plaka, data, created_at)
      VALUES($1,$2,$3,$4)
      ON CONFLICT (id) DO UPDATE SET
        plaka = EXCLUDED.plaka,
        data = EXCLUDED.data,
        created_at = EXCLUDED.created_at
      `,
      [id, plaka, raw, created]
    );

    res.json({ ok: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.delete("/daily_rows/:id", async (req, res) => {
  try {
    const id = req.params.id;
    await q("DELETE FROM daily_rows WHERE id = $1", [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Export DB (Postgres'te .sqlite dosyası yok; JSON yedek indiriyoruz)
api.get("/export/db", async (req, res) => {
  try {
    const [vehicles, daily_rows, problems, kv_store, report, events] = await Promise.all([
      q("SELECT * FROM vehicles"),
      q("SELECT * FROM daily_rows"),
      q("SELECT * FROM problems"),
      q("SELECT * FROM kv_store"),
      q("SELECT * FROM report"),
      q("SELECT * FROM events"),
    ]);

    const backup = {
      ts: Date.now(),
      vehicles: vehicles.rows,
      daily_rows: daily_rows.rows,
      problems: problems.rows,
      kv_store: kv_store.rows,
      report: report.rows,
      events: events.rows,
    };

    const filename = "arac_giris_backup.json";
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(JSON.stringify(backup));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Piyasa state
api.get("/piyasa", async (req, res) => {
  try {
    const r = await q("SELECT value FROM kv_store WHERE key = $1", ["piyasa_state_v1"]);
    if (!r.rows[0]) return res.json({});
    try { return res.json(JSON.parse(r.rows[0].value)); } catch { return res.json({}); }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.post("/piyasa", async (req, res) => {
  try {
    const raw = JSON.stringify(req.body || {});
    await q(
      `
      INSERT INTO kv_store(key, value)
      VALUES($1,$2)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
      `,
      ["piyasa_state_v1", raw]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generic KV
api.get("/kv/:key", async (req, res) => {
  try {
    const key = req.params.key;
    const r = await q("SELECT value FROM kv_store WHERE key = $1", [key]);
    if (!r.rows[0]) return res.json(null);
    try { return res.json(JSON.parse(r.rows[0].value)); } catch { return res.json(r.rows[0].value); }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.post("/kv/:key", async (req, res) => {
  try {
    const key = req.params.key;
    const v = req.body && req.body.value !== undefined ? req.body.value : req.body;
    const raw = (typeof v === "string") ? v : JSON.stringify(v);

    await q(
      `
      INSERT INTO kv_store(key, value)
      VALUES($1,$2)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
      `,
      [key, raw]
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reports
api.get("/reports", async (req, res) => {
  try {
    const r = await q("SELECT id, type, data, ts FROM report ORDER BY ts DESC");
    const parsed = (r.rows || []).map((row) => {
      try {
        const d = JSON.parse(row.data || '{}');
        // remove legacy kayitTarihi from report payloads (don't expose in API)
        try { if (d && d.kayitTarihi !== undefined) delete d.kayitTarihi; } catch(e) {}
        // compute date-only "tarih" convenience field and remove legacy lastPrintedAt exposure
        let tarihVal = '';
        try {
          if (d && d.tarih) {
            tarihVal = d.tarih;
          } else if (d && d.lastPrintedAt) {
            try { tarihVal = new Date(Number(d.lastPrintedAt)).toLocaleDateString('tr-TR'); } catch(e) { tarihVal = ''; }
          } else if (d && d.lastPrintSnapshot && d.lastPrintSnapshot.ts) {
            try { tarihVal = new Date(Number(d.lastPrintSnapshot.ts)).toLocaleDateString('tr-TR'); } catch(e) { tarihVal = ''; }
          } else if (row.ts) {
            try { tarihVal = new Date(Number(row.ts)).toLocaleDateString('tr-TR'); } catch(e) { tarihVal = ''; }
          }
        } catch(e) { tarihVal = ''; }
        try { if (d && d.lastPrintedAt !== undefined) delete d.lastPrintedAt; } catch(e) {}
        return {
          id: row.id,
          type: row.type,
          data: d,
          ts: row.ts,
          tarih: tarihVal,
          saat: d && d.saat ? d.saat : '',
          kantar: d && d.kantar ? d.kantar : '',
          malzeme: d && d.malzeme ? d.malzeme : '',
          sevkYeri: d && d.sevkYeri ? d.sevkYeri : '',
          firma: (d && (d.firma || d.firmaKodu || d.firmaSelect)) ? (d.firma || d.firmaKodu || d.firmaSelect) : ''
        };
      } catch {
        return { id: row.id, type: row.type, data: row.data, ts: row.ts, saat: '', kantar: '', malzeme: '', sevkYeri: '' };
      }
    });
    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.post("/reports", async (req, res) => {
  try {
    const body = req.body || {};
    const id = String(body.id || (Date.now().toString() + Math.random().toString(16).slice(2)));
    const type = body.type || "";
    const data = body.data !== undefined ? body.data : body;
    // safe stringify: try JSON.stringify, fallback to string conversion
    let raw = '';
    try {
      raw = (typeof data === "string") ? data : JSON.stringify(data);
    } catch (e) {
      console.error('Report serialization failed, incoming body:', body);
      try { raw = JSON.stringify({ _note: 'serialization_failed', value: String(data) }); } catch (e2) { raw = String(data || ''); }
    }
    const ts = Number(body.ts || Date.now());

    await q(
      `
      INSERT INTO report(id, type, data, ts)
      VALUES($1,$2,$3,$4)
      ON CONFLICT (id) DO UPDATE SET
        type = EXCLUDED.type,
        data = EXCLUDED.data,
        ts = EXCLUDED.ts
      `,
      [id, type, raw, ts]
    );

    res.json({ ok: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.delete("/reports", async (req, res) => {
  try {
    await q("DELETE FROM report");
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Migration: remove legacy lastPrintedAt from vehicles and reports, replace with date-only "tarih"
api.post('/migrate/remove-lastPrintedAt', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let vUpdated = 0;
    let rUpdated = 0;

    // Vehicles
    const vr = await client.query('SELECT id, data FROM vehicles');
    for (const row of (vr.rows || [])) {
      try {
        const obj = JSON.parse(row.data || '{}');
        if (obj && obj.lastPrintedAt !== undefined && obj.lastPrintedAt !== null) {
          try { obj.tarih = new Date(Number(obj.lastPrintedAt)).toLocaleDateString('tr-TR'); } catch(e) { obj.tarih = ''; }
          try { delete obj.lastPrintedAt; } catch(e) {}
          const raw = JSON.stringify(obj);
          await client.query('UPDATE vehicles SET data = $1 WHERE id = $2', [raw, row.id]);
          vUpdated++;
        }
      } catch(e){}
    }

    // Reports
    const rr = await client.query('SELECT id, data FROM report');
    for (const row of (rr.rows || [])) {
      try {
        const d = JSON.parse(row.data || '{}');
        if (d && d.lastPrintedAt !== undefined && d.lastPrintedAt !== null) {
          try { d.tarih = new Date(Number(d.lastPrintedAt)).toLocaleDateString('tr-TR'); } catch(e) { d.tarih = ''; }
          try { delete d.lastPrintedAt; } catch(e) {}
          const raw = JSON.stringify(d);
          await client.query('UPDATE report SET data = $1 WHERE id = $2', [raw, row.id]);
          rUpdated++;
        }
      } catch(e){}
    }

    await client.query('COMMIT');
    res.json({ ok: true, vehiclesUpdated: vUpdated, reportsUpdated: rUpdated });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Problems
api.get("/problems", async (req, res) => {
  try {
    const plateQuery = req.query.plate || "";
    if (plateQuery) {
      const plate = String(plateQuery || "");
      const r = await q("SELECT id, data FROM problems WHERE plate = $1 ORDER BY ts DESC", [plate]);
      const parsed = (r.rows || []).map((row) => {
        try { return Object.assign({ id: row.id }, JSON.parse(row.data)); }
        catch { return { id: row.id, raw: row.data }; }
      });
      return res.json(parsed);
    }

    const r = await q("SELECT id, data, plate FROM problems ORDER BY ts DESC");
    const parsed = (r.rows || []).map((row) => {
      try { return Object.assign({ id: row.id, plate: row.plate }, JSON.parse(row.data)); }
      catch { return { id: row.id, plate: row.plate, raw: row.data }; }
    });
    res.json(parsed);
  } catch (err) {
    console.error("GET /problems SQL error", err);
    res.status(500).json({ error: err.message });
  }
});

api.get("/problems/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const r = await q("SELECT data FROM problems WHERE id = $1", [id]);
    if (!r.rows[0]) return res.status(404).json({ error: "Not found" });
    try { return res.json(JSON.parse(r.rows[0].data)); } catch { return res.json({ raw: r.rows[0].data }); }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.post("/problems", async (req, res) => {
  try {
    const body = req.body || {};
    const id = String(body.id || (Date.now().toString() + Math.random().toString(16).slice(2)));
    const plate = String(body.plate || "");
    const data = body.data !== undefined ? body.data : body;
    const raw = (typeof data === "string") ? data : JSON.stringify(data);
    const ts = Number(body.ts || Date.now());

    await q(
      `
      INSERT INTO problems(id, plate, data, ts)
      VALUES($1,$2,$3,$4)
      ON CONFLICT (id) DO UPDATE SET
        plate = EXCLUDED.plate,
        data = EXCLUDED.data,
        ts = EXCLUDED.ts
      `,
      [id, plate, raw, ts]
    );

    res.json({ ok: true, id });
  } catch (err) {
    console.error("POST /problems SQL error", err);
    res.status(500).json({ error: err.message });
  }
});

api.put("/problems/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const body = req.body || {};
    const plate = String(body.plate || "");
    const data = body.data !== undefined ? body.data : body;
    const raw = (typeof data === "string") ? data : JSON.stringify(data);
    const ts = Number(body.ts || Date.now());

    await q(
      `
      INSERT INTO problems(id, plate, data, ts)
      VALUES($1,$2,$3,$4)
      ON CONFLICT (id) DO UPDATE SET
        plate = EXCLUDED.plate,
        data = EXCLUDED.data,
        ts = EXCLUDED.ts
      `,
      [id, plate, raw, ts]
    );

    res.json({ ok: true, id });
  } catch (err) {
    console.error("PUT /problems/:id SQL error", err);
    res.status(500).json({ error: err.message });
  }
});

api.delete("/problems/:id", async (req, res) => {
  try {
    const id = req.params.id;
    await q("DELETE FROM problems WHERE id = $1", [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /problems/:id SQL error", err);
    res.status(500).json({ error: err.message });
  }
});

api.delete("/problems/plate/:plate", async (req, res) => {
  try {
    const plate = String(req.params.plate || "");
    await q("DELETE FROM problems WHERE plate = $1", [plate]);
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /problems/plate/:plate SQL error", err);
    res.status(500).json({ error: err.message });
  }
});

api.delete("/problems", async (req, res) => {
  try {
    await q("DELETE FROM problems");
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /problems SQL error", err);
    res.status(500).json({ error: err.message });
  }
});

// Migration helper: migrate legacy kv_store.report_events_v1 into report table
api.post("/migrate/reports-from-kv", async (req, res) => {
  try {
    const r = await q("SELECT value FROM kv_store WHERE key = $1", ["report_events_v1"]);
    if (!r.rows[0]) return res.status(404).json({ error: "no kv report_events_v1" });

    let arr = [];
    try { arr = JSON.parse(r.rows[0].value); } catch { return res.status(400).json({ error: "invalid json in kv" }); }
    if (!Array.isArray(arr)) return res.status(400).json({ error: "expected array" });

    let processed = 0;
    for (const it of arr) {
      try {
        const id = it.id || ("EV" + Date.now().toString(36) + Math.random().toString(16).slice(2));
        const type = it.type || "";
        const data = (typeof it.data === "string") ? it.data : JSON.stringify(it.data || {});
        const ts = Number(it.ts || Date.now());

        await q(
          `
          INSERT INTO report(id, type, data, ts)
          VALUES($1,$2,$3,$4)
          ON CONFLICT (id) DO UPDATE SET
            type = EXCLUDED.type,
            data = EXCLUDED.data,
            ts = EXCLUDED.ts
          `,
          [id, type, data, ts]
        );
        processed++;
      } catch {}
    }

    res.json({ ok: true, processed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Restore full JSON backup into Postgres
api.post("/restore-full", async (req, res) => {
  const allData = req.body || {};
  const hasStorageDump = allData && allData.storageDump && typeof allData.storageDump === "object";
  const hasVehiclesArray = Array.isArray(allData.vehicles);

  if (!hasStorageDump && !hasVehiclesArray) {
    return res.status(400).json({ error: "invalid backup payload" });
  }

  let processed = 0;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // legacy vehicles array
    if (hasVehiclesArray) {
      for (const vehicle of allData.vehicles) {
        try {
          const id = String(vehicle.id || (Date.now().toString() + Math.random().toString(16).slice(2)));
          const cekiciPlaka = vehicle.cekiciPlaka || "";
          const dorsePlaka = vehicle.dorsePlaka || "";
          const raw = JSON.stringify(Object.assign({}, vehicle, { id }));

          await client.query(
            `
            INSERT INTO vehicles(id, cekiciPlaka, dorsePlaka, data)
            VALUES($1,$2,$3,$4)
            ON CONFLICT (id) DO UPDATE SET
              cekiciPlaka = EXCLUDED.cekiciPlaka,
              dorsePlaka = EXCLUDED.dorsePlaka,
              data = EXCLUDED.data
            `,
            [id, cekiciPlaka, dorsePlaka, raw]
          );
          processed++;
        } catch {}
      }
    }

    if (hasStorageDump) {
      const dump = allData.storageDump;

      // dump.vehicles (stringified array)
      if (dump.vehicles) {
        try {
          const parsedVehicles = typeof dump.vehicles === "string" ? JSON.parse(dump.vehicles) : dump.vehicles;
          if (Array.isArray(parsedVehicles)) {
            for (const vehicle of parsedVehicles) {
              try {
                const id = String(vehicle.id || (Date.now().toString() + Math.random().toString(16).slice(2)));
                const cekiciPlaka = vehicle.cekiciPlaka || "";
                const dorsePlaka = vehicle.dorsePlaka || "";
                const raw = JSON.stringify(Object.assign({}, vehicle, { id }));

                await client.query(
                  `
                  INSERT INTO vehicles(id, cekiciPlaka, dorsePlaka, data)
                  VALUES($1,$2,$3,$4)
                  ON CONFLICT (id) DO UPDATE SET
                    cekiciPlaka = EXCLUDED.cekiciPlaka,
                    dorsePlaka = EXCLUDED.dorsePlaka,
                    data = EXCLUDED.data
                  `,
                  [id, cekiciPlaka, dorsePlaka, raw]
                );
                processed++;
              } catch {}
            }
          }
        } catch {}
      }

      for (const k of Object.keys(dump)) {
        const raw = dump[k];
        let parsed = null;
        try { parsed = JSON.parse(raw); } catch { parsed = null; }

        try {
          if (String(k).startsWith("vehicle_")) {
            const id = String(k).slice(8);
            const dataObj = parsed && typeof parsed === "object" ? parsed : { id, raw: raw };
            const cekiciPlaka = dataObj.cekiciPlaka || "";
            const dorsePlaka = dataObj.dorsePlaka || "";
            const dataRaw = JSON.stringify(Object.assign({}, dataObj, { id }));

            await client.query(
              `
              INSERT INTO vehicles(id, cekiciPlaka, dorsePlaka, data)
              VALUES($1,$2,$3,$4)
              ON CONFLICT (id) DO UPDATE SET
                cekiciPlaka = EXCLUDED.cekiciPlaka,
                dorsePlaka = EXCLUDED.dorsePlaka,
                data = EXCLUDED.data
              `,
              [id, cekiciPlaka, dorsePlaka, dataRaw]
            );
            processed++;
            continue;
          }

          if (String(k).startsWith("auto_backup_")) {
            const id = k;
            const created = parsed && parsed.ts ? (Date.parse(parsed.ts) || Date.now()) : Date.now();
            const dataRaw = JSON.stringify(parsed || raw);

            await client.query(
              `
              INSERT INTO daily_rows(id, plaka, data, created_at)
              VALUES($1,$2,$3,$4)
              ON CONFLICT (id) DO UPDATE SET
                plaka = EXCLUDED.plaka,
                data = EXCLUDED.data,
                created_at = EXCLUDED.created_at
              `,
              [id, "", dataRaw, Number(created)]
            );
            processed++;
            continue;
          }

          // piyasa_state_v1 -> kv_store
          if (k === "piyasa_state_v1") {
            const v = typeof raw === "string" ? raw : JSON.stringify(raw);
            await client.query(
              `
              INSERT INTO kv_store(key, value)
              VALUES($1,$2)
              ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
              `,
              [k, v]
            );
            processed++;
            continue;
          }

          // default: kv_store
          const v = typeof raw === "string" ? raw : JSON.stringify(raw);
          await client.query(
            `
            INSERT INTO kv_store(key, value)
            VALUES($1,$2)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
            `,
            [k, v]
          );
          processed++;
        } catch {}
      }
    }

    await client.query("COMMIT");
    res.json({ ok: true, processed });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Health
api.get("/health", (req, res) => res.json({ ok: true }));

app.use("/api", api);
app.use(api);

const PORT = process.env.PORT || 3000;

(async () => {
  try {
    await prepareSchema();
    console.log("Connected to PostgreSQL and ensured schema.");

    // Run cleanup once at startup (non-destructive safe run)
    deleteOldReports().catch(() => {});

    // Schedule monthly cleanup using node-cron. Cron expression can be overridden
    // with REPORT_CLEAN_CRON env var (default: midnight on the 1st of each month).
    try {
      cron.schedule(REPORT_CLEAN_CRON, () => {
        console.log('Running scheduled monthly report cleanup');
        deleteOldReports().catch((e) => console.error('Scheduled cleanup error:', e));
      }, { timezone: process.env.CRON_TIMEZONE || 'Europe/Istanbul' });
      console.log('Scheduled monthly report cleanup:', REPORT_CLEAN_CRON);
    } catch (e) {
      console.error('Failed to schedule monthly cleanup:', e.message || e);
    }

    app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
  } catch (e) {
    console.error("Startup failed:", e);
    process.exit(1);
  }
})();
