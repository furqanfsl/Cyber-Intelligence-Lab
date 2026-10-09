-- Read-only local investigation queries. Outputs may contain sensitive identities.
-- Run only against a private Log Lab database; do not publish query results.

-- Dataset range and coverage. Count records, not attacks or people.
SELECT channel, eventId, COUNT(*) AS records,
       MIN(timestamp) AS earliest_utc, MAX(timestamp) AS latest_utc
FROM events GROUP BY channel,eventId ORDER BY channel,eventId;

-- Authentication outcomes for each exact recorded identity.
-- Missing identity does not qualify for correlation.
SELECT host,user,sourceIp,
       SUM(CASE WHEN eventId=4625 THEN 1 ELSE 0 END) AS failed_logons,
       SUM(CASE WHEN eventId=4624 THEN 1 ELSE 0 END) AS successful_logons
FROM events WHERE channel='Security' AND user<>'' AND sourceIp<>''
GROUP BY host,user,sourceIp ORDER BY failed_logons DESC;

-- Evidence timeline for all candidates. Labels are rule matches, not findings.
SELECT a.ruleId,a.severity,a.timestamp AS triggered_utc,
       e.timestamp AS evidence_utc,e.channel,e.eventId,e.host,e.user,e.sourceIp
FROM alerts a JOIN alert_evidence ae ON ae.alertId=a.id
JOIN events e ON e.id=ae.eventId
ORDER BY a.timestamp,a.id,ae.ordinal;

-- Import provenance: duplicate/unsupported records are explicitly accounted for.
SELECT importedAt,rawCount,insertedCount,duplicateCount,unsupportedCount,
       missingIdentityCount,missingProcessCount FROM imports ORDER BY importedAt;

-- Exploratory five-minute failure density. julianday's floating precision is for
-- exploration only; the tested Python engine uses exact integer milliseconds.
SELECT e.id,e.timestamp,e.host,e.user,e.sourceIp,
       (SELECT COUNT(*) FROM events prior
        WHERE prior.channel='Security' AND prior.eventId=4625
          AND prior.host=e.host AND prior.user=e.user AND prior.sourceIp=e.sourceIp
          AND prior.timestamp<=e.timestamp
          AND julianday(prior.timestamp)>=julianday(e.timestamp)-(5.0/1440)) AS failures_in_5m
FROM events e WHERE e.channel='Security' AND e.eventId=4625
  AND e.user<>'' AND e.sourceIp<>'' ORDER BY e.timestamp,e.id;
