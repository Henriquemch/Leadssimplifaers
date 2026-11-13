const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

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
  const suffix = incoming.pathname.startsWith(functionPrefix)
    ? incoming.pathname.slice(functionPrefix.length)
    : "";
  const target = new URL(base.origin + (base.pathname.replace(/\/$/, "") + suffix || "/"));
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
