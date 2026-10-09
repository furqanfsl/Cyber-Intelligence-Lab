"""Default-only redacted, factual reports; never echo raw logs or command lines."""
from __future__ import annotations

import hashlib
import hmac
import sqlite3

from .core import ImportError, MAX_RECORDS, SUPPORTED, normalize_timestamp
from .rules import RULES
from .storage import ENGINE_VERSION


def markdown_report(connection: sqlite3.Connection, run_id: str | None = None) -> str:
    if run_id is None:
        row = connection.execute("SELECT id FROM analysis_runs ORDER BY createdAt DESC,rowid DESC LIMIT 1").fetchone()
        if row is None:
            raise ImportError("No analysis exists. Run analyze first.")
        run_id = row["id"]
    run = connection.execute("SELECT * FROM analysis_runs WHERE id=?", (run_id,)).fetchone()
    if run is None:
        raise ImportError("Requested analysis run does not exist.")
    if (run["engineVersion"] != ENGINE_VERSION or type(run["eventCount"]) is not int
            or type(run["alertCount"]) is not int or not 0 <= run["eventCount"] <= MAX_RECORDS
            or not 0 <= run["alertCount"] <= MAX_RECORDS):
        raise ImportError("Stored analysis metadata is incompatible with this report generator.")
    run_time = normalize_timestamp(run["createdAt"], 0)
    salt = bytes.fromhex(connection.execute("SELECT value FROM settings WHERE key=?", ("report_salt",)).fetchone()[0])

    def label(kind: str, value: str) -> str:
        if not value:
            return "not recorded"
        digest = hmac.new(salt, f"{kind}:{value}".encode("utf-8"), hashlib.sha256).hexdigest()[:12]
        return f"{kind}-{digest}"

    lines = ["# Local log investigation", "", "**Candidate rule matches, not confirmed attacks.**", "",
             f"Analysis time (UTC): {run_time}", f"Events reviewed: {run['eventCount']}",
             f"Candidate matches: {run['alertCount']}", f"Rules version: {run['engineVersion']}", "",
             "Host, user and source-IP values are pseudonymized. Command lines, raw process paths,",
             "input filenames and original record identifiers are omitted. Normalized UTC millisecond times remain.",
             "Pseudonymization is not anonymization; review this report before sharing.", "",
             "The SQLite database still contains sensitive source fields. No logs were sent to an AI service.", ""]
    alerts = connection.execute("""SELECT a.* FROM alerts a JOIN run_alerts r ON r.alertId=a.id
                                   WHERE r.runId=? ORDER BY a.timestamp,a.id""", (run_id,)).fetchall()
    if not alerts:
        lines += ["No matches were found by these three rules. This does not establish that the system is safe.", ""]
    for index, alert in enumerate(alerts, 1):
        if alert["ruleId"] not in RULES:
            raise ImportError("Stored analysis contains an unsupported rule identifier.")
        title, severity = RULES[alert["ruleId"]]
        triggered = normalize_timestamp(alert["timestamp"], 0)
        lines += [f"## Candidate {index}: {alert['ruleId']} {title}", "",
                  f"Priority: {severity}. Trigger time (UTC): {triggered}.", "",
                  "| Evidence | UTC time | Channel / event | Host | User | Observed source |",
                  "| --- | --- | --- | --- | --- | --- |"]
        rows = connection.execute("""SELECT e.* FROM events e JOIN alert_evidence a ON a.eventId=e.id
                                     WHERE a.alertId=? ORDER BY a.ordinal""", (alert["id"],)).fetchall()
        for ordinal, event in enumerate(rows, 1):
            if (event["channel"], event["eventId"]) not in SUPPORTED:
                raise ImportError("Stored evidence contains an unsupported event type.")
            evidence_time = normalize_timestamp(event["timestamp"], 0)
            lines.append(f"| event-{ordinal:03d} | {evidence_time} | {event['channel']} / {event['eventId']} | "
                         f"{label('host', event['host'])} | {label('user', event['user'])} | {label('ip', event['sourceIp'])} |")
        lines += ["", "Review the original retained evidence and expected activity before deciding whether to investigate further.", ""]
    lines += ["## Limits", "", "This is offline analysis of supplied records, not continuous monitoring, an AI model,",
              "a sensor, or proof of malicious intent. Missing logs and legitimate administrative activity",
              "can change the result. A recorded IP can be a proxy, VPN exit or shared gateway; it does not identify a person.", ""]
    return "\n".join(lines)
