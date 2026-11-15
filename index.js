const GAMES = new Set(["crash", "lucky-jet", "mines", "aviator"]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, x-ingest-key"
    }
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return json({}, 204);
    if (!env.Db) return json({ error: "D1 binding Db not found" }, 500);

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === "/api/health" && request.method === "GET") {
        return json({ status: "online", service: "EXTRA 1WIN" });
      }

      if (path === "/api/register" && request.method === "POST") {
        const body = await request.json();
        const publicId = String(body.publicId || "").trim();
        const promo = String(body.promoCode || "").trim();
        if (!publicId || !promo) return json({ error: "Identifiant et code promo obligatoires" }, 400);

        const setting = await env.Db.prepare(
          "SELECT promo_code, free_days, active FROM promo_settings WHERE id = 1"
        ).first();

        if (!setting || Number(setting.active) !== 1 || promo !== setting.promo_code) {
          return json({ error: "Code promo invalide ou désactivé" }, 403);
        }

        const existing = await env.Db.prepare(
          "SELECT id, expires_at, active FROM players WHERE public_id = ?"
        ).bind(publicId).first();

        if (existing) {
          return json({
            message: "Profil déjà enregistré",
            expiresAt: existing.expires_at,
            active: Number(existing.active) === 1
          });
        }

        const now = new Date();
        const expires = new Date(now.getTime() + Number(setting.free_days || 7) * 86400000);
        await env.Db.prepare(
          "INSERT INTO players (public_id, promo_code, created_at, expires_at, active) VALUES (?, ?, ?, ?, 1)"
        ).bind(publicId, promo, now.toISOString(), expires.toISOString()).run();

        return json({ message: "Inscription réussie", expiresAt: expires.toISOString() });
      }

      if (path.startsWith("/api/results/") && request.method === "GET") {
        const game = path.split("/").pop();
        if (!GAMES.has(game)) return json({ error: "Jeu inconnu" }, 400);
        const results = await env.Db.prepare(
          "SELECT result, created_at FROM game_results WHERE game = ? ORDER BY id DESC LIMIT 100"
        ).bind(game).all();
        return json({ game, results: results.results || [] });
      }

      if (path === "/api/analyze" && request.method === "POST") {
        const body = await request.json();
        const publicId = String(body.publicId || "").trim();
        const game = String(body.game || "").trim();
        if (!publicId || !GAMES.has(game)) return json({ error: "Identifiant ou jeu invalide" }, 400);

        const player = await env.Db.prepare(
          "SELECT id, expires_at, active FROM players WHERE public_id = ?"
        ).bind(publicId).first();

        if (!player || Number(player.active) !== 1 || new Date(player.expires_at) <= new Date()) {
          return json({ error: "Accès absent ou expiré" }, 403);
        }

        const history = await env.Db.prepare(
          "SELECT result FROM game_results WHERE game = ? ORDER BY id DESC LIMIT 100"
        ).bind(game).all();

        const values = (history.results || []).map(row => Number(row.result)).filter(Number.isFinite);
        if (!values.length) {
          return json({
            game, count: 0,
            message: "Aucun résultat enregistré. Cette analyse décrit l'historique et ne prédit pas le prochain résultat."
          });
        }

        const sorted = [...values].sort((a, b) => a - b);
        const average = values.reduce((a, b) => a + b, 0) / values.length;
        const median = sorted[Math.floor(sorted.length / 2)];
        const below2 = values.filter(v => v < 2).length;

        return json({
          game,
          count: values.length,
          average: Number(average.toFixed(2)),
          median: Number(median.toFixed(2)),
          below2Percent: Number((below2 / values.length * 100).toFixed(1)),
          message: "Statistiques descriptives uniquement : elles ne prédisent pas le prochain résultat et ne garantissent aucun gain."
        });
      }

      if (path === "/api/ingest" && request.method === "POST") {
        if (!env.INGEST_API_KEY || request.headers.get("x-ingest-key") !== env.INGEST_API_KEY) {
          return json({ error: "Accès refusé" }, 401);
        }
        const body = await request.json();
        const game = String(body.game || "");
        const result = String(body.result ?? "");
        if (!GAMES.has(game) || !result || result.length > 100) {
          return json({ error: "Résultat invalide" }, 400);
        }
        await env.Db.prepare(
          "INSERT INTO game_results (game, result, created_at) VALUES (?, ?, ?)"
        ).bind(game, result, new Date().toISOString()).run();
        return json({ message: "Résultat enregistré" });
      }

      return json({ error: "Route introuvable" }, 404);
    } catch (error) {
      return json({ error: "Erreur serveur", details: String(error.message || error) }, 500);
    }
  }
};
