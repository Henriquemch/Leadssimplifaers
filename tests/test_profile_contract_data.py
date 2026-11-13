import io
import json
import unittest
import zipfile
import importlib.util
from pathlib import Path
from openpyxl import Workbook

SCRIPT = Path(__file__).parents[1] / "scripts" / "profile-contract-data.py"
spec = importlib.util.spec_from_file_location("profile_contract_data", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
rows_from_bytes, flatten = module.rows_from_bytes, module.flatten


class ParserTests(unittest.TestCase):
    def test_json_array(self):
        rows = list(rows_from_bytes(json.dumps([{"NIF": "501000000"}, {"NIF": "502000000"}]).encode(), "test.json"))
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["NIF"], "501000000")

    def test_jsonl(self):
        rows = list(rows_from_bytes(b'{"id":1}\n{"id":2}\n', "test.jsonl"))
        self.assertEqual([r["id"] for r in rows], [1, 2])

    def test_zip_json(self):
        buff = io.BytesIO()
        with zipfile.ZipFile(buff, "w") as archive:
            archive.writestr("contracts.json", '[{"id":"abc"}]')
        rows = list(rows_from_bytes(buff.getvalue(), "test.zip"))
        self.assertEqual(rows[0]["id"], "abc")

    def test_zip_xlsx(self):
        workbook_buffer = io.BytesIO()
        workbook = Workbook()
        sheet = workbook.active
        sheet.append(["NIF", "Nome"])
        sheet.append(["501000000", "Empresa Exemplo"])
        workbook.save(workbook_buffer)
        archive_buffer = io.BytesIO()
        with zipfile.ZipFile(archive_buffer, "w") as archive:
            archive.writestr("contracts.xlsx", workbook_buffer.getvalue())
        rows = list(rows_from_bytes(archive_buffer.getvalue(), "test.zip"))
        self.assertEqual(rows[0]["NIF"], "501000000")

    def test_excel_workbook_with_zip_extension(self):
        workbook_buffer = io.BytesIO()
        workbook = Workbook()
        sheet = workbook.active
        sheet.append(["NIF", "Nome"])
        sheet.append(["503000000", "Empresa BASE"])
        workbook.save(workbook_buffer)
        rows = list(rows_from_bytes(workbook_buffer.getvalue(), "contratos2026.zip"))
        self.assertEqual(rows[0]["NIF"], "503000000")

    def test_flatten_nested_fields(self):
        fields = dict(flatten({"adjudicatario": {"nif": "501000000"}}))
        self.assertIn("adjudicatario.nif", fields)
        self.assertEqual(fields["adjudicatario.nif"], "501000000")


IMPORT_SCRIPT = Path(__file__).parents[1] / "scripts" / "import-base-contracts.py"
import_spec = importlib.util.spec_from_file_location("import_base_contracts", IMPORT_SCRIPT)
import_module = importlib.util.module_from_spec(import_spec)
import_spec.loader.exec_module(import_module)


class ImportMappingTests(unittest.TestCase):
    def test_awardee_and_explicit_competitor_are_separated(self):
        row = {
            "idcontrato": "12345",
            "dataCelebracaoContrato": "2025-01-10",
            "adjudicatarios": "[{'nifEntContrato': '501000000', 'descEntContrato': 'Adjudicatária Lda'}]",
            "concorrentes": "['502000000-Concorrente SA']",
            "CPV": "[{'cpvID': '45000000-7'}]",
            "precoContratual": 2500,
            "adjudicante": "NIPCEntidade=510342647|Entidade=Instituto Público",
        }
        records = import_module.normalized_records(row, import_module.date(2024, 1, 1))
        self.assertEqual([x["procurement"]["participant_role"] for x in records], ["awardee", "competitor_confirmed"])
        self.assertEqual(records[0]["procurement"]["cpv"], "45000000-7")
        self.assertEqual(records[1]["company"]["id"], "nif:502000000")\n        self.assertEqual(records[0]["procurement"]["contracting_authority"], "Instituto Público")

    def test_excludes_contracts_outside_rolling_window(self):
        row = {
            "idcontrato": "old",
            "dataCelebracaoContrato": "2020-12-31",
            "adjudicatarios": [{"nifEntContrato": "501000000", "descEntContrato": "Empresa"}],
        }
        self.assertEqual(import_module.normalized_records(row, import_module.date(2021, 1, 1)), [])

    def test_requires_valid_nif_shape_and_named_entity(self):
        row = {
            "idcontrato": "123",
            "dataCelebracaoContrato": "2025-01-10",
            "adjudicatarios": [{"nifEntContrato": "12", "descEntContrato": "Sem NIF válido"}],
        }
        self.assertEqual(import_module.normalized_records(row, import_module.date(2024, 1, 1)), [])



if __name__ == "__main__":
    unittest.main()
