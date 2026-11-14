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

    if (request.method === "GET" && url.pathname === "/api/discovery/search") {
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 30), 1), 30);
      const filters = ["NOT EXISTS (SELECT 1 FROM lead_registry lr WHERE lr.nif = d.nif)", "NOT EXISTS (SELECT 1 FROM companies l WHERE l.nif = d.nif)", "NOT EXISTS (SELECT 1 FROM lead_exclusions x WHERE x.nif = d.nif AND x.active = 1)"];
      const values = [];
      const q = (url.searchParams.get("q") || "").trim().slice(0, 100);
      if (q) { filters.push("(d.name LIKE ? OR d.nif LIKE ?)"); values.push("%" + q + "%", "%" + q + "%"); }
      const cpv = (url.searchParams.get("cpv") || "").trim().replace(/[^0-9-]/g, "").slice(0, 12);
      const sector = (url.searchParams.get("sector") || "").trim().slice(0, 100);
      if (cpv && sector) return json({ok:false,error:"Escolhe setor ou CPV, não ambos."},400);
      if (cpv) { filters.push("EXISTS (SELECT 1 FROM discovery_contracts dc WHERE dc.nif = d.nif AND dc.cpv LIKE ?)"); values.push(cpv + "%"); }
      if (sector) { filters.push("EXISTS (SELECT 1 FROM discovery_contracts dc WHERE dc.nif = d.nif AND (dc.description LIKE ? OR dc.cpv LIKE ?))"); values.push("%" + sector + "%", "%" + sector + "%"); }
      const fromDate = (url.searchParams.get("from_date") || "").trim();
      if (fromDate) { if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || Number.isNaN(Date.parse(fromDate))) return json({ok:false,error:"Invalid from_date."},400); filters.push("d.latest_contract_date >= ?"); values.push(fromDate); }
      const minValue = url.searchParams.get("min_value"), maxValue = url.searchParams.get("max_value");
      let minNumber = null, maxNumber = null;
      if (minValue !== null && minValue !== "") { minNumber=Number(minValue); if(!Number.isFinite(minNumber)||minNumber<0)return json({ok:false,error:"Invalid min_value."},400); filters.push("d.awarded_value_total >= ?"); values.push(minNumber); }
      if (maxValue !== null && maxValue !== "") { maxNumber=Number(maxValue); if(!Number.isFinite(maxNumber)||maxNumber<0)return json({ok:false,error:"Invalid max_value."},400); filters.push("d.awarded_value_total <= ?"); values.push(maxNumber); }
      if (minNumber !== null && maxNumber !== null && minNumber > maxNumber) return json({ok:false,error:"min_value cannot exceed max_value."},400);
      const role = url.searchParams.get("role"); if (role && !["awardee","competitor_confirmed"].includes(role)) return json({ok:false,error:"Invalid role filter."},400); if (role === "awardee") filters.push("d.awardee_contract_count > 0"); if (role === "competitor_confirmed") filters.push("d.competitor_contract_count > 0");
      const sql = "SELECT d.id,d.nif,d.name,d.evidence_type,d.contract_count,d.awardee_contract_count,d.competitor_contract_count,d.awarded_value_total,d.latest_contract_date,d.top_cpv_json,d.top_authorities_json,d.recent_contracts_json,(SELECT cv.status FROM crm_verifications cv WHERE cv.nif=d.nif LIMIT 1) AS crm_status FROM discovery_profiles d WHERE " + filters.join(" AND ") + " ORDER BY d.awarded_value_total DESC,d.latest_contract_date DESC LIMIT ?";
      const result = await env.DB.prepare(sql).bind(...values,limit).all(); return json({ok:true,companies:result.results||[],limit});
    }
    if (request.method === "POST" && url.pathname === "/api/discovery/crm-check") {
      const body = await request.json().catch(() => null);
      const nif = typeof body?.nif === "string" ? body.nif.replaceAll(" ", "").replaceAll("-", "") : "";
      if (nif.length !== 9 || ![...nif].every(ch => ch >= "0" && ch <= "9")) return json({ ok: false, error: "NIF inválido." }, 400);
      if (!["customer", "not_customer", "unknown"].includes(body?.status)) return json({ ok: false, error: "Estado CRM inválido." }, 400);
      const name = typeof body?.name === "string" ? body.name.trim().slice(0, 200) : "";
      await env.DB.prepare("INSERT INTO crm_verifications (nif,name,status,checked_at) VALUES (?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(nif) DO UPDATE SET name=excluded.name,status=excluded.status,checked_at=CURRENT_TIMESTAMP").bind(nif, name || "Empresa sem nome", body.status).run();
      return json({ ok: true, nif, status: body.status });
    }
    if (request.method === "POST" && url.pathname === "/api/leads") {
      const body=await request.json().catch(()=>null); const nif=typeof body?.nif==="string"?body.nif.replaceAll(" ","").replaceAll("-",""):"";
      if(nif.length!==9||![...nif].every(ch=>ch>="0"&&ch<="9"))return json({ok:false,error:"A valid 9-digit NIF is required."},400);
      const found=await env.DB.prepare("SELECT * FROM discovery_profiles WHERE nif=? LIMIT 1").bind(nif).all(); const p=found.results?.[0]; if(!p)return json({ok:false,error:"Discovery profile not found."},404);
      const existing=await env.DB.prepare("SELECT id FROM companies WHERE nif=? LIMIT 1").bind(nif).all(); if(existing.results?.length)return json({ok:false,error:"Already registered as a lead."},409);
      const excluded=await env.DB.prepare("SELECT nif FROM lead_exclusions WHERE nif=? AND active=1 LIMIT 1").bind(nif).all(); if(excluded.results?.length)return json({ok:false,error:"NIF blocked by administrative exclusion."},409);
      const companyId="nif:"+nif;
      try {
        await env.DB.batch([
          env.DB.prepare("INSERT INTO lead_registry (nif,name) VALUES (?,?)").bind(nif,p.name),
          env.DB.prepare("INSERT INTO companies (id,nif,name,source_url,evidence_type,contract_count,awardee_contract_count,competitor_contract_count,awarded_value_total,latest_contract_date,top_cpv_json,top_authorities_json,recent_contracts_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(companyId,nif,p.name,p.source_url||null,p.evidence_type,p.contract_count,p.awardee_contract_count,p.competitor_contract_count,p.awarded_value_total,p.latest_contract_date,p.top_cpv_json,p.top_authorities_json,p.recent_contracts_json),
          env.DB.prepare("INSERT INTO company_events (id,company_id,event_type,summary) VALUES (?,?,'qualification_changed','Lead adicionado a partir da pesquisa BASE.')").bind(id(),companyId)
        ]);
      } catch (error) {
        if (/unique|constraint/i.test(String(error?.message || error))) return json({ok:false,error:"Já existe um lead com este NIF."},409);
        throw error;
      }
      return json({ok:true,company_id:companyId,nif},201);
    }
    if (request.method === "GET" && url.pathname === "/api/admin/exclusions") { const result=await env.DB.prepare("SELECT nif,company_name,reason,notes,active,created_at,updated_at FROM lead_exclusions ORDER BY active DESC,updated_at DESC LIMIT 500").all(); return json({ok:true,exclusions:result.results||[]}); }
    if (request.method === "POST" && url.pathname === "/api/admin/exclusions") {
      const body=await request.json().catch(()=>null); const nif=typeof body?.nif==="string"?body.nif.replaceAll(" ","").replaceAll("-",""):""; if(nif.length!==9||![...nif].every(ch=>ch>="0"&&ch<="9"))return json({ok:false,error:"A valid 9-digit NIF is required."},400);
      const reason=body?.reason||"other"; if(!["current_customer","active_process","do_not_contact","duplicate","other","manual"].includes(reason))return json({ok:false,error:"Invalid exclusion reason."},400);
      await env.DB.prepare("INSERT INTO lead_exclusions(nif,company_name,reason,notes,active) VALUES(?,?,?,?,1) ON CONFLICT(nif) DO UPDATE SET company_name=excluded.company_name,reason=excluded.reason,notes=excluded.notes,active=1,updated_at=CURRENT_TIMESTAMP,reactivated_at=NULL").bind(nif,body.company_name||null,reason,body.notes||null).run(); return json({ok:true,nif},201);
    }
    const exclusionParts=url.pathname.split("/"); if(request.method==="PATCH"&&exclusionParts.length===5&&exclusionParts[1]==="api"&&exclusionParts[2]==="admin"&&exclusionParts[3]==="exclusions"){
      const body=await request.json().catch(()=>null); if(typeof body?.active!=="boolean")return json({ok:false,error:"active boolean required."},400); await env.DB.prepare("UPDATE lead_exclusions SET active=?,updated_at=CURRENT_TIMESTAMP,reactivated_at=CASE WHEN ?=0 THEN CURRENT_TIMESTAMP ELSE NULL END WHERE nif=?").bind(body.active?1:0,body.active?1:0,exclusionParts[4]).run(); return json({ok:true,nif:exclusionParts[4],active:body.active});
    }
    const leadDeleteMatch = url.pathname.match(/^\/api\/leads\/([0-9]{9})$/);
    if (request.method === "DELETE" && leadDeleteMatch) {
      const nif = leadDeleteMatch[1];
      const existing = await env.DB.prepare("SELECT id FROM companies WHERE nif = ? LIMIT 1").bind(nif).all();
      const company = existing.results?.[0];
      if (!company) return json({ ok: false, error: "Lead não encontrada no pipeline." }, 404);
      await env.DB.prepare("DELETE FROM companies WHERE id = ?").bind(company.id).run();
      return json({ ok: true, nif, registry_preserved: true });
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

    const procurementMatch = url.pathname.match(/^\/api\/companies\/([^/]+)\/procurements$/);
    if (request.method === "GET" && procurementMatch) {
      const companyId = decodeURIComponent(procurementMatch[1]);
      const result = await env.DB.prepare(
        "SELECT contract_count, awardee_contract_count, competitor_contract_count, awarded_value_total, latest_contract_date, top_cpv_json, top_authorities_json FROM companies WHERE id = ? LIMIT 1"
      ).bind(companyId).all();
      const profile = result.results?.[0];
      if (!profile) return json({ ok: false, error: "Company not found." }, 404);
      const nif = companyId.startsWith("nif:") ? companyId.slice(4) : "";
      const history = await env.DB.prepare(
        "SELECT source_id, participant_role, publication_date, description, cpv, contracting_authority, contract_value, procedure_url FROM discovery_contracts WHERE nif = ? ORDER BY publication_date DESC LIMIT 500"
      ).bind(nif).all();
      const parseArray = (value) => { try { const parsed = JSON.parse(value || "[]"); return Array.isArray(parsed) ? parsed : []; } catch { return []; } };
      return json({
        ok: true,
        summary: {
          total_contracts: Number(profile.contract_count || 0),
          awardee_contracts: Number(profile.awardee_contract_count || 0),
          competitor_contracts: Number(profile.competitor_contract_count || 0),
          total_value: Number(profile.awarded_value_total || 0),
          latest_date: profile.latest_contract_date || null
        },
        procurements: history.results || [],
        top_cpv: parseArray(profile.top_cpv_json),
        top_authorities: parseArray(profile.top_authorities_json)
      });
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

    if (request.method === "GET" && url.pathname === "/internal/import/stats") {
      if (!authorized(request, env.INGEST_SECRET)) return json({ ok: false, error: "Unauthorized" }, 401);
      const [profiles, contracts, awardees, competitors] = await Promise.all([
        env.DB.prepare("SELECT COUNT(*) AS total FROM discovery_profiles").first(),
        env.DB.prepare("SELECT COUNT(*) AS total FROM discovery_contracts").first(),
        env.DB.prepare("SELECT COUNT(*) AS total FROM discovery_contracts WHERE participant_role = 'awardee'").first(),
        env.DB.prepare("SELECT COUNT(*) AS total FROM discovery_contracts WHERE participant_role = 'competitor_confirmed'").first()
      ]);
      return json({
        ok: true,
        discovery_profiles: Number(profiles?.total || 0),
        discovery_contracts: Number(contracts?.total || 0),
        awardee_participations: Number(awardees?.total || 0),
        competitor_participations: Number(competitors?.total || 0)
      });
    }

    if (request.method === "POST" && url.pathname === "/internal/import/contracts/batch") {
      if (!authorized(request, env.INGEST_SECRET)) return json({ ok: false, error: "Unauthorized" }, 401);
      const body = await request.json().catch(() => null);
      if (!body || !Array.isArray(body.contracts) || body.contracts.length > 500) {
        return json({ ok: false, error: "Expected up to 500 discovery contract records." }, 400);
      }
      const statements = [];
      for (const item of body.contracts) {
        if (!item || typeof item.source_id !== "string" || !item.source_id.trim() ||
            typeof item.nif !== "string" || !/^\d{9}$/.test(item.nif) ||
            typeof item.company_name !== "string" || !item.company_name.trim() ||
            !["awardee", "competitor_confirmed"].includes(item.participant_role)) {
          return json({ ok: false, error: "Every contract needs source_id, valid NIF, company_name and participant_role." }, 400);
        }
        const amount = item.contract_value === null || item.contract_value === undefined ? null : Number(item.contract_value);
        if (amount !== null && (!Number.isFinite(amount) || amount < 0)) return json({ ok: false, error: "Invalid contract_value." }, 400);
        statements.push(env.DB.prepare("INSERT INTO discovery_contracts (source_id,nif,company_name,participant_role,procedure_type,cpv,description,contracting_authority,contract_value,publication_date,procedure_url,source_dataset) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source_id,nif) DO UPDATE SET company_name=excluded.company_name,participant_role=excluded.participant_role,procedure_type=excluded.procedure_type,cpv=excluded.cpv,description=excluded.description,contracting_authority=excluded.contracting_authority,contract_value=excluded.contract_value,publication_date=excluded.publication_date,procedure_url=excluded.procedure_url,source_dataset=excluded.source_dataset,imported_at=CURRENT_TIMESTAMP").bind(
          item.source_id.trim().slice(0,160), item.nif, item.company_name.trim().slice(0,200), item.participant_role,
          typeof item.procedure_type === "string" ? item.procedure_type.slice(0,100) : null,
          typeof item.cpv === "string" ? item.cpv.slice(0,30) : null,
          typeof item.description === "string" ? item.description.slice(0,500) : null,
          typeof item.contracting_authority === "string" ? item.contracting_authority.slice(0,200) : null,
          amount,
          typeof item.publication_date === "string" ? item.publication_date.slice(0,10) : null,
          typeof item.procedure_url === "string" ? item.procedure_url.slice(0,500) : null,
          typeof item.source_dataset === "string" ? item.source_dataset.slice(0,120) : "BASE contratos"
        ));
      }
      const result = statements.length ? await env.DB.batch(statements) : [];
      return json({ ok: true, contracts_received: body.contracts.length, records_saved: result.length });
    }
    if (request.method === "POST" && url.pathname === "/internal/import/batch") {
      if (!authorized(request, env.INGEST_SECRET)) return json({ ok: false, error: "Unauthorized" }, 401);
      const body = await request.json().catch(() => null);
      if (!body || !Array.isArray(body.companies) || body.companies.length > 50 || body.procurements !== undefined) {
        return json({ ok: false, error: "Expected up to 50 compact company profiles; individual procurement rows are not accepted." }, 400);
      }
      const statements = [];
      for (const item of body.companies) {
        if (!item || typeof item.id !== "string" || !/^nif:\d{9}$/.test(item.id) ||
            typeof item.nif !== "string" || !/^\d{9}$/.test(item.nif) ||
            typeof item.name !== "string" || !item.name.trim()) {
          return json({ ok: false, error: "Every profile needs a stable NIF id, valid NIF and company name." }, 400);
        }
        const count = (value) => Number.isInteger(value) && value >= 0 ? value : 0;
        const compactJson = (value, maxBytes) => {
          if (typeof value !== "string" || value.length > maxBytes) return "[]";
          try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? value : "[]"; } catch { return "[]"; }
        };
        const evidence = ["awardee", "competitor_confirmed"].includes(item.evidence_type) ? item.evidence_type : "unverified";
        statements.push(env.DB.prepare(
          `INSERT INTO discovery_profiles (
            id, nif, name, source_url, evidence_type, contract_count, awardee_contract_count,
            competitor_contract_count, awarded_value_total, latest_contract_date,
            top_cpv_json, top_authorities_json, recent_contracts_json, last_seen_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT(id) DO UPDATE SET
            name=excluded.name, source_url=COALESCE(excluded.source_url, discovery_profiles.source_url),
            evidence_type=CASE WHEN discovery_profiles.evidence_type = 'awardee' OR excluded.evidence_type = 'awardee' THEN 'awardee' WHEN discovery_profiles.evidence_type = 'competitor_confirmed' OR excluded.evidence_type = 'competitor_confirmed' THEN 'competitor_confirmed' ELSE excluded.evidence_type END,
            contract_count=excluded.contract_count, awardee_contract_count=excluded.awardee_contract_count,
            competitor_contract_count=excluded.competitor_contract_count, awarded_value_total=excluded.awarded_value_total,
            latest_contract_date=excluded.latest_contract_date, top_cpv_json=excluded.top_cpv_json,
            top_authorities_json=excluded.top_authorities_json, recent_contracts_json=excluded.recent_contracts_json,
            last_seen_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP`
        ).bind(
          item.id, item.nif, item.name.trim().slice(0, 200),
          typeof item.source_url === "string" ? item.source_url.slice(0, 500) : null,
          evidence, count(item.contract_count), count(item.awardee_contract_count),
          count(item.competitor_contract_count),
          Number.isFinite(Number(item.awarded_value_total)) && Number(item.awarded_value_total) >= 0 ? Number(item.awarded_value_total) : 0,
          typeof item.latest_contract_date === "string" ? item.latest_contract_date.slice(0, 10) : null,
          compactJson(item.top_cpv_json, 4000), compactJson(item.top_authorities_json, 8000),
          compactJson(item.recent_contracts_json, 12000)
        ));
      }
      const result = statements.length ? await env.DB.batch(statements) : [];
      return json({ ok: true, companies_received: body.companies.length, profiles_saved: result.length });
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
