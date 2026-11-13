const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

function authorized(request, secret) {
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
}
const id = () => crypto.randomUUID();
const SESSION_COOKIE = "__Host-leadpilot_session";
const SESSION_TTL = 60 * 60 * 12;

function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("=", "").replaceAll("+", "-").replaceAll("/", "_");
}
function fromBase64url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
async function hmac(value, secret) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}
async function safeEqual(a, b) {
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(a))),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(b)))
  ]);
  const x = new Uint8Array(left), y = new Uint8Array(right);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
function cookieValue(request, name) {
  const entry = (request.headers.get("cookie") || "").split(";").map(v => v.trim()).find(v => v.startsWith(name + "="));
  return entry ? entry.slice(name.length + 1) : "";
}
function originAllowed(request, env) {
  return Boolean(env.APP_ORIGIN) && request.headers.get("origin") === env.APP_ORIGIN;
}
async function createSession(secret) {
  const payload = base64url(new TextEncoder().encode(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + SESSION_TTL })));
  return payload + "." + base64url(await hmac(payload, secret));
}
async function validSession(request, secret) {
  if (!secret) return false;
  const token = cookieValue(request, SESSION_COOKIE);
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return false;
  try {
    const expected = await hmac(payload, secret);
    if (!(await safeEqual(base64url(expected), signature))) return false;
    const data = JSON.parse(new TextDecoder().decode(fromBase64url(payload)));
    return Number.isInteger(data.exp) && data.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}
const sessionCookie = (value, maxAge = SESSION_TTL) => `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
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
    if (request.method === "POST" && url.pathname === "/auth/login") {
      if (!originAllowed(request, env)) return json({ ok: false, error: "Invalid origin." }, 403);
      if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
        return json({ ok: false, error: "Authentication is not configured securely." }, 503);
      }
      const body = await request.json().catch(() => null);
      if (!body || typeof body.password !== "string" || !(await safeEqual(body.password, env.ADMIN_PASSWORD))) {
        return json({ ok: false, error: "Invalid credentials." }, 401);
      }
      const token = await createSession(env.SESSION_SECRET);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "set-cookie": sessionCookie(token) }
      });
    }
    if (request.method === "GET" && url.pathname === "/auth/session") {
      const authenticated = await validSession(request, env.SESSION_SECRET);
      return json({ ok: true, authenticated });
    }
    if (request.method === "POST" && url.pathname === "/auth/logout") {
      if (!originAllowed(request, env)) return json({ ok: false, error: "Invalid origin." }, 403);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "set-cookie": sessionCookie("", 0) }
      });
    }

    if (url.pathname.startsWith("/api/")) {
      if (!(await validSession(request, env.SESSION_SECRET))) return json({ ok: false, error: "Unauthorized" }, 401);
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && !originAllowed(request, env)) {
        return json({ ok: false, error: "Invalid origin." }, 403);
      }
    }
    if (!env.DB) return json({ ok: false, error: "D1 binding DB is not configured." }, 503);

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

    const procurementMatch = url.pathname.match(/^\/api\/companies\/([^/]+)\/procurements$/);
    if (request.method === "GET" && procurementMatch) {
      const companyId = decodeURIComponent(procurementMatch[1]);
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 20), 1), 20);
      const summary = await env.DB.prepare(
        "SELECT COUNT(*) AS total_contracts, COALESCE(SUM(contract_value), 0) AS total_value, MAX(publication_date) AS latest_date FROM procurements WHERE company_id = ?"
      ).bind(companyId).all();
      const rows = await env.DB.prepare(
        "SELECT source_id, participant_role, procedure_type, cpv, description, contracting_authority, contract_value, publication_date, procedure_url FROM procurements WHERE company_id = ? ORDER BY publication_date DESC LIMIT ?"
      ).bind(companyId, limit).all();
      return json({ ok: true, summary: summary.results?.[0] || { total_contracts: 0, total_value: 0, latest_date: null }, procurements: rows.results || [] });
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
      const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 1500) : null;
      const nextCommercialStatus = body.customer_status === "yes"
        ? "not_contact"
        : (body.active_process_status !== "no" && body.commercial_status === "eligible" ? "pending_review" : body.commercial_status);
      await env.DB.batch([
        env.DB.prepare("UPDATE companies SET customer_status = ?, contacted_status = ?, active_process_status = ?, commercial_notes = ?, commercial_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
          .bind(body.customer_status, body.contacted_status, body.active_process_status, notes, nextCommercialStatus, companyId),
        env.DB.prepare("INSERT INTO company_events (id, company_id, event_type, summary) VALUES (?, ?, 'commercial_check_changed', ?)")
          .bind(id(), companyId, `Cliente=${body.customer_status}; contactada=${body.contacted_status}; processo=${body.active_process_status}; estado=${nextCommercialStatus}`)
      ]);
      return json({ ok: true, company_id: companyId, commercial_status: nextCommercialStatus });
    }

    const peopleMatch = url.pathname.match(/^\/api\/companies\/([^/]+)\/decision-makers$/);
    if (request.method === "GET" && peopleMatch) {
      const companyId = decodeURIComponent(peopleMatch[1]);
      const result = await env.DB.prepare(
        "SELECT id, full_name, job_title, professional_profile_url, source_url, provider, created_at FROM decision_makers WHERE company_id = ? ORDER BY created_at DESC LIMIT 50"
      ).bind(companyId).all();
      return json({ ok: true, decision_makers: result.results || [] });
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

    if (request.method === "POST" && url.pathname === "/internal/import/batch") {
      if (!authorized(request, env.INGEST_SECRET)) return json({ ok: false, error: "Unauthorized" }, 401);
      const body = await request.json().catch(() => null);
      if (!body || !Array.isArray(body.companies) || !Array.isArray(body.procurements) ||
          body.companies.length + body.procurements.length > 100) {
        return json({ ok: false, error: "Expected companies and procurements arrays with at most 100 combined records." }, 400);
      }
      const statements = [];
      const companyIds = new Set();
      for (const item of body.companies) {
        if (!item || typeof item.id !== "string" || !item.id.trim() ||
            typeof item.name !== "string" || !item.name.trim()) {
          return json({ ok: false, error: "Every company needs a stable id and non-empty name." }, 400);
        }
        companyIds.add(item.id);
        const evidence = ["awardee", "competitor_confirmed"].includes(item.evidence_type) ? item.evidence_type : "unverified";
        statements.push(env.DB.prepare(
          `INSERT INTO companies (id, nif, name, municipality, district, sector, source_url, evidence_type, last_seen_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT(id) DO UPDATE SET nif=excluded.nif, name=excluded.name,
             municipality=COALESCE(excluded.municipality, companies.municipality),
             district=COALESCE(excluded.district, companies.district),
             sector=COALESCE(excluded.sector, companies.sector),
             source_url=COALESCE(excluded.source_url, companies.source_url),
             evidence_type=CASE WHEN companies.evidence_type = 'competitor_confirmed' OR excluded.evidence_type = 'competitor_confirmed' THEN 'competitor_confirmed' WHEN companies.evidence_type = 'awardee' OR excluded.evidence_type = 'awardee' THEN 'awardee' ELSE excluded.evidence_type END, last_seen_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP`
        ).bind(item.id, item.nif || null, item.name.trim().slice(0, 200),
          typeof item.municipality === "string" ? item.municipality.slice(0, 100) : null,
          typeof item.district === "string" ? item.district.slice(0, 100) : null,
          typeof item.sector === "string" ? item.sector.slice(0, 120) : null,
          typeof item.source_url === "string" ? item.source_url.slice(0, 500) : null, evidence));
      }
      const allowedRoles = ["awardee", "competitor_confirmed", "unknown"];
      for (const item of body.procurements) {
        if (!item || typeof item.source_id !== "string" || !item.source_id.trim() ||
            typeof item.company_id !== "string" || !item.company_id.trim() ||
            !item.company_name || !String(item.company_name).trim()) {
          return json({ ok: false, error: "Every procurement needs a source_id and associated company." }, 400);
        }
        const role = allowedRoles.includes(item.participant_role) ? item.participant_role : "unknown";
        const procurementId = "base:" + item.source_id.trim().slice(0, 140) + ":" + item.company_id.slice(0, 120);
        if (!companyIds.has(item.company_id)) {
          statements.push(env.DB.prepare("INSERT OR IGNORE INTO companies (id, nif, name, evidence_type) VALUES (?, ?, ?, 'awardee')")
            .bind(item.company_id, item.company_nif || null, String(item.company_name).trim().slice(0, 200)));
        }
        statements.push(env.DB.prepare(
          `INSERT INTO procurements (id, source_id, company_id, participant_role, procedure_type, cpv, description, contracting_authority, contract_value, publication_date, procedure_url, source_dataset)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'BASE/IMPIC')
           ON CONFLICT(id) DO UPDATE SET company_id=excluded.company_id, participant_role=excluded.participant_role,
             procedure_type=excluded.procedure_type, cpv=excluded.cpv, description=excluded.description,
             contracting_authority=excluded.contracting_authority, contract_value=excluded.contract_value,
             publication_date=excluded.publication_date, procedure_url=excluded.procedure_url`
        ).bind(procurementId, item.source_id.trim().slice(0, 180), item.company_id, role,
          typeof item.procedure_type === "string" ? item.procedure_type.slice(0, 100) : null,
          typeof item.cpv === "string" ? item.cpv.slice(0, 30) : null,
          typeof item.description === "string" ? item.description.slice(0, 500) : null,
          typeof item.contracting_authority === "string" ? item.contracting_authority.slice(0, 200) : null,
          Number.isFinite(Number(item.contract_value)) ? Number(item.contract_value) : null,
          typeof item.publication_date === "string" ? item.publication_date.slice(0, 10) : null,
          typeof item.procedure_url === "string" ? item.procedure_url.slice(0, 500) : null));
      }
      const result = statements.length ? await env.DB.batch(statements) : [];
      return json({ ok: true, companies_received: body.companies.length, procurements_received: body.procurements.length, statements_executed: result.length });
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
