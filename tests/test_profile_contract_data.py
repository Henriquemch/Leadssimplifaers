import io, json, unittest, zipfile
from scripts.profile_contract_data import rows_from_bytes, flatten

class ParserTests(unittest.TestCase):
    def test_json_array(self):
        rows=list(rows_from_bytes(json.dumps([{"NIF":"501000000"},{"NIF":"502000000"}]).encode(),"test.json"))
        self.assertEqual(len(rows),2)
        self.assertEqual(rows[0]["NIF"],"501000000")

    def test_jsonl(self):
        data=b'{"id":1}\n{"id":2}\n'
        rows=list(rows_from_bytes(data,"test.jsonl"))
        self.assertEqual([r["id"] for r in rows],[1,2])

    def test_zip_json(self):
        buff=io.BytesIO()
        with zipfile.ZipFile(buff,"w") as z:
            z.writestr("contracts.json", '[{"id":"abc"}]')
        rows=list(rows_from_bytes(buff.getvalue(),"test.zip"))
        self.assertEqual(rows[0]["id"],"abc")

    def test_flatten_nested_fields(self):
        fields=dict(flatten({"adjudicatario":{"nif":"501000000"}}))
        self.assertIn("adjudicatario.nif",fields)
        self.assertEqual(fields["adjudicatario.nif"],"501000000")

if __name__=="__main__":
    unittest.main()
