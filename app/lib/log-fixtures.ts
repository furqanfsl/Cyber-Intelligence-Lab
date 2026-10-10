import type { LogEvent } from './log-analysis'

/** Deliberately synthetic teaching data, not records from any real account or host. */
type FixtureEvent = Omit<LogEvent, 'id'>
const syntheticHost = 'SYNTHETIC-LAB-01'
const syntheticUser = 'synthetic-user'

function authentication(timestamp: string, eventId: 4624 | 4625, sourceIp = '192.0.2.42'): FixtureEvent {
  return { timestamp, host: syntheticHost, channel: 'Security', eventId, user: syntheticUser, sourceIp, process: '', commandLine: '' }
}

export const suspiciousFixture: FixtureEvent[] = [
  authentication('2026-10-09T09:00:00.000Z', 4625),
  authentication('2026-10-09T09:00:30.000Z', 4625),
  authentication('2026-10-09T09:01:00.000Z', 4625),
  authentication('2026-10-09T09:01:30.000Z', 4625),
  authentication('2026-10-09T09:02:00.000Z', 4625),
  authentication('2026-10-09T09:02:30.000Z', 4625),
  authentication('2026-10-09T09:04:00.000Z', 4624),
  {
    timestamp: '2026-10-09T09:05:00.000Z', host: syntheticHost, channel: 'Sysmon', eventId: 1,
    user: syntheticUser, sourceIp: '', process: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    commandLine: 'powershell.exe -NoProfile -EncodedCommand UwBZAE4AVABIAEUAVABJAEMALQBEAEUATQBPAE8A',
  },
  authentication('2026-10-09T09:06:00.000Z', 4624, '198.51.100.18'),
  {
    timestamp: '2026-10-09T09:07:00.000Z', host: syntheticHost, channel: 'Sysmon', eventId: 1,
    user: syntheticUser, sourceIp: '', process: 'C:\\Windows\\System32\\notepad.exe', commandLine: 'notepad.exe synthetic-notes.txt',
  },
]

export const benignFixture: FixtureEvent[] = [
  authentication('2026-10-09T10:00:00.000Z', 4625),
  authentication('2026-10-09T10:00:30.000Z', 4625),
  authentication('2026-10-09T10:01:00.000Z', 4624),
  authentication('2026-10-09T10:03:00.000Z', 4624, '198.51.100.18'),
  {
    timestamp: '2026-10-09T10:04:00.000Z', host: syntheticHost, channel: 'Sysmon', eventId: 1,
    user: syntheticUser, sourceIp: '', process: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', commandLine: 'pwsh.exe -NoProfile -File synthetic-maintenance.ps1',
  },
]
