import test from "node:test";
import assert from "node:assert/strict";
import app from "../worker/index.mjs";

const env = {
  DB: {
    prepare(sql) {
      return {
        bind(...values) { return { sql, values, async all() { return { results: [] }; } }; }
      };
    },
    async batch(statements) { return statements.map(() => ({ success: true })); }
  },
  ADMIN_PASSWORD: "admin-test-password",
  SESSION_SECRET: "test-session-secret-with-at-least-32-characters",
  APP_ORIGIN: "https://app.leadpilot.test",
  INGEST_SECRET: "ingest-test-secret"
};


async function adminCookie() {
  const response = await app.fetch(new Request("https://leadpilot.test/auth/login", {
    method: "POST",
    headers: { origin: env.APP_ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ password: env.ADMIN_PASSWORD })
  }), env);
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";")[0];
}


test("login rejects an invalid origin and invalid password", async () => {
  const badOrigin = await app.fetch(new Request("https://leadpilot.test/auth/login", {
    method: "POST", headers: { origin: "https://evil.test", "content-type": "application/json" },
    body: JSON.stringify({ password: env.ADMIN_PASSWORD })
  }), env);
  assert.equal(badOrigin.status, 403);
  const badPassword = await app.fetch(new Request("https://leadpilot.test/auth/login", {
    method: "POST", headers: { origin: env.APP_ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ password: "wrong" })
  }), env);
  assert.equal(badPassword.status, 401);
});

test("session endpoint validates signed cookie", async () => {
  const cookie = await adminCookie();
  const response = await app.fetch(new Request("https://leadpilot.test/auth/session", {
    headers: { cookie }
  }), env);
  assert.deepEqual(await response.json(), { ok: true, authenticated: true });
});

test("mutating API rejects requests without the configured origin", async () => {
  const response = await app.fetch(new Request("https://leadpilot.test/api/companies/c1/qualification", {
    method: "PATCH", headers: { cookie: await adminCookie(), origin: "https://evil.test", "content-type": "application/json" },
    body: JSON.stringify({ status: "approved" })
  }), envWithCompany({ id: "c1", qualification_status: "pending" }));
  assert.equal(response.status, 403);
});

test("health is public and reports D1 binding", async () => {
  const response = await app.fetch(new Request("https://leadpilot.test/health"), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: "leadpilot-api", database_configured: true });
});

test("company list rejects missing credentials", async () => {
  const response = await app.fetch(new Request("https://leadpilot.test/api/companies"), env);
  assert.equal(response.status, 401);
});

test("company list accepts a signed session cookie", async () => {
  const response = await app.fetch(new Request("https://leadpilot.test/api/companies", {
    headers: { cookie: await adminCookie() }
  }), env);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).companies, []);
});

test("compact BASE import stores one company profile and rejects contract-row payloads", async () => {
  const denied = await app.fetch(new Request("https://leadpilot.test/internal/import/batch", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ companies: [] })
  }), env);
  assert.equal(denied.status, 401);
  let executed = 0;
  const localEnv = { ...env, DB: { ...env.DB, async batch(statements) { executed = statements.length; return statements.map(() => ({ success: true })); } } };
  const accepted = await app.fetch(new Request("https://leadpilot.test/internal/import/batch", {
    method: "POST", headers: { authorization: "Bearer ingest-test-secret", "content-type": "application/json" },
    body: JSON.stringify({ companies: [{
      id: "nif:501000000", nif: "501000000", name: "Empresa BASE", evidence_type: "awardee",
      contract_count: 3, awardee_contract_count: 2, competitor_contract_count: 1,
      awarded_value_total: 1200, latest_contract_date: "2026-10-01",
      top_cpv_json: '[{"cpv":"45000000-7","contracts":2}]',
      top_authorities_json: "[]", recent_contracts_json: "[]"
    }] })
  }), localEnv);
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).profiles_saved, 1);
  assert.equal(executed, 1);
  const invalid = await app.fetch(new Request("https://leadpilot.test/internal/import/batch", {
    method: "POST", headers: { authorization: "Bearer ingest-test-secret", "content-type": "application/json" },
    body: JSON.stringify({ companies: [{ id: "nif:123", nif: "123", name: "Inválida" }] })
  }), env);
  assert.equal(invalid.status, 400);
  const oldFormat = await app.fetch(new Request("https://leadpilot.test/internal/import/batch", {
    method: "POST", headers: { authorization: "Bearer ingest-test-secret", "content-type": "application/json" },
    body: JSON.stringify({ companies: [], procurements: [{ source_id: "raw-row" }] })
  }), env);
  assert.equal(oldFormat.status, 400);
  const oversized = await app.fetch(new Request("https://leadpilot.test/internal/import/batch", {
    method: "POST", headers: { authorization: "Bearer ingest-test-secret", "content-type": "application/json" },
    body: JSON.stringify({ companies: Array.from({length: 51},(_,i)=>({id:"nif:50100000"+i,nif:"50100000"+i,name:"Empresa"})) })
  }), env);
  assert.equal(oversized.status, 400);
});


test("BASE discovery requires a filter and only returns bounded results", async () => {
  const cookie = await adminCookie();
  const broad = await app.fetch(new Request("https://leadpilot.test/api/discovery/search", {
    headers: { cookie }
  }), env);
  assert.equal(broad.status, 400);
  const filtered = await app.fetch(new Request("https://leadpilot.test/api/discovery/search?q=empresa&limit=500", {
    headers: { cookie }
  }), env);
  assert.equal(filtered.status, 200);
  assert.equal((await filtered.json()).limit, 30);
});

test("CPV discovery searches all imported contract records, not only top-five profile CPVs", async () => {
  let capturedSql = "", capturedValues = [];
  const localEnv = {
    ...env,
    DB: {
      prepare(sql) {
        return { bind(...values) { capturedSql = sql; capturedValues = values; return { async all() { return { results: [] }; } }; } };
      }
    }
  };
  const response = await app.fetch(new Request("https://leadpilot.test/api/discovery/search?cpv=45000000-7", {
    headers: { cookie: await adminCookie() }
  }), localEnv);
  assert.equal(response.status, 200);
  assert.ok(capturedSql.includes("EXISTS (SELECT 1 FROM discovery_contracts dc"));
  assert.ok(capturedSql.includes("dc.cpv = ?"));
  assert.ok(!capturedSql.includes("json_each(d.top_cpv_json)"));
  assert.ok(capturedValues.includes("45000000-7"));
});

test("administrative exclusions reject unknown reasons", async () => {
  const response = await app.fetch(new Request("https://leadpilot.test/api/admin/exclusions", {
    method: "POST",
    headers: { cookie: await adminCookie(), origin: env.APP_ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ nif: "501000000", reason: "invented_reason" })
  }), env);
  assert.equal(response.status, 400);
});

test("adding a BASE profile creates the lead and history in one D1 batch", async () => {
  let batchSize = 0;
  const localEnv = {
    ...env,
    DB: {
      prepare(sql) {
        return {
          sql,
          bind(...values) {
            return {
              sql, values,
              async all() {
                if (sql.includes("FROM discovery_profiles")) return { results: [{
                  id: "nif:501000000", nif: "501000000", name: "Empresa BASE",
                  source_url: "https://www.base.gov.pt/Base4/pt/", evidence_type: "awardee",
                  contract_count: 2, awardee_contract_count: 2, competitor_contract_count: 0,
                  awarded_value_total: 1200, latest_contract_date: "2026-10-01",
                  top_cpv_json: "[]", top_authorities_json: "[]", recent_contracts_json: "[]"
                }] };
                return { results: [] };
              }
            };
          }
        };
      },
      async batch(statements) { batchSize = statements.length; return statements.map(() => ({ success: true })); }
    }
  };
  const response = await app.fetch(new Request("https://leadpilot.test/api/leads", {
    method: "POST",
    headers: { cookie: await adminCookie(), origin: env.APP_ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ nif: "501000000" })
  }), localEnv);
  assert.equal(response.status, 201);
  assert.equal(batchSize, 2);
});

test("batch ingestion rejects missing credentials", async () => {
  const response = await app.fetch(new Request("https://leadpilot.test/internal/companies/batch", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ companies: [{ id: "nif:501000000", name: "Empresa" }] })
  }), env);
  assert.equal(response.status, 401);
});

test("batch ingestion validates stable ID and name", async () => {
  const response = await app.fetch(new Request("https://leadpilot.test/internal/companies/batch", {
    method: "POST",
    headers: { authorization: "Bearer ingest-test-secret", "content-type": "application/json" },
    body: JSON.stringify({ companies: [{ id: "nif:501000000", name: "Empresa", evidence_type: "awardee" }] })
  }), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, received: 1, executed: 1 });
});

test("batch ingestion rejects over 100 records", async () => {
  const companies = Array.from({ length: 101 }, (_, i) => ({ id: String(i), name: "Empresa" }));
  const response = await app.fetch(new Request("https://leadpilot.test/internal/companies/batch", {
    method: "POST",
    headers: { authorization: "Bearer ingest-test-secret", "content-type": "application/json" },
    body: JSON.stringify({ companies })
  }), env);
  assert.equal(response.status, 400);
});

function envWithCompany(company) {
  return {
    ...env,
    DB: {
      prepare(sql) {
        return {
          bind(...values) {
            return {
              sql, values,
              async all() {
                if (sql.includes("SELECT id, qualification_status")) return { results: company ? [company] : [] };
                return { results: [] };
              },
              async run() { return { success: true }; }
            };
          }
        };
      },
      async batch(statements) { return statements.map(() => ({ success: true })); }
    }
  };
}

test("commercial check is blocked before qualification approval", async () => {
  const response = await app.fetch(new Request("https://leadpilot.test/api/companies/c1/commercial-check", {
    method: "PATCH",
    headers: { cookie: await adminCookie(), origin: env.APP_ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ customer_status: "no", contacted_status: "no", active_process_status: "no", commercial_status: "eligible" })
  }), envWithCompany({ id: "c1", qualification_status: "pending" }));
  assert.equal(response.status, 409);
});

test("current customers are automatically marked not_contact", async () => {
  let savedStatus = null;
  const localEnv = {
    ...env,
    DB: {
      prepare(sql) {
        return { bind(...values) { return { sql, values, async all() {
          if (sql.includes("SELECT id, qualification_status")) return { results: [{ id: "c1", qualification_status: "approved" }] };
          return { results: [] };
        } }; } };
      },
      async batch(statements) {
        savedStatus = statements[0].values[4];
        return statements.map(() => ({ success: true }));
      }
    }
  };
  const response = await app.fetch(new Request("https://leadpilot.test/api/companies/c1/commercial-check", {
    method: "PATCH",
    headers: { cookie: await adminCookie(), origin: env.APP_ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ customer_status: "yes", contacted_status: "no", active_process_status: "no", commercial_status: "eligible" })
  }), localEnv);
  assert.equal(response.status, 200);
  assert.equal(savedStatus, "not_contact");
  assert.equal((await response.json()).commercial_status, "not_contact");
});

test("decision-maker research is blocked unless company is eligible", async () => {
  const response = await app.fetch(new Request("https://leadpilot.test/api/decision-makers", {
    method: "POST",
    headers: { cookie: await adminCookie(), origin: env.APP_ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ company_id: "c1", full_name: "Pessoa Teste" })
  }), envWithCompany({ id: "c1", qualification_status: "approved", commercial_status: "pending_review", customer_status: "no", active_process_status: "no" }));
  assert.equal(response.status, 409);
});

test("decision-maker research allowed only for explicitly eligible company", async () => {
  const response = await app.fetch(new Request("https://leadpilot.test/api/decision-makers", {
    method: "POST",
    headers: { cookie: await adminCookie(), origin: env.APP_ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ company_id: "c1", full_name: "Pessoa Teste", job_title: "Diretor" })
  }), envWithCompany({ id: "c1", qualification_status: "approved", commercial_status: "eligible", customer_status: "no", active_process_status: "no" }));
  assert.equal(response.status, 201);
});

test("company evidence endpoint reads full discovery contract history", async () => {
  const queriedSql = [];
  let queryCount = 0;
  const localEnv = {
    ...env,
    DB: {
      prepare(sql) {
        queriedSql.push(sql);
        const current = queryCount++;
        return {
          bind(...values) {
            return {
              async all() {
                if (current === 0) return { results: [{
                  contract_count: 3, awardee_contract_count: 2, competitor_contract_count: 1,
                  awarded_value_total: 12000, latest_contract_date: "2026-10-01",
                  top_cpv_json: '[{"cpv":"45000000-7","contracts":2}]',
                  top_authorities_json: '[{"contracting_authority":"Instituto Público","contracts":2}]'
                }] };
                return { results: [{
                  source_id: "base-1", participant_role: "awardee", publication_date: "2026-10-01",
                  description: "Serviços", cpv: "45000000-7", contracting_authority: "Instituto Público",
                  contract_value: 4000, procedure_url: "https://www.base.gov.pt/"
                }] };
              }
            };
          }
        };
      }
    }
  };
  const response = await app.fetch(new Request("https://leadpilot.test/api/companies/c1/procurements?limit=500", {
    headers: { cookie: await adminCookie() }
  }), localEnv);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.summary.total_contracts, 3);
  assert.equal(data.summary.awardee_contracts, 2);
  assert.equal(data.summary.total_value, 12000);
  assert.equal(data.procurements.length, 1);
  assert.equal(data.procurements[0].cpv, "45000000-7");
  assert.equal(data.top_cpv[0].cpv, "45000000-7");
  assert.equal(data.top_authorities[0].contracting_authority, "Instituto Público");
  assert.ok(queriedSql[1].includes("FROM discovery_contracts"));
});

test("company search accepts bounded filters", async () => {
  const response = await app.fetch(new Request("https://leadpilot.test/api/companies?q=construcao&qualification_status=approved&commercial_status=eligible", {
    headers: { cookie: await adminCookie() }
  }), env);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).companies, []);
});

test("company search rejects invalid workflow filters", async () => {
  const response = await app.fetch(new Request("https://leadpilot.test/api/companies?commercial_status=send_to_crm", {
    headers: { cookie: await adminCookie() }
  }), env);
  assert.equal(response.status, 400);
});
