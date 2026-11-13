const DATASET = "https://dados.gov.pt/api/1/datasets/contratos-publicos-portal-base-impic-contratos-de-2012-a-2026/";
const ANNOUNCEMENTS = "https://dados.gov.pt/api/1/datasets/contratos-publicos-portal-base-impic-anuncios-de-2012-a-2026/";
const json = (data, status=200) => new Response(JSON.stringify(data), {status, headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
export default async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET") {
    try {
      const [contracts, notices] = await Promise.all([fetch(DATASET), fetch(ANNOUNCEMENTS)]);
      if (!contracts.ok || !notices.ok) throw new Error("Não foi possível consultar os metadados do dados.gov.pt.");
      const [c,n] = await Promise.all([contracts.json(), notices.json()]);
      return json({ok:true, mode:"metadata", sources:[
        {name:"Portal BASE — contratos", dataset:c.title || "Contratos públicos", modified:c.modified || c.last_modified || null, resources:(c.resources||[]).map(r=>({title:r.title,format:r.format,url:r.url}))},
        {name:"Portal BASE — anúncios", dataset:n.title || "Anúncios de procedimentos", modified:n.modified || n.last_modified || null, resources:(n.resources||[]).map(r=>({title:r.title,format:r.format,url:r.url}))}
      ], message:"Fontes oficiais localizadas. A importação integral e persistência exigem configurar uma base de dados."});
    } catch(e) { return json({ok:false,error:e.message},502); }
  }
  if (req.method === "POST") {
    const body = await req.json().catch(()=>({}));
    if (body.action === "approve-lusha") return json({ok:false,error:"Consulta Lusha bloqueada: integração e aprovação persistente ainda não configuradas."},409);
    return json({ok:false,error:"A sincronização de dados reais ainda não está ativa. Primeiro é necessário configurar Supabase (persistência) e validar os recursos oficiais do dataset. Nenhum dado fictício será mostrado."},501);
  }
  return json({error:"Method not allowed"},405);
};
