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

test("eligible status is blocked for current customers", async () => {
  const response = await app.fetch(new Request("https://leadpilot.test/api/companies/c1/commercial-check", {
    method: "PATCH",
    headers: { cookie: await adminCookie(), origin: env.APP_ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ customer_status: "yes", contacted_status: "no", active_process_status: "no", commercial_status: "eligible" })
  }), envWithCompany({ id: "c1", qualification_status: "approved" }));
  assert.equal(response.status, 409);
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
