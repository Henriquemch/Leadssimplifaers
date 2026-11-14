const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

export const config = { path: ["/api/leadpilot", "/api/leadpilot/*"] };

export default async (request) => {
  const workerBase = process.env.LEADPILOT_WORKER_URL;
  if (!workerBase) {
    return json({
      ok: false,
      error: "A API LeadPilot ainda não está ligada. O endereço do Worker será configurado quando a infraestrutura Cloudflare estiver pronta."
    }, 503);
  }

  let base;
  try {
    base = new URL(workerBase);
    if (base.protocol !== "https:" || base.username || base.password) throw new Error("Invalid Worker URL");
  } catch {
    return json({ ok: false, error: "Configuração LEADPILOT_WORKER_URL inválida." }, 500);
  }

  const incoming = new URL(request.url);
  const functionPrefix = "/.netlify/functions/leadpilot";
  const apiPrefix = "/api/leadpilot";
  let suffix = "";
  if (incoming.pathname.startsWith(functionPrefix)) {
    suffix = incoming.pathname.slice(functionPrefix.length);
  } else if (incoming.pathname === apiPrefix) {
    suffix = "";
  } else if (incoming.pathname.startsWith(apiPrefix + "/")) {
    suffix = incoming.pathname.slice(apiPrefix.length);
  }
  // LEADPILOT_WORKER_URL is an origin, not an API path. Use the
  // incoming suffix so both Netlify's rewritten and original paths work.
  const target = new URL(suffix || "/", base.origin);
  target.search = incoming.search;

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");
  headers.set("x-forwarded-host", incoming.host);

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      redirect: "manual"
    });
    const responseHeaders = new Headers(upstream.headers);

    // fetch() may transparently decompress the upstream body. Forwarding
    // the original encoding/length headers would make the browser try to
    // decompress an already-decoded body (ERR_CONTENT_DECODING_FAILED).
    responseHeaders.delete("content-encoding");
    responseHeaders.delete("content-length");
    responseHeaders.delete("transfer-encoding");
    responseHeaders.set("cache-control", "no-store");

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders
    });
  } catch {
    return json({ ok: false, error: "Não foi possível contactar a API LeadPilot." }, 502);
  }
};
