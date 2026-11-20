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
      if (!env.DB) return json({ ok: false, service: "leadpilot-api", database_configured: false }, 503);
      try {
        const columns = await env.DB.prepare("PRAGMA table_info(companies)").bind().all();
        const names = new Set((columns.results || []).map(column => column.name));
        const required = ["linkedin_company_url", "linkedin_status", "contact_research_status", "lead_source", "potential_client_at"];
        return json({ ok: true, service: "leadpilot-api", database_configured: true, schema_check: Object.fromEntries(required.map(name => [name, names.has(name)])) });
      } catch {
        return json({ ok: false, service: "leadpilot-api", database_configured: true, schema_check: "failed" }, 500);
      }
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
    if (request.method === "POST" && url.pathname === "/api/discovery/disqualify") {
      const body = await request.json().catch(() => null);
      const nif = typeof body?.nif === "string" ? body.nif.replaceAll(" ", "").replaceAll("-", "") : "";
      if (nif.length !== 9 || ![...nif].every(ch => ch >= "0" && ch <= "9")) return json({ ok: false, error: "NIF inválido." }, 400);
      const found = await env.DB.prepare("SELECT name FROM discovery_profiles WHERE nif = ? LIMIT 1").bind(nif).all();
      const profile = found.results?.[0];
      if (!profile) return json({ ok: false, error: "Empresa não encontrada na pesquisa." }, 404);
      await env.DB.prepare("INSERT OR IGNORE INTO lead_registry (nif, name) VALUES (?, ?)").bind(nif, profile.name || "Empresa sem nome").run();
      return json({ ok: true, nif, disqualified: true });
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
        const message = String(error?.message || error);
        if (/unique|constraint/i.test(message)) return json({ok:false,error:"Já existe um lead com este NIF."},409);
        console.error("Lead creation failed", error);
        return json({ok:false,error:"Não foi possível adicionar o lead.",diagnostic:message.slice(0,500)},500);
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

    if (request.method === "POST" && url.pathname === "/api/sabi/import") {
      const body = await request.json().catch(() => null);
      if (!body || !Array.isArray(body.records) || body.records.length > 200) return json({ ok: false, error: "Importa até 200 registos SABI de cada vez." }, 400);
      const inserts = [];
      const companyUpdates = new Set();
      let skipped = 0;
      for (const item of body.records) {
        const nif = typeof item?.nif === "string" ? item.nif.replace(/[^0-9]/g, "") : "";
        const fullName = typeof item?.full_name === "string" ? item.full_name.trim() : "";
        if (!/^\d{9}$/.test(nif) || !fullName) { skipped++; continue; }
        const found = await env.DB.prepare("SELECT id FROM companies WHERE nif = ? LIMIT 1").bind(nif).first();
        if (!found) { skipped++; continue; }
        const title = typeof item.job_title === "string" ? item.job_title.trim().slice(0, 120) : "";
        const duplicate = await env.DB.prepare("SELECT id FROM decision_makers WHERE company_id = ? AND full_name = ? AND COALESCE(job_title,'') = ? AND provider = 'SABI' LIMIT 1")
          .bind(found.id, fullName.slice(0, 160), title).first();
        if (duplicate) { skipped++; continue; }
        inserts.push(env.DB.prepare("INSERT INTO decision_makers (id, company_id, full_name, job_title, email, phone, contact_type, review_status, notes, professional_profile_url, source_url, provider) VALUES (?, ?, ?, ?, ?, ?, 'decision_maker', 'pending', ?, ?, ?, 'SABI')")
          .bind(id(), found.id, fullName.slice(0, 160), title || null,
            typeof item.email === "string" ? item.email.trim().slice(0, 200) : null,
            typeof item.phone === "string" ? item.phone.trim().slice(0, 60) : null,
            typeof item.notes === "string" ? item.notes.trim().slice(0, 1000) : "Importado do SABI; aguarda validação manual.",
            typeof item.profile_url === "string" ? item.profile_url.trim().slice(0, 500) : null,
            typeof item.source_url === "string" ? item.source_url.trim().slice(0, 500) : null));
        companyUpdates.add(found.id);
      }
      if (inserts.length) {
        const updates = [...companyUpdates].map(companyId => env.DB.prepare("UPDATE companies SET contact_research_status = 'sabi_imported', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(companyId));
        await env.DB.batch(inserts);
        if (updates.length) await env.DB.batch(updates);
      }
      return json({ ok: true, imported: inserts.length, skipped, companies_updated: companyUpdates.size });
    }

    if (request.method === "GET" && url.pathname === "/api/potential-clients") {
      const result = await env.DB.prepare(
        "SELECT c.id, c.nif, c.name, c.sector, c.municipality, c.district, c.commercial_notes, c.linkedin_company_url, c.lead_source, c.potential_client_at, dm.id AS decision_maker_id, dm.full_name, dm.job_title, dm.email, dm.phone, dm.professional_profile_url, dm.provider FROM companies c LEFT JOIN decision_makers dm ON dm.company_id = c.id AND dm.review_status = 'selected' WHERE c.potential_client_at IS NOT NULL ORDER BY c.potential_client_at DESC, c.name ASC LIMIT 300"
      ).all();
      return json({ ok: true, records: result.results || [] });
    }

    if (request.method === "GET" && url.pathname === "/api/companies") {
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 100), 1), 500);
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
        `SELECT id, nif, name, municipality, district, sector, evidence_type, qualification_status, qualification_notes, customer_status, contacted_status, active_process_status, commercial_notes, commercial_status, source_url, last_seen_at, linkedin_company_url, linkedin_status, contact_research_status, lead_source, potential_client_at FROM companies ${where} ORDER BY last_seen_at DESC LIMIT ?`
      ).bind(...values, limit).all();
      return json({ ok: true, companies: result.results || [] });
    }

    const procurementMatch = url.pathname.match(/^\/api\/companies\/([^/]+)\/procurements$/);
    if (request.method === "GET" && procurementMatch) {
      const companyId = decodeURIComponent(procurementMatch[1]);
      const exists = await env.DB.prepare("SELECT id FROM companies WHERE id = ? LIMIT 1").bind(companyId).all();
      if (!exists.results?.length) return json({ ok: false, error: "Company not found." }, 404);
      const nif = companyId.startsWith("nif:") ? companyId.slice(4) : "";
      const months = Number(url.searchParams.get("months") || 12);
      if (![12, 24].includes(months)) return json({ ok: false, error: "months must be 12 or 24." }, 400);
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 50), 1), 100);
      const offset = Math.min(Math.max(Number(url.searchParams.get("offset") || 0), 0), 10000);
      const since = new Date(); since.setMonth(since.getMonth() - months);
      const fromDate = since.toISOString().slice(0, 10);
      const where = "nif = ? AND publication_date >= ?";
      const summaryResult = await env.DB.prepare(
        `SELECT COUNT(*) AS total_contracts,
          SUM(CASE WHEN participant_role = 'awardee' THEN 1 ELSE 0 END) AS awardee_contracts,
          SUM(CASE WHEN participant_role = 'competitor_confirmed' THEN 1 ELSE 0 END) AS competitor_contracts,
          SUM(CASE WHEN participant_role = 'awardee' THEN COALESCE(contract_value,0) ELSE 0 END) AS total_value,
          MAX(publication_date) AS latest_date
         FROM discovery_contracts WHERE ${where}`
      ).bind(nif, fromDate).all();
      const summary = summaryResult.results?.[0] || {};
      const history = await env.DB.prepare(
        `SELECT source_id, participant_role, publication_date, description, cpv, contracting_authority, contract_value, procedure_url
         FROM discovery_contracts WHERE ${where} ORDER BY publication_date DESC, source_id DESC LIMIT ? OFFSET ?`
      ).bind(nif, fromDate, limit, offset).all();
      const cpvs = await env.DB.prepare(
        `SELECT cpv, COUNT(*) AS contracts FROM discovery_contracts WHERE ${where} AND cpv IS NOT NULL AND cpv != '' GROUP BY cpv ORDER BY contracts DESC LIMIT 8`
      ).bind(nif, fromDate).all();
      const authorities = await env.DB.prepare(
        `SELECT contracting_authority, COUNT(*) AS contracts FROM discovery_contracts WHERE ${where} AND contracting_authority IS NOT NULL AND contracting_authority != '' GROUP BY contracting_authority ORDER BY contracts DESC LIMIT 8`
      ).bind(nif, fromDate).all();
      const total = Number(summary?.total_contracts || 0);
      return json({ ok: true, months, from_date: fromDate, limit, offset, total, has_more: offset + (history.results || []).length < total,
        summary: { total_contracts: total, awardee_contracts: Number(summary?.awardee_contracts || 0), competitor_contracts: Number(summary?.competitor_contracts || 0), total_value: Number(summary?.total_value || 0), latest_date: summary?.latest_date || null },
        procurements: history.results || [], top_cpv: cpvs.results || [], top_authorities: authorities.results || [] });
    }

    const approveCompanyMatch = url.pathname.match(/^\/api\/companies\/([^/]+)\/approve$/);
    if (request.method === "POST" && approveCompanyMatch) {
      const companyId = decodeURIComponent(approveCompanyMatch[1]);
      const company = await env.DB.prepare("SELECT id, name, qualification_status FROM companies WHERE id = ? LIMIT 1").bind(companyId).first();
      if (!company) return json({ ok: false, error: "Empresa não encontrada." }, 404);
      if (company.qualification_status === "rejected") return json({ ok: false, error: "A empresa está rejeitada. Requalifica-a antes de aprovar." }, 409);
      const people = await env.DB.prepare("SELECT COUNT(*) AS total FROM decision_makers WHERE company_id = ?").bind(companyId).first();
      const totalContacts = Number(people?.total || 0);
      await env.DB.batch([
        env.DB.prepare("UPDATE companies SET qualification_status = 'approved', qualified_at = COALESCE(qualified_at, CURRENT_TIMESTAMP), potential_client_at = COALESCE(potential_client_at, CURRENT_TIMESTAMP), contact_research_status = CASE WHEN ? > 0 THEN 'decision_maker_found' ELSE contact_research_status END, lead_source = COALESCE(lead_source, 'manual'), updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(totalContacts, companyId),
        env.DB.prepare("UPDATE decision_makers SET review_status = 'selected' WHERE company_id = ?").bind(companyId),
        env.DB.prepare("INSERT INTO company_events (id, company_id, event_type, summary) VALUES (?, ?, 'qualification_changed', ?)").bind(id(), companyId, "Empresa aprovada manualmente; " + totalContacts + " contacto(s) associado(s) promovido(s) para Potenciais clientes.")
      ]);
      return json({ ok: true, company_id: companyId, qualification_status: "approved", promoted: true, contacts_promoted: totalContacts });
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
        env.DB.prepare("UPDATE companies SET qualification_status = ?, qualification_notes = ?, qualified_at = CASE WHEN ? = 'approved' THEN CURRENT_TIMESTAMP ELSE NULL END, commercial_status = CASE WHEN ? = 'approved' THEN commercial_status ELSE 'pending_review' END, potential_client_at = CASE WHEN ? = 'rejected' THEN NULL ELSE potential_client_at END, lead_source = CASE WHEN ? = 'rejected' THEN NULL ELSE lead_source END, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(body.status, notes, body.status, body.status, body.status, body.status, companyId),
        env.DB.prepare("INSERT INTO company_events (id, company_id, event_type, summary) VALUES (?, ?, 'qualification_changed', ?)").bind(id(), companyId, `Qualificação: ${company.qualification_status} → ${body.status}`),
        env.DB.prepare("UPDATE decision_makers SET review_status = 'pending' WHERE company_id = ? AND ? = 'rejected' AND review_status = 'selected'").bind(companyId, body.status)
      ]);
      return json({ ok: true, company_id: companyId, qualification_status: body.status });
    }

    const linkedinMatch = url.pathname.match(/^\/api\/companies\/([^/]+)\/linkedin$/);
    if (request.method === "PATCH" && linkedinMatch) {
      const companyId = decodeURIComponent(linkedinMatch[1]);
      const body = await request.json().catch(() => null);
      const status = body?.status;
      if (!["found", "not_found"].includes(status)) return json({ ok: false, error: "Estado LinkedIn inválido." }, 400);
      let profileUrl = null;
      if (status === "found") {
        if (typeof body.url !== "string" || !body.url.trim()) return json({ ok: false, error: "Indica o URL da página da empresa no LinkedIn." }, 400);
        try {
          const parsed = new URL(body.url.trim());
          if (!/(^|\.)linkedin\.com$/i.test(parsed.hostname) || !/^\/company\//.test(parsed.pathname)) throw new Error("invalid");
          profileUrl = parsed.toString().slice(0, 500);
        } catch { return json({ ok: false, error: "O URL deve ser uma página /company/ do LinkedIn." }, 400); }
      }
      const company = await companyById(env.DB, companyId);
      if (!company) return json({ ok: false, error: "Empresa não encontrada." }, 404);
      await env.DB.prepare("UPDATE companies SET linkedin_company_url = ?, linkedin_status = ?, contact_research_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(profileUrl, status, status === "found" ? "linkedin_pending" : "sabi_pending", companyId).run();
      return json({ ok: true, company_id: companyId, linkedin_status: status, contact_research_status: status === "found" ? "linkedin_pending" : "sabi_pending" });
    }

    const sabiQueueMatch = url.pathname.match(/^\/api\/companies\/([^/]+)\/sabi-queue$/);
    if (request.method === "POST" && sabiQueueMatch) {
      const companyId = decodeURIComponent(sabiQueueMatch[1]);
      try {
        const exists = await env.DB.prepare("SELECT id FROM companies WHERE id = ? LIMIT 1").bind(companyId).all();
        if (!exists.results?.length) return json({ ok: false, error: "Empresa não encontrada." }, 404);
        await env.DB.prepare("UPDATE companies SET linkedin_status = CASE WHEN linkedin_status = 'found' THEN linkedin_status ELSE 'not_found' END, contact_research_status = 'sabi_pending', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
          .bind(companyId).run();
        return json({ ok: true, company_id: companyId, contact_research_status: "sabi_pending" });
      } catch (error) {
        console.error("SABI queue update failed", error);
        return json({ ok: false, error: "Falha ao atualizar a empresa para SABI.", diagnostic: String(error?.message || error).slice(0, 300) }, 500);
      }
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
        "SELECT id, full_name, job_title, email, phone, contact_type, review_status, notes, professional_profile_url, source_url, provider, created_at FROM decision_makers WHERE company_id = ? ORDER BY created_at DESC LIMIT 100"
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
      const contactType = ["general", "decision_maker"].includes(body.contact_type) ? body.contact_type : "decision_maker";
      const reviewStatus = ["pending", "selected", "rejected"].includes(body.review_status) ? body.review_status : "pending";
      const personId = id();
      try {
        await env.DB.prepare("INSERT INTO decision_makers (id, company_id, full_name, job_title, email, phone, contact_type, review_status, notes, professional_profile_url, source_url, provider) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(personId, body.company_id, body.full_name.trim().slice(0, 160),
            typeof body.job_title === "string" ? body.job_title.trim().slice(0, 120) : null,
            typeof body.email === "string" ? body.email.trim().slice(0, 200) : null,
            typeof body.phone === "string" ? body.phone.trim().slice(0, 60) : null,
            contactType, reviewStatus,
            typeof body.notes === "string" ? body.notes.trim().slice(0, 1000) : null,
            typeof body.profile_url === "string" ? body.profile_url.trim().slice(0, 500) : null,
            typeof body.source_url === "string" ? body.source_url.trim().slice(0, 500) : null,
            typeof body.source === "string" ? body.source.trim().slice(0, 40) : "manual").run();
        return json({ ok: true, decision_maker_id: personId }, 201);
      } catch (error) {
        console.error("Decision-maker insert failed", error);
        return json({ok:false,error:"Não foi possível guardar o decisor.",diagnostic:String(error?.message || error).slice(0,500)},500);
      }
    }

    const personStatusMatch = url.pathname.match(/^\/api\/decision-makers\/([a-f0-9-]+)\/review$/);
    if (request.method === "PATCH" && personStatusMatch) {
      const body = await request.json().catch(() => null);
      if (!["pending", "selected", "rejected"].includes(body?.review_status)) {
        return json({ ok: false, error: "Estado de seleção inválido." }, 400);
      }
      const person = await env.DB.prepare("SELECT company_id, provider FROM decision_makers WHERE id = ? LIMIT 1").bind(personStatusMatch[1]).first();
      if (!person) return json({ ok: false, error: "Decisor não encontrado." }, 404);
      if (body.review_status === "selected") {
        const company = await env.DB.prepare("SELECT qualification_status, potential_client_at FROM companies WHERE id = ? LIMIT 1").bind(person.company_id).first();
        if (!company || company.qualification_status !== "approved") return json({ ok: false, error: "A empresa tem de estar aprovada antes de promover um decisor." }, 409);
        const source = String(person.provider || "").toLowerCase().includes("sabi") ? "sabi" : "linkedin";
        await env.DB.batch([
          env.DB.prepare("UPDATE decision_makers SET review_status = ?, notes = COALESCE(?, notes) WHERE id = ?")
            .bind(body.review_status, typeof body.notes === "string" ? body.notes.trim().slice(0, 1000) : null, personStatusMatch[1]),
          env.DB.prepare("UPDATE companies SET contact_research_status = 'decision_maker_found', lead_source = COALESCE(lead_source, ?), potential_client_at = COALESCE(potential_client_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ?")
            .bind(source, person.company_id),
          ...(company.potential_client_at ? [] : [
            env.DB.prepare("INSERT INTO company_events (id, company_id, event_type, summary) VALUES (?, ?, 'commercial_status_changed', ?)")
              .bind(id(), person.company_id, "Empresa promovida a Potenciais clientes após validação de decisor.")
          ])
        ]);
      } else {
        await env.DB.prepare("UPDATE decision_makers SET review_status = ?, notes = COALESCE(?, notes) WHERE id = ?")
          .bind(body.review_status, typeof body.notes === "string" ? body.notes.trim().slice(0, 1000) : null, personStatusMatch[1]).run();
      }
      return json({ ok: true, decision_maker_id: personStatusMatch[1], review_status: body.review_status, promoted: body.review_status === "selected" });
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
