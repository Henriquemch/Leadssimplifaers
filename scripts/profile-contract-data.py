#!/usr/bin/env python3
"""Profile official BASE contract dumps without guessing field mappings.
Supports ZIP files containing JSON Lines or JSON arrays. Emits only schema
statistics and candidate field names; it does not publish company records.
"""
import json, os, re, sys, zipfile, io, urllib.request, collections
from datetime import datetime, timezone

MANIFEST = "data/source-manifest.json"
YEARS = {str(y) for y in range(2021, 2027)}
MAX_SAMPLE_ROWS = 50000
MAX_DOWNLOAD_BYTES = 800_000_000

def read_json_lines(stream, stats):
    for raw in stream:
        line = raw.decode("utf-8-sig", "replace").strip() if isinstance(raw, bytes) else raw.strip()
        if not line:
            continue
        try:
            item = json.loads(line)
        except Exception:
            stats["invalid_json_lines"] += 1
            continue
        if isinstance(item, list):
            yield from (x for x in item if isinstance(x, dict))
        elif isinstance(item, dict):
            # Handle a top-level object containing a record collection.
            found = False
            for key, value in item.items():
                if isinstance(value, list) and value and isinstance(value[0], dict):
                    for row in value:
                        yield row
                    found = True
            if not found:
                yield item

def walk(obj, prefix=""):
    if isinstance(obj, dict):
        for key, value in obj.items():
            path = f"{prefix}.{key}" if prefix else str(key)
            yield path, value
            yield from walk(value, path)
    elif isinstance(obj, list):
        for value in obj[:3]:
            yield from walk(value, prefix + "[]")

def main():
    with open(MANIFEST, encoding="utf-8") as f:
        manifest = json.load(f)
    contract_source = next((s for s in manifest.get("sources", []) if s.get("key") == "contracts"), None)
    if not contract_source:
        raise SystemExit("Manifesto sem conjunto de contratos; executar primeiro a verificação de fontes.")
    resources = contract_source.get("resources", [])
    selected = []
    for resource in resources:
        name = (resource.get("title") or resource.get("url") or "").lower()
        match = re.search(r"contratos(202[1-6])\.(zip|json|xlsx)", name)
        if match and match.group(1) in YEARS and resource.get("url"):
            selected.append((int(match.group(1)), resource))
    selected.sort(key=lambda x: x[0])
    if not selected:
        raise SystemExit("Não foram encontrados recursos anuais contratos2021–2026 no manifesto.")

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "scope": {"country": "Portugal", "from": "2021-01-01", "to": datetime.now(timezone.utc).date().isoformat()},
        "source_title": contract_source.get("title"),
        "years": [],
        "field_paths": {},
        "candidate_fields": [],
        "warning": "Perfil estrutural apenas. Nenhuma empresa é publicada até validar os campos e a semântica com a documentação oficial."
    }
    field_types = collections.defaultdict(collections.Counter)
    field_examples = collections.defaultdict(list)
    for year, resource in selected:
        url = resource["url"]
        req = urllib.request.Request(url, headers={"User-Agent": "LeadPilot-open-data-profiler/1.0"})
        with urllib.request.urlopen(req, timeout=120) as response:
            data = response.read(MAX_DOWNLOAD_BYTES + 1)
        if len(data) > MAX_DOWNLOAD_BYTES:
            raise RuntimeError(f"Ficheiro {year} excede o limite de segurança de 800 MB.")
        stats = {"year": year, "resource": resource.get("title"), "bytes": len(data), "records_sampled": 0, "invalid_json_lines": 0, "zip_members": []}
        stream = None
        if data[:2] == b"PK":
            zf = zipfile.ZipFile(io.BytesIO(data))
            members = [m for m in zf.namelist() if not m.endswith("/")]
            stats["zip_members"] = members[:20]
            json_members = [m for m in members if m.lower().endswith((".json", ".ndjson", ".txt"))]
            if not json_members:
                raise RuntimeError(f"ZIP {year} sem ficheiro JSON/NDJSON reconhecível.")
            stream = zf.open(json_members[0])
        else:
            stream = io.BytesIO(data)
        count = 0
        try:
            for row in read_json_lines(stream, stats):
                count += 1
                for path, value in walk(row):
                    if value is None or isinstance(value, (dict, list)):
                        typ = "object" if isinstance(value, (dict, list)) else "null"
                    elif isinstance(value, bool):
                        typ = "boolean"
                    elif isinstance(value, (int, float)):
                        typ = "number"
                    else:
                        typ = "string"
                    field_types[path][typ] += 1
                    if len(field_examples[path]) < 3 and value not in (None, "", [], {}):
                        sample = str(value)
                        field_examples[path].append(sample[:100])
                if count >= MAX_SAMPLE_ROWS:
                    break
        finally:
            stream.close()
        stats["records_sampled"] = count
        report["years"].append(stats)

    for path, counts in sorted(field_types.items()):
        report["field_paths"][path] = {"types": dict(counts), "examples": field_examples[path]}
        low = path.lower()
        if any(term in low for term in ("adjudicat", "concorr", "proponente", "fornecedor", "entidade", "nif", "nipc", "cpv", "valor", "preco", "data", "contrato", "procedimento")):
            report["candidate_fields"].append(path)
    os.makedirs("artifacts", exist_ok=True)
    with open("artifacts/contract-schema-audit.json", "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(json.dumps({"years_profiled": [x["year"] for x in report["years"]], "rows_sampled": sum(x["records_sampled"] for x in report["years"]), "candidate_fields": report["candidate_fields"]}, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
