const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

function authorized(request, secret) {
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
}
const id = () => crypto.randomUUID();
const validChoice = (value) => ["yes", "no", "unknown"].includes(value);

async function companyById(DB, companyId) {
  const result = await DB.prepare("SELECT id, qualification_status, customer_status, contacted_status, active_process_status, commercial_status FROM companies WHERE id = ? LIMIT 1").bind(companyId).all();
  return result.results?.[0] || null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "leadpilot-api", database_configured: Boolean(env.DB) });
    }
    if (!env.DB) return json({ ok: false, error: "D1 binding DB is not configured." }, 503);

    if (url.pathname.startsWith("/api/") && !authorized(request, env.ADMIN_TOKEN)) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    if (request.method === "GET" && url.pathname === "/api/companies") {
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 50), 1), 100);
      const filters = [];
      const values = [];
      const q = (url.searchParams.get("q") || "").trim().slice(0, 100);
      if (q) {
        filters.push("(name LIKE ? OR nif LIKE ? OR sector LIKE ?)");
        values.push(`%${q}%`, `%${q}%`, `%${q}%`);
      }
      for (const key of ["qualification_status", "commercial_status", "evidence_type"]) {
        const value = url.searchParams.get(key);
        if (value) {
          const allowed = {
            qualification_status: ["pending", "approved", "rejected"],
            commercial_status: ["pending_review", "eligible", "not_contact"],
            evidence_type: ["competitor_confirmed", "awardee", "potential", "unverified"]
          };
          if (!allowed[key].includes(value)) return json({ ok: false, error: `Invalid ${key} filter.` }, 400);
          filters.push(`${key} = ?`);
          values.push(value);
        }
      }
      const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
      const result = await env.DB.prepare(
        `SELECT id, nif, name, municipality, district, sector, evidence_type, qualification_status, qualification_notes, customer_status, contacted_status, active_process_status, commercial_notes, commercial_status, source_url, last_seen_at FROM companies ${where} ORDER BY last_seen_at DESC LIMIT ?`
      ).bind(...values, limit).all();
      return json({ ok: true, companies: result.results || [] });
    }

    const qualificationMatch = url.pathname.match(/^\/api\/companies\/([^/]+)\/qualification$/);
    if (request.method === "PATCH" && qualificationMatch) {
      const companyId = decodeURIComponent(qualificationMatch[1]);
      const body = await request.json().catch(() => null);
      if (!body || !["approved", "rejected", "pending"].includes(body.status)) {
        return json({ ok: false, error: "Status must be approved, rejected or pending." }, 400);
      }
      const company = await companyById(env.DB, companyId);
      if (!company) return json({ ok: false, error: "Company not found." }, 404);
      const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 1000) : null;
      await env.DB.batch([
        env.DB.prepare("UPDATE companies SET qualification_status = ?, qualification_notes = ?, qualified_at = CASE WHEN ? = 'approved' THEN CURRENT_TIMESTAMP ELSE NULL END, commercial_status = CASE WHEN ? = 'approved' THEN commercial_status ELSE 'pending_review' END, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(body.status, notes, body.status, body.status, companyId),
        env.DB.prepare("INSERT INTO company_events (id, company_id, event_type, summary) VALUES (?, ?, 'qualification_changed', ?)").bind(id(), companyId, `Qualificação: ${company.qualification_status} → ${body.status}`)
      ]);
      return json({ ok: true, company_id: companyId, qualification_status: body.status });
    }

    const commercialMatch = url.pathname.match(/^\/api\/companies\/([^/]+)\/commercial-check$/);
    if (request.method === "PATCH" && commercialMatch) {
      const companyId = decodeURIComponent(commercialMatch[1]);
      const body = await request.json().catch(() => null);
      if (!body || !validChoice(body.customer_status) || !validChoice(body.contacted_status) ||
          !validChoice(body.active_process_status) || !["pending_review", "eligible", "not_contact"].includes(body.commercial_status)) {
        return json({ ok: false, error: "Provide valid yes/no/unknown answers and a valid commercial status." }, 400);
      }
      const company = await companyById(env.DB, companyId);
      if (!company) return json({ ok: false, error: "Company not found." }, 404);
      if (company.qualification_status !== "approved") return json({ ok: false, error: "Only qualified companies can receive a commercial check." }, 409);
      if (body.commercial_status === "eligible" &&
          (body.customer_status !== "no" || body.active_process_status !== "no")) {
        return json({ ok: false, error: "Eligibility requires customer=no and active_process=no." }, 409);
      }
      const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 1500) : null;
      await env.DB.batch([
        env.DB.prepare("UPDATE companies SET customer_status = ?, contacted_status = ?, active_process_status = ?, commercial_notes = ?, commercial_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
          .bind(body.customer_status, body.contacted_status, body.active_process_status, notes, body.commercial_status, companyId),
        env.DB.prepare("INSERT INTO company_events (id, company_id, event_type, summary) VALUES (?, ?, 'commercial_check_changed', ?)")
          .bind(id(), companyId, `Cliente=${body.customer_status}; contactada=${body.contacted_status}; processo=${body.active_process_status}; estado=${body.commercial_status}`)
      ]);
      return json({ ok: true, company_id: companyId, commercial_status: body.commercial_status });
    }

    if (request.method === "GET" && url.pathname === "/api/companies/events") {
      const companyId = url.searchParams.get("company_id");
      if (!companyId) return json({ ok: false, error: "company_id is required." }, 400);
      const result = await env.DB.prepare("SELECT event_type, summary, created_at FROM company_events WHERE company_id = ? ORDER BY created_at DESC LIMIT 50").bind(companyId).all();
      return json({ ok: true, events: result.results || [] });
    }

    if (request.method === "POST" && url.pathname === "/api/decision-makers") {
      const body = await request.json().catch(() => null);
      if (!body || typeof body.company_id !== "string" || typeof body.full_name !== "string" || !body.full_name.trim()) {
        return json({ ok: false, error: "company_id and full_name are required." }, 400);
      }
      const company = await companyById(env.DB, body.company_id);
      if (!company) return json({ ok: false, error: "Company not found." }, 404);
      if (company.qualification_status !== "approved" || company.commercial_status !== "eligible" ||
          company.customer_status !== "no" || company.active_process_status !== "no") {
        return json({ ok: false, error: "Decision-maker research is blocked until the company is explicitly eligible for prospecting." }, 409);
      }
      const personId = id();
      await env.DB.prepare("INSERT INTO decision_makers (id, company_id, full_name, job_title, professional_profile_url, source_url, provider) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(personId, body.company_id, body.full_name.trim().slice(0, 160),
          typeof body.job_title === "string" ? body.job_title.trim().slice(0, 120) : null,
          typeof body.profile_url === "string" ? body.profile_url.trim().slice(0, 500) : null,
          typeof body.source_url === "string" ? body.source_url.trim().slice(0, 500) : null,
          typeof body.source === "string" ? body.source.trim().slice(0, 40) : "manual").run();
      return json({ ok: true, decision_maker_id: personId }, 201);
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
