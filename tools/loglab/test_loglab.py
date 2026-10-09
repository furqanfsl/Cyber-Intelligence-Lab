"""Run: python -m unittest tools.loglab.test_loglab -v (stdlib only)."""
from __future__ import annotations

import copy
import csv
import io
import json
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from .core import MAX_BYTES, MAX_RECORDS, ImportError, parse_logs, read_logs
from .report import markdown_report
from .rules import analyze_events
from .storage import analyze_database, connect, import_dataset, load_events

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = Path(__file__).with_name("fixtures")


def event(seconds=0, event_id=4625, **values):
    base = datetime(2026, 10, 9, 9, tzinfo=timezone.utc) + timedelta(seconds=seconds)
    return {"timestamp": base.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "host": "SYNTHETIC-LAB-01", "channel": "Security", "eventId": event_id,
            "user": "synthetic-user", "sourceIp": "192.0.2.42", "process": "", "commandLine": "", **values}


def dataset(rows):
    return parse_logs(json.dumps(rows, ensure_ascii=False).encode("utf-8"), "json")


def rules(rows):
    return [alert["ruleId"] for alert in analyze_events(dataset(rows).events)]


class ParserTests(unittest.TestCase):
    def test_fixture_counts_and_ids(self):
        data = read_logs(FIXTURES / "suspicious.synthetic.json")
        self.assertEqual((data.raw_count, len(data.events), data.unsupported), (10, 10, 0))
        self.assertEqual([alert["id"] for alert in analyze_events(data.events)],
                         ["alert-13529386e20896e8", "alert-e87fa79ce8fa009a", "alert-162b3b8b0e1bf189"])

    def test_benign_fixture_has_no_alerts(self):
        self.assertEqual(analyze_events(read_logs(FIXTURES / "benign.synthetic.json").events), [])

    def test_offsets_normalize_and_deduplicate(self):
        first = event(timestamp="2026-10-09T10:00:00.123999999+01:00")
        second = event(timestamp="2026-10-09T09:00:00.123Z", id="untrusted-other-id")
        data = dataset([first, second])
        self.assertEqual(data.events[0]["timestamp"], "2026-10-09T09:00:00.123Z")
        self.assertEqual(data.duplicates, 1)
        self.assertEqual(len(data.source_rows), 2)

    def test_bad_calendar_timezone_and_leap_second(self):
        for value in ("2026-02-30T09:00:00Z", "2026-10-09T09:00:00", "2026-10-09T24:00:00Z",
                      "2026-10-09T09:00:60Z", "2026-10-09T09:00:00+24:00", "2026-10-09T09:00:00+00:60", "not-a-time"):
            with self.subTest(value=value), self.assertRaises(ImportError):
                dataset([event(timestamp=value)])

    def test_valid_leap_day(self):
        self.assertEqual(dataset([event(timestamp="2024-02-29T09:00:00Z")]).events[0]["timestamp"], "2024-02-29T09:00:00.000Z")

    def test_event_id_types(self):
        for value in (True, "4625", 0, -1, 1.2, 9007199254740992, 10 ** 400):
            with self.subTest(value=value), self.assertRaises(ImportError):
                dataset([event(eventId=value)])
        self.assertEqual(dataset([event(eventId=4625.0)]).events[0]["eventId"], 4625)

    def test_required_host_and_channel(self):
        for field in ("host", "channel"):
            for value in ("", None, 42):
                with self.subTest(field=field, value=value), self.assertRaises(ImportError):
                    dataset([event(**{field: value})])

    def test_optional_null_and_placeholders(self):
        data = dataset([event(user=None, sourceIp="-", process="-", commandLine=None)])
        self.assertEqual(data.missing_identity, 1)
        self.assertEqual(rules([event(user=None, sourceIp="-")]), [])
        for field in ("user", "sourceIp", "process", "commandLine"):
            self.assertEqual(data.events[0][field], "")

    def test_utf8_limits_not_character_limits(self):
        self.assertEqual(dataset([event(host="\U0001f512" * 64)]).raw_count, 1)
        with self.assertRaises(ImportError):
            dataset([event(host="\U0001f512" * 65)])

    def test_controls_and_unicode_surrogates(self):
        for value in ("bad\x00name", "bad\x85name", "bad\nname", "bad\ud800name"):
            with self.subTest(value=repr(value)), self.assertRaises((ImportError, UnicodeError)):
                parse_logs(json.dumps([event(host=value)]).encode(), "json")
        self.assertEqual(dataset([event(commandLine="a\nline\twith\rcontrols")]).raw_count, 1)

    def test_unknown_fields_not_retained(self):
        self.assertNotIn("secretExtra", dataset([event(secretExtra="private")]).events[0])

    def test_dedup_ignores_imported_id(self):
        data = dataset([event(id="one"), event(id="two"), event(id=123)])
        self.assertEqual((len(data.events), data.duplicates), (1, 2))

    def test_full_fields_distinguish_events(self):
        self.assertEqual(len(dataset([event(), event(user="different")]).events), 2)

    def test_unsupported_counted_and_validated(self):
        data = dataset([event(eventId=999), event(channel="Application"), event()])
        self.assertEqual((data.raw_count, data.unsupported, len(data.events)), (3, 2, 1))
        with self.assertRaises(ImportError):
            dataset([event(), event(channel="Application", timestamp="bad")])

    def test_sysmon_operational_alias(self):
        data = dataset([event(channel="Microsoft-Windows-Sysmon/Operational", eventId=1)])
        self.assertEqual(data.events[0]["channel"], "Sysmon")

    def test_json_malformed_and_duplicate_fields(self):
        for raw in (b"[", b"{}", b"[null]", b'[{"host":"first","host":"second"}]', b"[NaN]", b"[]"):
            with self.subTest(raw=raw), self.assertRaises(ImportError):
                parse_logs(raw, "json")

    def test_json_depth_bound(self):
        nested = {"unknown": 1}
        for _ in range(65):
            nested = {"unknown": nested}
        with self.assertRaises(ImportError):
            dataset([event(extra=nested)])

    def test_ndjson_unicode_line_separators_in_field(self):
        raw = json.dumps(event(host="synthetic\u2028host"), ensure_ascii=False).encode("utf-8")
        self.assertEqual(parse_logs(raw + b"\n", "ndjson").events[0]["host"], "synthetic\u2028host")

    def test_invalid_unicode_imported_id_is_discarded(self):
        data = parse_logs(json.dumps([event(id="\ud800")]).encode(), "json")
        self.assertEqual(data.source_rows[0][2], "")

    def test_invalid_encoding_and_empty(self):
        for raw in (b"", b" \n", b"\xff"):
            with self.subTest(raw=raw), self.assertRaises(ImportError):
                parse_logs(raw, "json")

    def test_bom_and_ndjson(self):
        raw = (json.dumps(event()) + "\n\n" + json.dumps(event(1))).encode()
        self.assertEqual(len(parse_logs(b"\xef\xbb\xbf" + raw, "ndjson").events), 2)
        with self.assertRaises(ImportError):
            parse_logs(raw + b"\n{", "ndjson")
        with self.assertRaises(ImportError):
            parse_logs(json.dumps(event(extra=float('nan'))).encode(), "ndjson")

    def test_channel_rejects_internal_tabs(self):
        with self.assertRaises(ImportError):
            dataset([event(channel="Unsupported\tChannel")])

    def test_csv_quoted_values_and_shape(self):
        row = event(commandLine='a, "quote"\nnext')
        stream = io.StringIO(newline="")
        writer = csv.DictWriter(stream, fieldnames=list(row))
        writer.writeheader(); writer.writerow(row)
        self.assertEqual(parse_logs(stream.getvalue().encode(), "csv").events[0]["commandLine"], row["commandLine"])
        for raw in (b"host,host\na,b", b"timestamp,host,channel,eventId\na,b,c", b"timestamp,host,channel,eventId\na,b,c,true"):
            with self.subTest(raw=raw), self.assertRaises(ImportError):
                parse_logs(raw, "csv")

    def test_byte_bound_inclusive(self):
        raw = json.dumps([event()]).encode()
        self.assertEqual(parse_logs(raw + b" " * (MAX_BYTES - len(raw)), "json").raw_count, 1)
        with self.assertRaises(ImportError):
            parse_logs(raw + b" " * (MAX_BYTES + 1 - len(raw)), "json")

    def test_raw_record_bound_includes_duplicates(self):
        data = dataset([event()] * MAX_RECORDS)
        self.assertEqual((len(data.events), data.duplicates), (1, MAX_RECORDS - 1))
        with self.assertRaises(ImportError):
            dataset([event(eventId=999)] * (MAX_RECORDS + 1))

    def test_hash_collision_atomic(self):
        with patch("tools.loglab.core.stable_id", return_value="evt-collision"), self.assertRaises(ImportError):
            dataset([event(), event(1)])


class RuleTests(unittest.TestCase):
    def test_r001_threshold_and_inclusive_window(self):
        self.assertEqual(rules([event(index * 75) for index in range(5)]), ["R001"])
        self.assertEqual(rules([event(index * 75.00025) for index in range(5)]), [])
        self.assertEqual(rules([event(index) for index in range(4)]), [])

    def test_one_per_contiguous_burst(self):
        self.assertEqual(rules([event(second) for second in [0, 1, 2, 3, 4, *range(120, 3600, 120)]]), ["R001"])
        self.assertEqual(rules([*[event(index) for index in range(5)], *[event(305 + index) for index in range(5)]]), ["R001", "R001"])

    def test_r002_threshold_and_inclusive_followup(self):
        failures = [event(index) for index in range(5)]
        self.assertEqual(rules([*failures, event(604, 4624)]), ["R001", "R002"])
        self.assertEqual(rules([*failures, event(604.001, 4624)]), ["R001"])
        self.assertEqual(rules([*failures, event(4, 4624)]), ["R001"])

    def test_same_timestamp_new_failure_keeps_older_eligible_proof(self):
        rows = [*[event(index) for index in range(5)], event(10), event(10, 4624)]
        alerts = analyze_events(dataset(rows).events)
        self.assertIn("R002", [alert["ruleId"] for alert in alerts])
        proof = next(alert for alert in alerts if alert["ruleId"] == "R002")["evidenceIds"]
        self.assertNotIn(dataset([event(10)]).events[0]["id"], proof[:-1])

    def test_r002_latest_proof_and_multiple_successes(self):
        rows = [*[event(index) for index in range(6)], event(10, 4624), event(11, 4624)]
        alerts = analyze_events(dataset(rows).events)
        self.assertEqual([a["ruleId"] for a in alerts], ["R001", "R002", "R002"])
        first_failure_id = dataset([event(0)]).events[0]["id"]
        self.assertNotIn(first_failure_id, alerts[1]["evidenceIds"])

    def test_exact_identity_required(self):
        failures = [event(index) for index in range(5)]
        for values in ({"host": "OTHER"}, {"user": "SYNTHETIC-USER"}, {"sourceIp": "198.51.100.18"}):
            with self.subTest(values=values):
                self.assertEqual(rules([*failures, event(10, 4624, **values)]), ["R001"])

    def test_missing_identity_excluded(self):
        self.assertEqual(rules([event(index, user="") for index in range(8)]), [])
        self.assertEqual(rules([event(index, sourceIp="-") for index in range(8)]), [])

    def test_r003_flags_process_and_quotes(self):
        for process, command in (("C:\\pwsh.exe", "pwsh -ENC value"), ("powershell", 'powershell "-EncodedCommand" value')):
            with self.subTest(command=command):
                self.assertEqual(rules([event(channel="Sysmon", eventId=1, process=process, commandLine=command)]), ["R003"])
        for command in ('pwsh -Command "Write-Output -enc"', "pwsh -File task.ps1 -enc value", "pwsh -encoding value", 'pwsh -enc "unclosed'):
            with self.subTest(command=command):
                self.assertEqual(rules([event(channel="Sysmon", eventId=1, process="pwsh.exe", commandLine=command)]), [])
        self.assertEqual(rules([event(channel="Sysmon", eventId=1, process="notepad.exe", commandLine="notepad -enc value")]), [])

    def test_order_independent_and_proof_bounded(self):
        rows = json.loads((FIXTURES / "suspicious.synthetic.json").read_text())
        first = analyze_events(dataset(rows).events)
        self.assertEqual(first, analyze_events(dataset(list(reversed(rows))).events))
        self.assertEqual([len(alert["evidenceIds"]) for alert in first], [5, 6, 1])


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "private.sqlite"
        self.connection = connect(self.path, create=True)

    def tearDown(self):
        self.connection.close(); self.temp.cleanup()

    def test_import_dedup_provenance_and_analysis_runs(self):
        data = read_logs(FIXTURES / "suspicious.synthetic.json")
        self.assertEqual(import_dataset(self.connection, data, "fixture.json")["insertedCount"], 10)
        self.assertEqual(import_dataset(self.connection, data, "again.json")["duplicateCount"], 10)
        self.assertEqual(self.connection.execute("SELECT COUNT(*) FROM event_imports").fetchone()[0], 20)
        for _ in range(2):
            self.assertEqual(analyze_database(self.connection)["candidateCount"], 3)
        self.assertEqual(self.connection.execute("SELECT COUNT(*) FROM alerts").fetchone()[0], 3)
        self.assertEqual(self.connection.execute("SELECT COUNT(*) FROM alert_evidence").fetchone()[0], 12)

    def test_parameterized_sql_and_default_report_redaction(self):
        secret = "sensitive-' ; DROP TABLE events; -- <img src=x>"
        rows = [event(index, host=secret, user="private-account", sourceIp="198.51.100.99", commandLine="private-secret-token") for index in range(5)]
        import_dataset(self.connection, dataset(rows), "private-filename.json")
        analyze_database(self.connection)
        text = markdown_report(self.connection)
        for value in (secret, "private-account", "198.51.100.99", "private-secret-token", "private-filename.json", "evt-"):
            self.assertNotIn(value, text)
        self.assertIn("host-", text); self.assertIn("not confirmed attacks", text)
        self.assertEqual(len(load_events(self.connection)), 5)
        self.assertEqual(text, markdown_report(self.connection))

    def test_report_metadata_is_allowlisted_after_database_edit(self):
        import_dataset(self.connection, dataset([event(index) for index in range(5)]), "fixture")
        analyze_database(self.connection)
        with self.connection:
            self.connection.execute("UPDATE alerts SET title=?,severity=?", ("private-identity", "private-severity"))
        text = markdown_report(self.connection)
        self.assertNotIn("private-identity", text); self.assertNotIn("private-severity", text)
        with self.connection:
            self.connection.execute("UPDATE alerts SET ruleId=?", ("private-rule",))
        with self.assertRaises(ImportError):
            markdown_report(self.connection)

    def test_storage_collision_rolls_back(self):
        data = dataset([event()]); import_dataset(self.connection, data, "original")
        altered = copy.deepcopy(data.events); altered[0]["host"] = "different"
        with self.assertRaises(ImportError):
            import_dataset(self.connection, replace(data, events=altered), "invalid")
        self.assertEqual(self.connection.execute("SELECT COUNT(*) FROM imports").fetchone()[0], 1)
        self.assertEqual(load_events(self.connection)[0]["host"], "SYNTHETIC-LAB-01")

    def test_capacity_failure_rolls_back_entire_import(self):
        with patch("tools.loglab.storage.MAX_RECORDS", 1), self.assertRaises(ImportError):
            import_dataset(self.connection, dataset([event(), event(1)]), "too-many")
        self.assertEqual(len(load_events(self.connection)), 0)
        self.assertEqual(self.connection.execute("SELECT COUNT(*) FROM imports").fetchone()[0], 0)

    def test_actual_10000_unique_capacity_and_reimport(self):
        data = dataset([event(index) for index in range(MAX_RECORDS)])
        self.assertEqual(import_dataset(self.connection, data, "full.synthetic.json")["insertedCount"], MAX_RECORDS)
        self.assertEqual(import_dataset(self.connection, data, "repeat.synthetic.json")["duplicateCount"], MAX_RECORDS)
        with self.assertRaises(ImportError):
            import_dataset(self.connection, dataset([event(MAX_RECORDS)]), "overflow.synthetic.json")
        self.assertEqual(len(load_events(self.connection)), MAX_RECORDS)
        self.assertEqual(self.connection.execute("SELECT COUNT(*) FROM imports").fetchone()[0], 2)

    def test_reject_foreign_database(self):
        other = Path(self.temp.name) / "other.sqlite"
        with sqlite3.connect(other) as connection:
            connection.execute("CREATE TABLE unrelated(id)")
        connection.close()
        with self.assertRaises(ImportError):
            connect(other, create=True)

    def test_report_requires_analysis_and_has_honest_empty_state(self):
        with self.assertRaises(ImportError):
            markdown_report(self.connection)
        analyze_database(self.connection)
        self.assertIn("does not establish that the system is safe", markdown_report(self.connection))

    def test_readonly_investigation_queries_execute(self):
        import_dataset(self.connection, read_logs(FIXTURES / "suspicious.synthetic.json"), "fixture")
        analyze_database(self.connection)
        sql = (Path(__file__).with_name("sql") / "analysis.sql").read_text()
        before = self.connection.total_changes
        self.connection.executescript(sql)
        self.assertEqual(before, self.connection.total_changes)

    def test_cli_end_to_end_and_refuses_report_overwrite(self):
        def call(*args):
            return subprocess.run([sys.executable, "-m", "tools.loglab", "--db", str(self.path), *args], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(call("import", str(FIXTURES / "suspicious.synthetic.json")).returncode, 0)
        self.assertEqual(json.loads(call("analyze").stdout)["candidateCount"], 3)
        output = Path(self.temp.name) / "report.md"
        self.assertEqual(call("report", "--output", str(output)).returncode, 0)
        self.assertEqual(call("report", "--output", str(output)).returncode, 2)
        self.assertNotIn("synthetic-user", output.read_text())

    def test_invalid_cli_import_creates_no_database(self):
        invalid = Path(self.temp.name) / "invalid.json"; invalid.write_text("[")
        absent = Path(self.temp.name) / "absent.sqlite"
        result = subprocess.run([sys.executable, "-m", "tools.loglab", "--db", str(absent), "import", str(invalid)], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(result.returncode, 2); self.assertFalse(absent.exists())


@unittest.skipUnless(shutil.which("node"), "Node is optional; required only for cross-engine parity tests.")
class ParityTests(unittest.TestCase):
    def test_malformed_timezone_and_utc_range_rejected_by_both(self):
        code = """import fs from 'node:fs'; import {parseLogs} from './src/lib/log-analysis.ts';
try {parseLogs(fs.readFileSync(0,'utf8'),'case.json');console.log('accepted')}catch{console.log('rejected')}"""
        for value in ("2026-10-09T09:00:00+00:60", "0001-01-01T00:00:00+01:00", "9999-12-31T23:59:59-01:00", "0000-01-01T00:00:00Z"):
            with self.subTest(value=value):
                rows = [event(timestamp=value)]
                result = subprocess.run(["node", "--input-type=module", "-e", code], cwd=ROOT,
                                        input=json.dumps(rows), capture_output=True, text=True, encoding="utf-8", check=True)
                self.assertEqual(result.stdout.strip(), "rejected")
                with self.assertRaises(ImportError):
                    dataset(rows)

    def test_actual_typescript_engine_matches_python(self):
        code = """import fs from 'node:fs'; import {parseLogs,analyzeLogs} from './src/lib/log-analysis.ts';
const data=parseLogs(fs.readFileSync(0,'utf8'),'canonical.json');
console.log(JSON.stringify({events:data.events,alerts:analyzeLogs(data.events).map(({id,ruleId,title,severity,evidenceIds,firstSeen,lastSeen})=>({id,ruleId,title,severity,evidenceIds,firstSeen,lastSeen}))}));"""
        cases = [json.loads((FIXTURES / name).read_text()) for name in ("suspicious.synthetic.json", "benign.synthetic.json")]
        cases += [[*[event(index * 75) for index in range(5)], event(900, 4624)],
                  [*[event(index) for index in range(5)], event(10), event(10, 4624)],
                  [event(host="\u00c9quipe-\U0001f512", timestamp="2026-10-09T10:00:00.1239999+01:00")],
                  [event(channel="Sysmon", eventId=1, process="pwsh.exe", commandLine='pwsh -Command "Write-Output -enc"')]]
        for rows in cases:
            with self.subTest(rows=len(rows)):
                result = subprocess.run(["node", "--input-type=module", "-e", code], cwd=ROOT, input=json.dumps(rows, ensure_ascii=False), capture_output=True, text=True, encoding="utf-8", check=True)
                actual = json.loads(result.stdout); data = dataset(rows)
                projection = [{key: alert[key] for key in ("id", "ruleId", "title", "severity", "evidenceIds", "firstSeen", "lastSeen")} for alert in analyze_events(data.events)]
                self.assertEqual(actual, {"events": data.events, "alerts": projection})


@unittest.skipUnless(sys.platform == "win32" and shutil.which("powershell"), "PowerShell exporter is Windows-only.")
class ExporterTests(unittest.TestCase):
    def test_isolated_synthetic_exporter(self):
        result = subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
                                 str(Path(__file__).with_name("test-exporter.ps1"))],
                                cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("No real Get-WinEvent cmdlet was called", result.stdout)


if __name__ == "__main__":
    unittest.main()
