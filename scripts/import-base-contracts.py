#!/usr/bin/env python3
"""Incremental, minimal-field importer for official BASE contract archives."""
import ast
import json
import os
import re
import sys
import urllib.request
from collections import OrderedDict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from importlib.util import spec_from_file_location, module_from_spec
_parser_spec = spec_from_file_location("profile_contract_data", ROOT / "scripts" / "profile-contract-data.py")
_parser = module_from_spec(_parser_spec)
_parser_spec.loader.exec_module(_parser)
rows_from_bytes = _parser.rows_from_bytes

NIF_RE = re.compile(r"(?<!\d)(\d{9})(?!\d)")
RESOURCE_YEAR_RE = re.compile(r"contratos(202[1-6])", re.I)


def as_collection(value):
    if value is None or value == "":
        return []
    if isinstance(value, (list, tuple)):
        return list(value)
    if isinstance(value, dict):
        return [value]
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return []
        try:
            parsed = json.loads(raw)
        except Exception:
            try:
                parsed = ast.literal_eval(raw)
            except Exception:
                return [raw]
        if isinstance(parsed, list):
            return parsed
        if isinstance(parsed, dict):
            return [parsed]
        return []
    return []


def pick(obj, *names):
    if not isinstance(obj, dict):
        return None
    for name in names:
        value = obj.get(name)
        if value not in (None, ""):
            return value
    return None


def normalize_nif(value):
    if value is None:
        return None
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    digits = re.sub(r"\D", "", str(value))
    return digits if len(digits) == 9 else None


def parse_entity(item):
    if isinstance(item, dict):
        nif = normalize_nif(pick(item, "nifEntContrato", "NIPCEntidade", "nif", "NIF", "nipc", "NIPC"))
        name = pick(item, "descEntContrato", "Entidade", "nome", "Nome", "designacao", "denominacao")
        return (nif, str(name).strip() if name else None)
    if isinstance(item, str):
        match = re.match(r"^\s*(\d{9})\s*[-–|:]\s*(.+?)\s*$", item)
        if match:
            return match.group(1), match.group(2)
        pairs = dict(re.findall(r"(NIPCEntidade|nifEntContrato|NIF|NIPC|Entidade|descEntContrato)\s*=\s*([^|]+)", item, re.I))
        nif = normalize_nif(pick(pairs, "NIPCEntidade", "nifEntContrato", "NIF", "NIPC"))
        name = pick(pairs, "Entidade", "descEntContrato")
        if nif and name:
            return nif, str(name).strip()
    return None, None


def contract_date(row):
    for key in ("dataCelebracaoContrato", "dataDecisaoAdjudicacao", "dataPublicacao"):
        value = row.get(key)
        if not value:
            continue
        try:
            return date.fromisoformat(str(value)[:10])
        except ValueError:
            continue
    return None


def cpv_code(value):
    entries = as_collection(value)
    for entry in entries:
        if isinstance(entry, dict):
            code = pick(entry, "cpvID", "codigoCPV", "CPV")
            if code:
                return str(code)[:30]
        elif isinstance(entry, str):
            match = re.search(r"\d{8}-\d", entry)
            if match:
                return match.group(0)
    return None


def participants(row):
    found = OrderedDict()
    for item in as_collection(row.get("adjudicatarios")):
        nif, name = parse_entity(item)
        if nif and name:
            found[nif] = (name, "awardee")
    for item in as_collection(row.get("concorrentes")):
        nif, name = parse_entity(item)
        if nif and name and nif not in found:
            found[nif] = (name, "competitor_confirmed")
    return found


def normalized_records(row, cutoff):
    signed = contract_date(row)
    if not signed or signed < cutoff:
        return []
    source_id = pick(row, "idcontrato", "idprocedimento", "IDAnuncio")
    if source_id is None:
        return []
    source_id = str(source_id).strip()
    if not source_id:
        return []
    authority = None
    authorities = as_collection(row.get("adjudicante"))
    if authorities:
        _, authority = parse_entity(authorities[0])
        if not authority and isinstance(authorities[0], str):
            authority = authorities[0][:200]
    description = pick(row, "descContrato", "objectoContrato")
    procedure = pick(row, "tipoprocedimento")
    amount = row.get("precoContratual")
    try:
        amount = float(amount) if amount not in (None, "") else None
    except (ValueError, TypeError):
        amount = None
    procedure_url = pick(row, "linkPecasProc")
    output = []
    for nif, (name, role) in participants(row).items():
        company_id = "nif:" + nif
        output.append({
            "company": {
                "id": company_id, "nif": nif, "name": name,
                "evidence_type": role,
                "source_url": "https://www.base.gov.pt/Base4/pt/",
            },
            "procurement": {
                "source_id": source_id, "company_id": company_id, "company_nif": nif,
                "company_name": name, "participant_role": role,
                "procedure_type": str(procedure)[:100] if procedure else None,
                "cpv": cpv_code(row.get("CPV")),
                "description": str(description)[:500] if description else None,
                "contracting_authority": str(authority)[:200] if authority else None,
                "contract_value": amount, "publication_date": signed.isoformat(),
                "procedure_url": str(procedure_url)[:500] if procedure_url else None,
            },
        })
    return output


def post_batch(worker_url, secret, companies, procurements):
    payload = json.dumps({"companies": companies, "procurements": procurements}, ensure_ascii=False).encode()
    request = urllib.request.Request(
        worker_url.rstrip("/") + "/internal/import/batch", data=payload, method="POST",
        headers={"authorization": "Bearer " + secret, "content-type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        result = json.loads(response.read().decode("utf-8"))
        if response.status >= 300 or not result.get("ok"):
            raise RuntimeError("Worker rejeitou lote: " + str(result))
        return result


def main():
    manifest_path = ROOT / "data" / "source-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    source = next((s for s in manifest.get("sources", []) if s.get("key") == "contracts"), None)
    if not source:
        raise SystemExit("Manifesto sem a fonte oficial BASE de contratos.")
    today = date.today()
    cutoff = today.replace(year=today.year - 5)
    dry_run = os.getenv("LEADPILOT_DRY_RUN", "true").lower() != "false"
    worker_url = os.getenv("LEADPILOT_WORKER_URL", "")
    secret = os.getenv("INGEST_SECRET", "")
    if not dry_run and (not worker_url.startswith("https://") or not secret):
        raise SystemExit("Importação real exige LEADPILOT_WORKER_URL HTTPS e INGEST_SECRET.")

    resources = []
    for resource in source.get("resources", []):
        title = resource.get("title") or ""
        match = RESOURCE_YEAR_RE.search(title)
        if match and resource.get("url") and int(match.group(1)) >= cutoff.year:
            resources.append((int(match.group(1)), resource))
    if not resources:
        raise SystemExit("Não foram encontrados arquivos anuais contratos2021–2026 no manifesto.")
    resources.sort()
    totals = {"files": 0, "rows_seen": 0, "rows_in_window": 0, "companies": 0, "procurement_links": 0, "batches": 0}
    companies_seen = set()
    pending_companies, pending_procurements = OrderedDict(), []
    for year, resource in resources:
        request = urllib.request.Request(resource["url"], headers={"User-Agent": "LeadPilot-BASE-import/1.0"})
        with urllib.request.urlopen(request, timeout=180) as response:
            data = response.read()
        totals["files"] += 1
        for row in rows_from_bytes(data, resource.get("title", "")):
            totals["rows_seen"] += 1
            records = normalized_records(row, cutoff)
            if not records:
                continue
            totals["rows_in_window"] += 1
            for record in records:
                company = record["company"]
                existing = pending_companies.get(company["id"])
                if existing is None or company["evidence_type"] == "competitor_confirmed":
                    pending_companies[company["id"]] = company
                pending_procurements.append(record["procurement"])
                if company["id"] not in companies_seen:
                    companies_seen.add(company["id"])
                    totals["companies"] = len(companies_seen)
                totals["procurement_links"] += 1
                if len(pending_companies) + len(pending_procurements) >= 80:
                    companies = list(pending_companies.values())
                    if not dry_run:
                        post_batch(worker_url, secret, companies, pending_procurements)
                    totals["batches"] += 1
                    pending_companies.clear()
                    pending_procurements.clear()
        del data
    if pending_companies or pending_procurements:
        if not dry_run:
            post_batch(worker_url, secret, list(pending_companies.values()), pending_procurements)
        totals["batches"] += 1
    print(json.dumps({
        "mode": "dry_run" if dry_run else "imported",
        "cutoff": cutoff.isoformat(), "totals": totals,
        "note": "Amostra completa dos ficheiros anuais selecionados; apenas adjudicatários e concorrentes explicitamente listados. Sem NIF válido, a entidade é ignorada. Nenhum payload bruto é guardado.",
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
