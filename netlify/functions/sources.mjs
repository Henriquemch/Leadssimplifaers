const DATASETS = [
  {name:"Contratos públicos — Portal BASE / IMPIC", id:"contratos-publicos-portal-base-impic-contratos-de-2012-a-2026"},
  {name:"Anúncios de procedimentos — Portal BASE / IMPIC", id:"contratos-publicos-portal-base-impic-anuncios-de-2012-a-2026"}
];
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
export default async ()=>{
 try {
  const sources=await Promise.all(DATASETS.map(async d=>{
   const res=await fetch("https://dados.gov.pt/api/1/datasets/"+d.id+"/");
   if(!res.ok) throw new Error("dados.gov.pt respondeu "+res.status+" para "+d.name);
   const x=await res.json();
   return {name:d.name,id:d.id,title:x.title||d.name,modified:x.modified||x.last_modified||null,frequency:x.frequency||null,resources:(x.resources||[]).map(r=>({title:r.title,format:r.format,url:r.url}))};
  }));
  return json({ok:true,sources,notice:"Metadados reais das fontes oficiais. Ainda não são registos de empresas importados."});
 } catch(e){return json({ok:false,error:e.message},502)}
};
