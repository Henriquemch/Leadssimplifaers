const targets=[
 {key:"contracts",label:"Contratos BASE/IMPIC",q:"contratos públicos portal base impic contratos 2012 2026"},
 {key:"announcements",label:"Anúncios BASE/IMPIC",q:"contratos públicos portal base impic anúncios 2012 2026"},
 {key:"entities",label:"Entidades BASE/IMPIC",q:"contratos públicos portal base impic entidades"}
];
const root="https://dados.gov.pt/api/1/datasets/?q=";
const out={checked_at:new Date().toISOString(),scope:{country:"Portugal",history_years:5},sources:[]};
for(const t of targets){
 const res=await fetch(root+encodeURIComponent(t.q),{headers:{accept:"application/json"}});
 if(!res.ok) throw new Error(t.label+": HTTP "+res.status);
 const data=await res.json();
 const list=Array.isArray(data)?data:(data.data||data.results||[]);
 const terms=t.key==="contracts"?["contratos","portal base"]:t.key==="announcements"?["anúncios","portal base"]:["entidades","portal base"];
 const item=list.find(x=>terms.every(k=>(x.title||"").toLowerCase().includes(k)))||list[0];
 if(!item) throw new Error("Dataset não encontrado: "+t.label);
 out.sources.push({key:t.key,label:t.label,id:item.id||item.slug||null,title:item.title||t.label,modified:item.modified||item.last_modified||null,frequency:item.frequency||null,resources:(item.resources||[]).map(r=>({title:r.title,format:r.format,url:r.url,modified:r.modified||null}))});
}
process.stdout.write(JSON.stringify(out,null,2)+"\n");
