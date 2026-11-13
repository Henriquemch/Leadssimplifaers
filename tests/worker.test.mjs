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
  ADMIN_TOKEN: "admin-test-secret",
  INGEST_SECRET: "ingest-test-secret"
};

test("health is public and reports D1 binding", async () => {
  const response = await app.fetch(new Request("https://leadpilot.test/health"), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: "leadpilot-api", database_configured: true });
});

test("company list rejects missing credentials", async () => {
  const response = await app.fetch(new Request("https://leadpilot.test/api/companies"), env);
  assert.equal(response.status, 401);
});

test("company list accepts admin credential", async () => {
  const response = await app.fetch(new Request("https://leadpilot.test/api/companies", {
    headers: { authorization: "Bearer admin-test-secret" }
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
