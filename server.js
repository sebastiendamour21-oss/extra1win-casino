const express = require("express");
const { Pool } = require("pg");
const path = require("path");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined
});

const promoCode = process.env.PROMO_CODE || "EXTRAWIN5";
const freeDays = Number(process.env.FREE_DAYS || 7);

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      id BIGSERIAL PRIMARY KEY,
      public_id TEXT UNIQUE NOT NULL,
      promo_code TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS game_results (
      id BIGSERIAL PRIMARY KEY,
      game TEXT NOT NULL,
      result JSONB NOT NULL,
      source TEXT NOT NULL DEFAULT 'authorized_feed',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS predictions (
      id BIGSERIAL PRIMARY KEY,
      public_id TEXT,
      game TEXT NOT NULL,
      prediction JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, database: "connected" });
  } catch (e) {
    res.status(503).json({ ok: false, error: "Database not ready" });
  }
});

app.post("/api/register", async (req, res) => {
  const publicId = String(req.body.publicId || "").trim();
  const code = String(req.body.promo || "").trim();
  if (!publicId || !code) return res.status(400).json({ error: "Identifiant public et code promo requis." });
  if (code !== promoCode) return res.status(403).json({ error: "Code promo invalide." });

  try {
    const existing = await pool.query("SELECT public_id, expires_at FROM players WHERE public_id=$1", [publicId]);
    if (existing.rowCount) {
      return res.json({ ok: true, expiresAt: existing.rows[0].expires_at, message: "Profil déjà enregistré." });
    }
    const inserted = await pool.query(
      "INSERT INTO players(public_id,promo_code,expires_at) VALUES($1,$2,NOW()+($3 || ' days')::interval) RETURNING expires_at",
      [publicId, code, String(freeDays)]
    );
    res.json({ ok: true, expiresAt: inserted.rows[0].expires_at, message: `Accès activé pour ${freeDays} jours.` });
  } catch (e) {
    res.status(500).json({ error: "Erreur serveur." });
  }
});

app.get("/api/results/:game", async (req, res) => {
  const game = String(req.params.game);
  if (!["crash", "lucky-jet", "mines", "aviator"].includes(game)) return res.status(400).json({ error: "Jeu inconnu." });
  try {
    const rows = await pool.query("SELECT result, created_at FROM game_results WHERE game=$1 ORDER BY created_at DESC LIMIT 100", [game]);
    res.json({ game, results: rows.rows });
  } catch (e) { res.status(500).json({ error: "Erreur serveur." }); }
});

app.post("/api/analyze", async (req, res) => {
  const game = String(req.body.game || "");
  const publicId = String(req.body.publicId || "").trim();
  if (!["crash", "lucky-jet", "mines", "aviator"].includes(game)) return res.status(400).json({ error: "Jeu inconnu." });
  try {
    if (publicId) {
      const player = await pool.query("SELECT expires_at FROM players WHERE public_id=$1", [publicId]);
      if (!player.rowCount || new Date(player.rows[0].expires_at) < new Date()) return res.status(403).json({ error: "Accès expiré ou profil non activé." });
    }
    const data = await pool.query("SELECT result FROM game_results WHERE game=$1 ORDER BY created_at DESC LIMIT 100", [game]);
    const values = data.rows.map(r => r.result).filter(x => typeof x.multiplier === "number").map(x => x.multiplier);
    const average = values.length ? values.reduce((a,b)=>a+b,0)/values.length : null;
    const prediction = {
      type: "statistical_summary",
      sampleSize: values.length,
      averageMultiplier: average,
      note: "Analyse descriptive de l'historique reçu. Les jeux restent aléatoires; aucune prédiction ne garantit un gain."
    };
    await pool.query("INSERT INTO predictions(public_id,game,prediction) VALUES($1,$2,$3)", [publicId || null, game, prediction]);
    res.json(prediction);
  } catch (e) { res.status(500).json({ error: "Erreur serveur." }); }
});

app.post("/api/ingest", async (req, res) => {
  if (!process.env.INGEST_API_KEY || req.get("x-ingest-key") !== process.env.INGEST_API_KEY) {
    return res.status(401).json({ error: "Non autorisé." });
  }
  const { game, result, source } = req.body || {};
  if (!["crash", "lucky-jet", "mines", "aviator"].includes(game) || !result || typeof result !== "object") {
    return res.status(400).json({ error: "Données invalides." });
  }
  try {
    await pool.query("INSERT INTO game_results(game,result,source) VALUES($1,$2,$3)", [game, result, source || "authorized_feed"]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: "Erreur serveur." }); }
});

app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const port = process.env.PORT || 10000;
init().then(() => app.listen(port, "0.0.0.0", () => console.log(`EXTRA 1WIN server listening on ${port}`)))
  .catch(err => { console.error("Database initialization failed:", err); process.exit(1); });
