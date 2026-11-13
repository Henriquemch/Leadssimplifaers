const SEARCH_URL = "https://dados.gov.pt/api/1/datasets/?q=";
const TARGETS = [
  {label:"Contratos públicos — Portal BASE / IMPIC", terms:"contratos públicos portal base impic contratos 2012 2026"},
  {label:"Anúncios de procedimentos — Portal BASE / IMPIC", terms:"contratos públicos portal base impic anúncios 2012 2026"}
];
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
export default async ()=>{
 try {
  const sources=await Promise.all(TARGETS.map(async target=>{
   const response=await fetch(SEARCH_URL+encodeURIComponent(target.terms),{headers:{"accept":"application/json"}});
   const raw=await response.text();
   if(!response.ok) throw new Error("dados.gov.pt respondeu HTTP "+response.status);
   let payload; try{payload=JSON.parse(raw)}catch{throw new Error("dados.gov.pt não devolveu JSON válido na pesquisa de datasets")};
   const items=Array.isArray(payload)?payload:(payload.data||payload.results||[]);
   const match=items.find(x=>{
    const title=(x.title||"").toLowerCase();
    return target.label.startsWith("Contratos públicos") ? title.includes("contratos") && title.includes("portal base") : title.includes("anúncios") && title.includes("portal base");
   })||items[0];
   if(!match) throw new Error("Não foi encontrado o conjunto de dados: "+target.label);
   return {name:target.label,id:match.id||match.slug||null,title:match.title||target.label,modified:match.modified||match.last_modified||null,resources:(match.resources||[]).map(r=>({title:r.title,format:r.format,url:r.url}))};
  }));
  return json({ok:true,sources,notice:"Metadados oficiais. A importação dos registos ainda não está ativa."});
 }catch(e){return json({ok:false,error:e.message},502)}
};
