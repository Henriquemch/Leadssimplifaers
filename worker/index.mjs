const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

function authorized(request, secret) {
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "leadpilot-api", database_configured: Boolean(env.DB) });
    }
    if (!env.DB) return json({ ok: false, error: "D1 binding DB is not configured." }, 503);

    if (request.method === "GET" && url.pathname === "/api/companies") {
      if (!authorized(request, env.ADMIN_TOKEN)) return json({ ok: false, error: "Unauthorized" }, 401);
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 50), 1), 100);
      const result = await env.DB.prepare(
        "SELECT id, nif, name, municipality, district, sector, evidence_type, source_url, last_seen_at FROM companies ORDER BY last_seen_at DESC LIMIT ?"
      ).bind(limit).all();
      return json({ ok: true, companies: result.results || [] });
    }

    if (request.method === "POST" && url.pathname === "/internal/companies/batch") {
      if (!authorized(request, env.INGEST_SECRET)) return json({ ok: false, error: "Unauthorized" }, 401);
      const body = await request.json().catch(() => null);
      if (!body || !Array.isArray(body.companies) || body.companies.length > 100) {
        return json({ ok: false, error: "Expected a companies array with at most 100 records." }, 400);
      }
      const statements = [];
      for (const item of body.companies) {
        if (!item || typeof item.name !== "string" || !item.name.trim() || typeof item.id !== "string" || !item.id.trim()) {
          return json({ ok: false, error: "Every company needs a stable id and non-empty name." }, 400);
        }
        const evidence = ["competitor_confirmed", "awardee", "potential", "unverified"].includes(item.evidence_type)
          ? item.evidence_type : "unverified";
        statements.push(env.DB.prepare(
          `INSERT INTO companies (id, nif, name, municipality, district, sector, website, source_url, evidence_type, last_seen_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT(id) DO UPDATE SET
             nif=excluded.nif, name=excluded.name, municipality=excluded.municipality,
             district=excluded.district, sector=excluded.sector, website=excluded.website,
             source_url=excluded.source_url, evidence_type=excluded.evidence_type,
             last_seen_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP`
        ).bind(item.id, item.nif || null, item.name.trim(), item.municipality || null, item.district || null,
          item.sector || null, item.website || null, item.source_url || null, evidence));
      }
      const result = await env.DB.batch(statements);
      return json({ ok: true, received: body.companies.length, executed: result.length });
    }
    return json({ ok: false, error: "Not found" }, 404);
  }
};
