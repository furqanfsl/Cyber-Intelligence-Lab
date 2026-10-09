"""Private SQLite retention with atomic imports and explicit evidence relations."""
from __future__ import annotations

import secrets
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from .core import Dataset, FIELDS, ImportError, MAX_RECORDS, event_tuple
from .rules import analyze_events

APPLICATION_ID = 1279410508
ENGINE_VERSION = "1"
SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (
 id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, host TEXT NOT NULL,
 channel TEXT NOT NULL CHECK(channel IN ('Security','Sysmon')),
 eventId INTEGER NOT NULL CHECK(eventId IN (1,3,4624,4625)),
 user TEXT NOT NULL, sourceIp TEXT NOT NULL, process TEXT NOT NULL, commandLine TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_identity_time ON events(host,user,sourceIp,timestamp);
CREATE TABLE IF NOT EXISTS imports (
 id TEXT PRIMARY KEY, importedAt TEXT NOT NULL, filename TEXT NOT NULL, sha256 TEXT NOT NULL,
 rawCount INTEGER NOT NULL, insertedCount INTEGER NOT NULL, duplicateCount INTEGER NOT NULL,
 unsupportedCount INTEGER NOT NULL, missingIdentityCount INTEGER NOT NULL, missingProcessCount INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS event_imports (
 importId TEXT NOT NULL REFERENCES imports(id), rowNumber INTEGER NOT NULL,
 eventId TEXT NOT NULL REFERENCES events(id), originalId TEXT NOT NULL,
 PRIMARY KEY(importId,rowNumber)
);
CREATE TABLE IF NOT EXISTS analysis_runs (
 id TEXT PRIMARY KEY, createdAt TEXT NOT NULL, engineVersion TEXT NOT NULL,
 eventCount INTEGER NOT NULL, alertCount INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS alerts (
 id TEXT PRIMARY KEY, ruleId TEXT NOT NULL, title TEXT NOT NULL,
 severity TEXT NOT NULL, timestamp TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS alert_evidence (
 alertId TEXT NOT NULL REFERENCES alerts(id), ordinal INTEGER NOT NULL,
 eventId TEXT NOT NULL REFERENCES events(id), PRIMARY KEY(alertId,ordinal)
);
CREATE TABLE IF NOT EXISTS run_alerts (
 runId TEXT NOT NULL REFERENCES analysis_runs(id), alertId TEXT NOT NULL REFERENCES alerts(id),
 PRIMARY KEY(runId,alertId)
);
"""


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def connect(path: Path, *, create: bool = False) -> sqlite3.Connection:
    if not create and not path.is_file():
        raise ImportError("Database does not exist. Run init or import first.")
    if create:
        path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=5)
    try:
        return _initialize_connection(connection, create)
    except BaseException:
        connection.close()
        raise


def _initialize_connection(connection: sqlite3.Connection, create: bool) -> sqlite3.Connection:
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys=ON")
    connection.execute("PRAGMA trusted_schema=OFF")
    app_id = connection.execute("PRAGMA application_id").fetchone()[0]
    version = connection.execute("PRAGMA user_version").fetchone()[0]
    tables = connection.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    if (app_id not in (0, APPLICATION_ID) or version not in (0, 1)
            or (app_id == 0 and tables)):
        raise ImportError("This is not a compatible Log Lab database; use a different file.")
    if not create and (app_id != APPLICATION_ID or version != 1):
        raise ImportError("Database is not initialized for Log Lab.")
    if create:
        with connection:
            connection.executescript(SCHEMA)
            connection.execute(f"PRAGMA application_id={APPLICATION_ID}")
            connection.execute("PRAGMA user_version=1")
            connection.execute("INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)",
                               ("report_salt", secrets.token_hex(32)))
    return connection


def import_dataset(connection: sqlite3.Connection, dataset: Dataset, filename: str) -> dict:
    """Any validation/collision/capacity failure rolls back records and provenance."""
    inserted = duplicates = 0
    import_id = str(uuid4())
    with connection:
        connection.execute("BEGIN IMMEDIATE")
        count = connection.execute("SELECT COUNT(*) FROM events").fetchone()[0]
        for event in dataset.events:
            existing = connection.execute("SELECT * FROM events WHERE id=?", (event["id"],)).fetchone()
            if existing is not None:
                if event_tuple(dict(existing)) != event_tuple(event):
                    raise ImportError("Canonical identifier collision; no records were imported.")
                duplicates += 1
                continue
            if count + inserted >= MAX_RECORDS:
                raise ImportError("Database would exceed 10,000 unique events; no records were imported.")
            connection.execute("INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?)",
                               (event["id"], *event_tuple(event)))
            inserted += 1
        result = {"importId": import_id, "rawCount": dataset.raw_count, "insertedCount": inserted,
                  "duplicateCount": duplicates + dataset.duplicates,
                  "unsupportedCount": dataset.unsupported,
                  "missingIdentityCount": dataset.missing_identity,
                  "missingProcessCount": dataset.missing_process}
        connection.execute("INSERT INTO imports VALUES (?,?,?,?,?,?,?,?,?,?)",
                           (import_id, now(), filename, dataset.sha256, dataset.raw_count, inserted,
                            result["duplicateCount"], dataset.unsupported, dataset.missing_identity, dataset.missing_process))
        connection.executemany("INSERT INTO event_imports VALUES (?,?,?,?)",
                               [(import_id, row, event_id, original_id)
                                for event_id, row, original_id in dataset.source_rows])
    return result


def load_events(connection: sqlite3.Connection) -> list[dict]:
    rows = connection.execute("SELECT * FROM events ORDER BY timestamp,id LIMIT ?", (MAX_RECORDS + 1,)).fetchall()
    if len(rows) > MAX_RECORDS:
        raise ImportError("Database exceeds the supported 10,000-event analysis limit.")
    return [dict(row) for row in rows]


def analyze_database(connection: sqlite3.Connection) -> dict:
    run_id = str(uuid4())
    with connection:
        connection.execute("BEGIN IMMEDIATE")
        events = load_events(connection)
        alerts = analyze_events(events)
        connection.execute("INSERT INTO analysis_runs VALUES (?,?,?,?,?)",
                           (run_id, now(), ENGINE_VERSION, len(events), len(alerts)))
        for alert in alerts:
            existing = connection.execute("SELECT * FROM alerts WHERE id=?", (alert["id"],)).fetchone()
            if existing:
                evidence = [row[0] for row in connection.execute(
                    "SELECT eventId FROM alert_evidence WHERE alertId=? ORDER BY ordinal", (alert["id"],))]
                if existing["ruleId"] != alert["ruleId"] or evidence != alert["evidenceIds"]:
                    raise ImportError("Alert identifier collision; analysis was rolled back.")
            else:
                connection.execute("INSERT INTO alerts VALUES (?,?,?,?,?)",
                                   tuple(alert[field] for field in ("id", "ruleId", "title", "severity", "timestamp")))
                connection.executemany("INSERT INTO alert_evidence VALUES (?,?,?)",
                                       [(alert["id"], ordinal, event_id)
                                        for ordinal, event_id in enumerate(alert["evidenceIds"])])
            connection.execute("INSERT INTO run_alerts VALUES (?,?)", (run_id, alert["id"]))
    return {"runId": run_id, "eventCount": len(events), "candidateCount": len(alerts)}
