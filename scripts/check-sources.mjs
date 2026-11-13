// Checks the public IMPIC/BASE catalogue. This job records source metadata only;
// it does not claim that contract records or competitor lists have been imported.
const targets=[
 {key:"contracts",label:"Contratos BASE/IMPIC",q:"contratos públicos portal base impic contratos 2012 2026",must:["contratos de 2012 a 2026"]},
 {key:"announcements",label:"Anúncios BASE/IMPIC",q:"contratos públicos portal base impic anúncios 2012 2026",must:["anúncios de 2012 a 2026"]},
 {key:"entities",label:"Entidades BASE/IMPIC",q:"contratos públicos portal base impic entidades",must:["entidades"]},
 {key:"modifications",label:"Modificações contratuais BASE/IMPIC",q:"contratos públicos portal base impic modificações contratuais",must:["modificações contratuais"]}
];
const root="https://dados.gov.pt/api/1/datasets/";
const now=new Date();
const cutoff=new Date(now);
cutoff.setUTCFullYear(cutoff.getUTCFullYear()-5);
const out={checked_at:now.toISOString(),scope:{country:"Portugal",history_years:5,from:cutoff.toISOString().slice(0,10)},sources:[]};
for(const t of targets){
 const url=root+"?q="+encodeURIComponent(t.q)+"&page_size=50";
 const res=await fetch(url,{headers:{accept:"application/json"},signal:AbortSignal.timeout(30000)});
 if(!res.ok) throw new Error(t.label+": HTTP "+res.status+" ao consultar o catálogo");
 const payload=await res.json();
 const list=Array.isArray(payload)?payload:(payload.data||payload.results||[]);
 const item=list.find(x=>{
  const title=(x.title||"").toLocaleLowerCase("pt-PT");
  const org=(x.organization?.name||x.organization_name||"").toLocaleLowerCase("pt-PT");
  return t.must.every(term=>title.includes(term)) && (org.includes("impic") || title.includes("portal base"));
 });
 if(!item) throw new Error("O catálogo não devolveu correspondência inequívoca para "+t.label+"; não será escolhida outra fonte por aproximação.");
 out.sources.push({
  key:t.key,label:t.label,id:item.id||item.slug||null,title:item.title||t.label,
  organization:item.organization?.name||item.organization_name||null,
  modified:item.modified||item.last_modified||null,
  frequency:item.frequency||null,
  license:item.license?.title||item.license||null,
  resources:(item.resources||[]).map(r=>({id:r.id||null,title:r.title||null,format:r.format||null,url:r.url||null,modified:r.modified||r.last_modified||null,filesize:r.filesize||null}))
 });
}
process.stdout.write(JSON.stringify(out,null,2)+"\n");
