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

test("frontend contains the five workflow tabs and no browser admin token", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  for (const tab of ["search", "qualification", "commercial", "people", "crm"]) {
    assert.match(html, new RegExp('data-tab="' + tab + '"'));
    assert.match(html, new RegExp('id="tab-' + tab + '"'));
  }
  assert.doesNotMatch(html, /ADMIN_TOKEN|INGEST_SECRET|SESSION_SECRET/);
  const scripts = [...html.matchAll(/<script>([\\s\\S]*?)<\\/script>/g)];
  assert.equal(scripts.length, 1);
  assert.doesNotThrow(() => new Function(scripts[0][1]));
});
