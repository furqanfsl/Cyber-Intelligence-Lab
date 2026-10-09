"""Strict, bounded normalization shared with the browser's deterministic rules."""
from __future__ import annotations

import csv
import hashlib
import io
import json
import math
import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

MAX_BYTES = 5 * 1024 * 1024
MAX_RECORDS = 10_000
LIMITS = {"id": 128, "host": 256, "channel": 128, "user": 256,
          "sourceIp": 128, "process": 1024, "commandLine": 8192}
FIELDS = ("timestamp", "host", "channel", "eventId", "user", "sourceIp", "process", "commandLine")
SUPPORTED = {("Security", 4624), ("Security", 4625), ("Sysmon", 1), ("Sysmon", 3)}
TIMESTAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$")
# JSON.stringify-compatible trimming, not Python's broader Unicode strip().
TRIM = " \t\n\r\v\f\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"


class ImportError(ValueError):
    """Actionable error that never interpolates raw log fields."""


@dataclass(frozen=True)
class Dataset:
    events: list[dict]
    source_rows: list[tuple[str, int, str]]
    raw_count: int
    unsupported: int
    duplicates: int
    missing_identity: int
    missing_process: int
    sha256: str


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def stable_id(prefix: str, value: object) -> str:
    """Parity identifier; NOT cryptographic authentication or evidence integrity."""
    data = canonical_json(value).encode("utf-8")
    parts = []
    for seed in (2166136261, 2246822507):
        number = seed
        for byte in data:
            number = ((number ^ byte) * 16777619) & 0xFFFFFFFF
        parts.append(f"{number:08x}")
    return prefix + "-" + "".join(parts)


def event_tuple(event: dict) -> list:
    return [event[field] for field in FIELDS]


def normalize_timestamp(value: object, row: int) -> str:
    if not isinstance(value, str) or not TIMESTAMP.fullmatch(value):
        raise ImportError(f"Record {row}: timestamp must be ISO 8601 with an explicit timezone.")
    if not value.endswith("Z") and (int(value[-5:-3]) > 23 or int(value[-2:]) > 59):
        raise ImportError(f"Record {row}: timestamp contains an invalid timezone offset.")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        # Reject out-of-range offsets explicitly; datetime validates calendar fields.
        utc = parsed.astimezone(timezone.utc)
        return utc.isoformat(timespec="milliseconds").replace("+00:00", "Z")
    except (ValueError, OverflowError):
        raise ImportError(f"Record {row}: timestamp is not a valid calendar time.") from None


def text_field(record: dict, field: str, row: int, required: bool = False) -> str:
    value = record.get(field, "")
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise ImportError(f"Record {row}: {field} must be text.")
    value = value.strip(TRIM)
    try:
        length = len(value.encode("utf-8"))
    except UnicodeError:
        raise ImportError(f"Record {row}: {field} contains invalid Unicode.") from None
    if length > LIMITS[field] or (required and not value):
        raise ImportError(f"Record {row}: {field} is empty or exceeds its byte limit.")
    allowed_controls = "\t\n\r" if field == "commandLine" else ("" if field == "channel" else "\t")
    if any(unicodedata.category(char) == "Cc" and char not in allowed_controls for char in value):
        raise ImportError(f"Record {row}: {field} contains unsupported control characters.")
    return value


def _no_duplicate_keys(pairs: list[tuple[str, object]]) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise ImportError("JSON contains duplicate field names.")
        result[key] = value
    return result


def _validate_json_depth(text: str) -> None:
    depth = 0
    quoted = escaped = False
    for char in text:
        if quoted:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                quoted = False
        elif char == '"':
            quoted = True
        elif char in "[{":
            depth += 1
            if depth > 64:
                raise ImportError("JSON nesting exceeds the 64-level limit.")
        elif char in "]}":
            depth -= 1


def parse_logs(raw: bytes, format: str) -> Dataset:
    if len(raw) > MAX_BYTES:
        raise ImportError("Import exceeds the 5 MiB limit.")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeError:
        raise ImportError("Import must be UTF-8 text.") from None
    if not text.strip():
        raise ImportError("Import is empty.")
    try:
        if format == "json":
            _validate_json_depth(text)
            records = json.loads(text, object_pairs_hook=_no_duplicate_keys,
                                 parse_constant=lambda _: (_ for _ in ()).throw(ImportError("JSON contains a non-finite number.")))
            if not isinstance(records, list):
                raise ImportError("JSON must be an array of canonical event objects.")
        elif format in ("ndjson", "jsonl"):
            records = []
            for line in text.split("\n"):
                if line.strip():
                    _validate_json_depth(line)
                    records.append(json.loads(line, object_pairs_hook=_no_duplicate_keys,
                                              parse_constant=lambda _: (_ for _ in ()).throw(ImportError("JSON contains a non-finite number."))))
                if len(records) > MAX_RECORDS:
                    raise ImportError("Import exceeds the 10,000-record limit.")
        elif format == "csv":
            reader = csv.DictReader(io.StringIO(text, newline=""), strict=True)
            headers = reader.fieldnames or []
            if len(set(headers)) != len(headers) or not {"timestamp", "host", "channel", "eventId"}.issubset(headers):
                raise ImportError("CSV needs unique timestamp, host, channel and eventId headers.")
            records = []
            for record in reader:
                if None in record or any(value is None for value in record.values()):
                    raise ImportError("CSV has an inconsistent column count.")
                value = record["eventId"].strip()
                if not re.fullmatch(r"[0-9]{1,16}", value):
                    raise ImportError("CSV eventId must be a positive integer.")
                record["eventId"] = int(value)
                records.append(record)
                if len(records) > MAX_RECORDS:
                    raise ImportError("Import exceeds the 10,000-record limit.")
        else:
            raise ImportError("Supported formats are json, ndjson, jsonl and csv.")
    except ImportError:
        raise
    except (ValueError, csv.Error, RecursionError):
        raise ImportError("Import contains malformed JSON or CSV.") from None
    if len(records) > MAX_RECORDS:
        raise ImportError("Import exceeds the 10,000-record limit.")
    if not records:
        raise ImportError("Import contains no event records.")
    seen: dict[str, list] = {}
    events, source_rows = [], []
    unsupported = duplicates = missing = missing_process = 0
    for row, record in enumerate(records, 1):
        if not isinstance(record, dict):
            raise ImportError(f"Record {row}: expected an event object.")
        event = {"timestamp": normalize_timestamp(record.get("timestamp"), row)}
        for field in ("host", "channel", "user", "sourceIp", "process", "commandLine"):
            event[field] = text_field(record, field, row, required=field in ("host", "channel"))
            if field in ("user", "sourceIp", "process", "commandLine") and event[field] == "-":
                event[field] = ""
        # Supplied IDs are untrusted metadata, never normalization inputs.
        original_id = record.get("id", "")
        try:
            valid_id = isinstance(original_id, str) and len(original_id.encode("utf-8")) <= 128
        except UnicodeError:
            valid_id = False
        if not valid_id:
            original_id = ""
        event_id = record.get("eventId")
        if (type(event_id) not in (int, float) or not 0 < event_id <= 9007199254740991
                or not math.isfinite(event_id) or int(event_id) != event_id):
            raise ImportError(f"Record {row}: eventId must be a positive safe integer.")
        event_id = int(event_id)
        event["eventId"] = event_id
        if event["channel"] == "Microsoft-Windows-Sysmon/Operational":
            event["channel"] = "Sysmon"
        if (event["channel"], event_id) not in SUPPORTED:
            unsupported += 1
            continue
        identity = event_tuple(event)
        key = stable_id("evt", identity)
        if key in seen and seen[key] != identity:
            raise ImportError("Canonical identifier collision; import was rejected.")
        source_rows.append((key, row, original_id))
        if key in seen:
            duplicates += 1
            continue
        seen[key] = identity
        event["id"] = key
        events.append(event)
        if event["channel"] == "Security" and not (event["user"] and event["sourceIp"]):
            missing += 1
        if event["channel"] == "Sysmon" and event_id == 1 and not (event["process"] and event["commandLine"]):
            missing_process += 1
    events.sort(key=lambda event: (event["timestamp"], event["id"]))
    return Dataset(events, source_rows, len(records), unsupported, duplicates, missing, missing_process,
                   hashlib.sha256(raw).hexdigest())


def read_logs(path: Path, format: str | None = None) -> Dataset:
    with path.open("rb") as stream:
        raw = stream.read(MAX_BYTES + 1)
    return parse_logs(raw, format or path.suffix.lstrip(".").lower())
