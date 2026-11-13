#!/usr/bin/env python3
"""Inspect BASE annual contract archives safely and report real field schema."""
import collections, csv, io, json, os, re, urllib.request, zipfile
from datetime import datetime, timezone
from openpyxl import load_workbook

MANIFEST="data/source-manifest.json"
MAX_BYTES=900_000_000
MAX_ROWS=100_000
YEAR_RE=re.compile(r"contratos(202[1-6])\.(zip|json|xlsx|csv)",re.I)

def flatten(obj,prefix=""):
    if isinstance(obj,dict):
        for k,v in obj.items():
            p=f"{prefix}.{k}" if prefix else str(k)
            yield p,v
            if isinstance(v,dict): yield from flatten(v,p)
    elif isinstance(obj,list) and obj and isinstance(obj[0],dict):
        for k,v in obj[0].items():
            p=f"{prefix}[].{k}"
            yield p,v
            if isinstance(v,dict): yield from flatten(v,p)

def rows_from_bytes(data,name):
    if data[:2]==b"PK":
        z=zipfile.ZipFile(io.BytesIO(data))
        members=[n for n in z.namelist() if not n.endswith("/")]
        jsons=[n for n in members if n.lower().endswith((".json",".ndjson"))]
        excels=[n for n in members if n.lower().endswith(".xlsx")]
        csvs=[n for n in members if n.lower().endswith(".csv")]
        if "xl/workbook.xml" in members:
            wb=load_workbook(io.BytesIO(data),read_only=True,data_only=True)
            ws=wb[wb.sheetnames[0]]
            it=ws.iter_rows(values_only=True)
            headers=[str(x or "").strip() for x in next(it)]
            for vals in it:
                yield {headers[i]:vals[i] for i in range(min(len(headers),len(vals))) if headers[i]}
            wb.close()
        elif jsons:
            raw=z.read(jsons[0])
            text=raw.decode("utf-8-sig","replace")
            try: parsed=json.loads(text)
            except json.JSONDecodeError:
                for line in text.splitlines():
                    try:
                        x=json.loads(line)
                        if isinstance(x,dict): yield x
                    except Exception: continue
            else:
                if isinstance(parsed,list): yield from (x for x in parsed if isinstance(x,dict))
                elif isinstance(parsed,dict):
                    arr=next((v for v in parsed.values() if isinstance(v,list) and (not v or isinstance(v[0],dict))),None)
                    if arr is not None: yield from arr
                    else: yield parsed
        elif excels:
            wb=load_workbook(io.BytesIO(z.read(excels[0])),read_only=True,data_only=True)
            ws=wb[wb.sheetnames[0]]
            it=ws.iter_rows(values_only=True); headers=[str(x or "").strip() for x in next(it)]
            for vals in it:
                yield {headers[i]:vals[i] for i in range(min(len(headers),len(vals))) if headers[i]}
            wb.close()
        elif csvs:
            f=io.TextIOWrapper(io.BytesIO(z.read(csvs[0])),encoding="utf-8-sig",errors="replace")
            yield from csv.DictReader(f)
        else: raise RuntimeError("ZIP sem JSON, XLSX ou CSV; membros encontrados: " + ", ".join(members[:40]))
    elif data[:2]==b"\xd0\xcf":
        wb=load_workbook(io.BytesIO(data),read_only=True,data_only=True)
        ws=wb[wb.sheetnames[0]]; it=ws.iter_rows(values_only=True)
        headers=[str(x or "").strip() for x in next(it)]
        for vals in it: yield {headers[i]:vals[i] for i in range(min(len(headers),len(vals))) if headers[i]}
        wb.close()
    else:
        text=data.decode("utf-8-sig","replace")
        try:
            parsed=json.loads(text)
            if isinstance(parsed,list): yield from (x for x in parsed if isinstance(x,dict))
            elif isinstance(parsed,dict):
                arr=next((v for v in parsed.values() if isinstance(v,list) and (not v or isinstance(v[0],dict))),None)
                if arr is not None: yield from (x for x in arr if isinstance(x,dict))
                else: yield parsed
        except json.JSONDecodeError:
            parsed_lines=[]
            for line in text.splitlines():
                try:
                    item=json.loads(line)
                    if isinstance(item,dict): parsed_lines.append(item)
                except Exception:
                    parsed_lines=[]
                    break
            if parsed_lines:
                yield from parsed_lines
            else:
                yield from csv.DictReader(io.StringIO(text))

def main():
    with open(MANIFEST,encoding="utf-8") as f: manifest=json.load(f)
    source=next((x for x in manifest.get("sources",[]) if x.get("key")=="contracts"),None)
    if not source: raise SystemExit("Fonte contratos ausente do manifesto.")
    resources=source.get("resources",[])
    found={}
    for res in resources:
        candidate=(res.get("title") or res.get("url") or "")
        m=YEAR_RE.search(candidate)
        if m and res.get("url"): found[int(m.group(1))]=res
    years=sorted(y for y in found if y>=2021)
    if not years: raise SystemExit("Sem recursos anuais contratos2021–2026 reconhecidos.")
    counts=collections.Counter(); types=collections.defaultdict(collections.Counter); examples=collections.defaultdict(list)
    year_report=[]
    for year in years:
        res=found[year]
        req=urllib.request.Request(res["url"],headers={"User-Agent":"LeadPilot-data-audit/1.0"})
        with urllib.request.urlopen(req,timeout=180) as response: blob=response.read(MAX_BYTES+1)
        if len(blob)>MAX_BYTES: raise RuntimeError(f"Ficheiro {year} ultrapassa 900 MB.")
        n=0
        for row in rows_from_bytes(blob,res.get("title","")):
            n+=1
            for path,value in flatten(row):
                counts[path]+=1
                kind="null" if value is None else "boolean" if isinstance(value,bool) else "number" if isinstance(value,(int,float)) else "object" if isinstance(value,(dict,list)) else "string"
                types[path][kind]+=1
                if value not in (None,"") and len(examples[path])<2: examples[path].append(str(value)[:100])
            if n>=MAX_ROWS: break
        year_report.append({"year":year,"resource":res.get("title"),"bytes":len(blob),"rows_sampled":n,"source_modified":res.get("modified")})
    fields=[]
    for path in sorted(counts):
        low=path.lower()
        if any(k in low for k in ["nif","nipc","adjud","concorr","fornecedor","entidade","cpv","preco","valor","data","contrato","procedimento","objeto"]):
            fields.append({"field":path,"occurrences":counts[path],"types":dict(types[path]),"examples":examples[path]})
    report={"generated_at":datetime.now(timezone.utc).isoformat(),"scope":{"country":"Portugal","history_years":5,"from":"2021-01-01"},"years":year_report,"candidate_fields":fields,"all_fields":sorted(counts),"note":"Amostra estrutural; não constitui ainda uma lista de leads. O mapeamento de adjudicatários e concorrentes exige validação semântica."}
    os.makedirs("artifacts",exist_ok=True)
    with open("artifacts/contract-schema-audit.json","w",encoding="utf-8") as f: json.dump(report,f,ensure_ascii=False,indent=2)
    print(json.dumps({"years":[x["year"] for x in year_report],"sampled_rows":sum(x["rows_sampled"] for x in year_report),"candidate_fields":fields},ensure_ascii=False,indent=2))
if __name__=="__main__": main()
