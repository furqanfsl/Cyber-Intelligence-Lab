"""Three candidate indicators, not confirmed incidents or attacker attribution."""
from __future__ import annotations

import re
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from .core import MAX_RECORDS, ImportError, TRIM, stable_id

RULES = {
    "R001": ("Repeated failed logons", "medium"),
    "R002": ("Successful logon after repeated failures", "high"),
    "R003": ("Encoded PowerShell command", "medium"),
}
WINDOW = 300_000
FOLLOWUP = 600_000


def encoded_argument(command_line: str) -> bool:
    tokens = []
    token = quote = ""
    index = 0
    while index < len(command_line):
        char = command_line[index]
        if quote:
            if char == "\\" and index + 1 < len(command_line) and command_line[index + 1] == quote:
                token += quote
                index += 1
            elif char == quote:
                quote = ""
            else:
                token += char
        elif char in "\"'":
            quote = char
        elif char in TRIM:
            if token:
                tokens.append(token)
            token = ""
        else:
            token += char
        index += 1
    if quote:
        return False
    if token:
        tokens.append(token)
    for argument in tokens:
        if argument.lower() in ("-enc", "-encodedcommand"):
            return True
        if argument.lower() in ("-command", "-c", "-file", "-f"):
            return False
    return False


def _time(event: dict) -> int:
    value = datetime.fromisoformat(event["timestamp"].replace("Z", "+00:00"))
    return (value - datetime(1970, 1, 1, tzinfo=timezone.utc)) // timedelta(milliseconds=1)


def analyze_events(events: list[dict]) -> list[dict]:
    if len(events) > MAX_RECORDS:
        raise ImportError("Analysis exceeds the 10,000-event limit.")
    groups = defaultdict(list)
    alerts = []

    def add(rule: str, evidence: list[dict]) -> None:
        ids = [event["id"] for event in evidence]
        title, severity = RULES[rule]
        alerts.append({"id": stable_id("alert", [rule, *ids]), "ruleId": rule,
                       "title": title, "severity": severity,
                       "timestamp": evidence[-1]["timestamp"], "evidenceIds": ids,
                       "firstSeen": evidence[0]["timestamp"], "lastSeen": evidence[-1]["timestamp"]})

    for event in sorted(events, key=lambda event: (event["timestamp"], event["id"])):
        if event["channel"] == "Security" and event["user"] and event["sourceIp"]:
            groups[(event["host"], event["user"], event["sourceIp"])].append(event)
        if event["channel"] == "Sysmon" and event["eventId"] == 1:
            process = re.split(r"[/\\]", event["process"])[-1].lower()
            if process in ("powershell", "powershell.exe", "pwsh", "pwsh.exe") and encoded_argument(event["commandLine"]):
                add("R003", [event])
    for group in groups.values():
        failures = [event for event in group if event["eventId"] == 4625]
        successes = [event for event in group if event["eventId"] == 4624]
        burst_alerted = False
        for index, event in enumerate(failures):
            current = _time(event)
            if index == 0 or current - _time(failures[index - 1]) > WINDOW:
                burst_alerted = False
            if not burst_alerted and index >= 4 and current - _time(failures[index - 4]) <= WINDOW:
                add("R001", failures[index - 4:index + 1])
                burst_alerted = True
        cursor, qualifying_end = 0, -1
        for success in successes:
            current = _time(success)
            while cursor < len(failures) and _time(failures[cursor]) < current:
                if cursor >= 4 and _time(failures[cursor]) - _time(failures[cursor - 4]) <= WINDOW:
                    qualifying_end = cursor
                cursor += 1
            if qualifying_end >= 4 and current - _time(failures[qualifying_end]) <= FOLLOWUP:
                add("R002", [*failures[qualifying_end - 4:qualifying_end + 1], success])
    alerts.sort(key=lambda alert: (alert["firstSeen"], alert["ruleId"], alert["id"]))
    return alerts
