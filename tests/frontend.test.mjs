import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import proxy from "../netlify/functions/leadpilot.mjs";

test("Netlify proxy fails closed when Worker URL is not configured", async () => {
  const previous = process.env.LEADPILOT_WORKER_URL;
  delete process.env.LEADPILOT_WORKER_URL;
  try {
    const response = await proxy(new Request("https://leadpilot.test/.netlify/functions/leadpilot/auth/session"));
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.ok, false);
  } finally {
    if (previous !== undefined) process.env.LEADPILOT_WORKER_URL = previous;
  }
});

test("frontend contains the four approved workflow tabs and no browser admin token", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  for (const tab of ["search", "identification", "potential", "rejected"]) {
    assert.match(html, new RegExp('data-tab="' + tab + '"'));
    assert.match(html, new RegExp('id="tab-' + tab + '"'));
  }
  assert.match(html, /copySabiNifs/);
  assert.match(html, /importSabiCsv/);
  assert.doesNotMatch(html, /app\.apollo\.io|app\.lusha\.com/);
  assert.doesNotMatch(html, /ADMIN_TOKEN|INGEST_SECRET|SESSION_SECRET/);
  const scriptStart = html.indexOf("<script>") + "<script>".length;
  const scriptEnd = html.indexOf("</script>", scriptStart);
  assert.ok(scriptStart >= 8 && scriptEnd > scriptStart);
  assert.equal(html.indexOf("<script>", scriptEnd), -1);
  assert.doesNotThrow(() => new Function(html.slice(scriptStart, scriptEnd)));
});

test("SABI CSV parser maps the manager name, not the company name", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const match = html.match(/function parseSabiCsv\\(text\\)\\{[\\s\\S]*?\\n\\}/);
  assert.ok(match, "parseSabiCsv must exist in the frontend");
  const parseSabiCsv = new Function(match[0] + "; return parseSabiCsv;")();
  const rows = parseSabiCsv("\\uFEFFNIF;Nome da Empresa;Nome do Administrador;Cargo;Email\\n501234567;Empresa Exemplo;João Silva;Administrador;joao@exemplo.pt");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].nif, "501234567");
  assert.equal(rows[0].full_name, "João Silva");
  assert.equal(rows[0].job_title, "Administrador");
  assert.equal(rows[0].email, "joao@exemplo.pt");
});
