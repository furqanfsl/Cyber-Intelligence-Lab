# Read-only local telemetry helper. Invoked only by an explicitly started local monitor.
# Never installs/elevates/enables a channel, scans, remediates, writes files or sends data.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$StartTime,
    [Parameter(Mandatory = $true)][string]$EndTime,
    [switch]$IncludeSysmon
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$WarningPreference = 'SilentlyContinue'
$InformationPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest
$utf8 = [Text.UTF8Encoding]::new($false, $true)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8

function Convert-ExplicitTime([string]$Value) {
    if ($Value -notmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$') { throw 'Invalid local monitoring time range.' }
    $result = [DateTimeOffset]::ParseExact($Value, "yyyy-MM-ddTHH:mm:ss.fff'Z'", [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AssumeUniversal)
    return $result
}
$from = Convert-ExplicitTime $StartTime
$until = Convert-ExplicitTime $EndTime
if ($until -le $from -or ($until - $from).TotalMinutes -gt 15) { throw 'Invalid local monitoring time range.' }

function Utc-Time([DateTime]$Value) {
    return $Value.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fff'Z'", [Globalization.CultureInfo]::InvariantCulture)
}
function Safe-Text([object]$Value, [int]$Maximum, [switch]$Command) {
    $text = ([string]$Value).Trim()
    if ($text -eq '-') { $text = '' }
    if ($utf8.GetByteCount($text) -gt $Maximum) { throw 'A field exceeds the local telemetry limit.' }
    $test = if ($Command) { $text -replace '[\t\r\n]', '' } else { $text }
    if ($test -match '\p{Cc}') { throw 'A field contains unsupported characters.' }
    return $text
}
function Event-Fields([object]$Event) {
    $settings = [Xml.XmlReaderSettings]::new()
    $settings.DtdProcessing = [Xml.DtdProcessing]::Prohibit
    $settings.XmlResolver = $null
    $settings.MaxCharactersInDocument = 65536
    $stringReader = [IO.StringReader]::new([string]$Event.ToXml())
    $reader = [Xml.XmlReader]::Create($stringReader, $settings)
    try {
        $document = [Xml.XmlDocument]::new()
        $document.XmlResolver = $null
        $document.Load($reader)
        $fields = @{}
        foreach ($entry in $document.SelectNodes("/*[local-name()='Event']/*[local-name()='EventData']/*[local-name()='Data']")) {
            $name = $entry.GetAttribute('Name')
            if (-not $name -or $fields.ContainsKey($name)) { throw 'Invalid local event fields.' }
            $fields[$name] = [string]$entry.InnerText
        }
        return $fields
    } finally { $reader.Dispose(); $stringReader.Dispose() }
}
function Read-Channel([string]$Source, [string]$Name, [string]$ProviderName, [int[]]$Ids, [int]$Limit) {
    $status = [ordered]@{ source = $Source; state = 'unavailable'; eventCount = 0; truncated = $false; skippedCount = 0 }
    try {
        # A no-match query is healthy only after this existing channel metadata probe.
        $channel = Get-WinEvent -ListLog $Name -ErrorAction Stop
        if (-not $channel.IsEnabled) { return @{ coverage = $status; records = @() } }
        try {
            $records = @(Get-WinEvent -FilterHashtable @{
                LogName = $Name; ProviderName = $ProviderName; Id = $Ids
                StartTime = $from.LocalDateTime; EndTime = $until.LocalDateTime
            } -MaxEvents ($Limit + 1) -ErrorAction Stop)
        } catch {
            if ($_.FullyQualifiedErrorId -like 'NoMatchingEventsFound*') { $records = @() }
            else { throw }
        }
        $status.state = 'available'
        $status.truncated = $records.Count -gt $Limit
        return @{ coverage = $status; records = @($records | Select-Object -First $Limit) }
    } catch {
        # Deliberately do not emit exceptions: they can contain machine names or private paths.
        return @{ coverage = $status; records = @() }
    }
}

$defenderStatus = [ordered]@{ state = 'unavailable'; antivirusEnabled = $null; realTimeProtectionEnabled = $null; signaturesUpdatedAt = $null }
try {
    $computer = Get-MpComputerStatus -ErrorAction Stop
    $defenderStatus.state = 'available'
    $defenderStatus.antivirusEnabled = if ($computer.AntivirusEnabled -is [bool]) { $computer.AntivirusEnabled } else { $null }
    $defenderStatus.realTimeProtectionEnabled = if ($computer.RealTimeProtectionEnabled -is [bool]) { $computer.RealTimeProtectionEnabled } else { $null }
    if ($computer.AntivirusSignatureLastUpdated -is [DateTime] -and $computer.AntivirusSignatureLastUpdated.Year -gt 1) {
        $defenderStatus.signaturesUpdatedAt = Utc-Time $computer.AntivirusSignatureLastUpdated
    }
} catch {
    $defenderStatus = [ordered]@{ state = 'unavailable'; antivirusEnabled = $null; realTimeProtectionEnabled = $null; signaturesUpdatedAt = $null }
}

$defender = Read-Channel 'defender' 'Microsoft-Windows-Windows Defender/Operational' 'Microsoft-Windows-Windows Defender' @(1116, 1117, 1118, 1119) 200
$security = Read-Channel 'security' 'Security' 'Microsoft-Windows-Security-Auditing' @(4624, 4625) 250
$sysmon = if ($IncludeSysmon) {
    Read-Channel 'sysmon' 'Microsoft-Windows-Sysmon/Operational' 'Microsoft-Windows-Sysmon' @(1) 250
} else {
    @{ coverage = [ordered]@{ source = 'sysmon'; state = 'not-requested'; eventCount = 0; truncated = $false; skippedCount = 0 }; records = @() }
}
$defenderEvents = [Collections.Generic.List[object]]::new()
foreach ($event in $defender.records) {
    try {
        $data = Event-Fields $event
        if ($event.Id -notin @(1116, 1117, 1118, 1119)) { throw 'Unexpected local event.' }
        $severity = switch ([string]$data['Severity ID']) { '1' { 'low' }; '2' { 'moderate' }; '4' { 'high' }; '5' { 'severe' }; default { 'unknown' } }
        $actionId = $null
        if ($data.ContainsKey('Action ID') -and [string]$data['Action ID'] -match '^\d{1,10}$') {
            $candidate = [long]$data['Action ID']
            if ($candidate -le [int]::MaxValue) { $actionId = [int]$candidate }
        }
        $errorCode = Safe-Text $data['Error Code'] 32
        if ($errorCode -and $errorCode -notmatch '^(0x[0-9a-fA-F]{1,8}|\d{1,10})$') { throw 'Invalid local event error code.' }
        $defenderEvents.Add([ordered]@{
            timestamp = Utc-Time $event.TimeCreated
            eventId = [int]$event.Id
            detectionId = Safe-Text $data['Detection ID'] 128
            threatId = Safe-Text $data['Threat ID'] 64
            threatName = Safe-Text $data['Threat Name'] 512
            severity = $severity; actionId = $actionId; errorCode = $errorCode
        })
    } catch { $defender.coverage.skippedCount += 1 }
}
$defender.coverage.eventCount = $defenderEvents.Count

$events = [Collections.Generic.List[object]]::new()
foreach ($channel in @($security, $sysmon)) {
    foreach ($event in $channel.records) {
        try {
            $data = Event-Fields $event
            $isSysmon = $channel.coverage.source -eq 'sysmon'
            if (($isSysmon -and $event.Id -ne 1) -or (-not $isSysmon -and $event.Id -notin @(4624, 4625))) { throw 'Unexpected local event.' }
            $user = if ($isSysmon) { [string]$data['User'] } else { [string]$data['TargetUserName'] }
            if (-not $isSysmon -and $user -and $user -ne '-' -and $user -notmatch '\\' -and $data['TargetDomainName'] -and $data['TargetDomainName'] -ne '-') {
                $user = [string]$data['TargetDomainName'] + '\' + $user
            }
            $hostName = Safe-Text $event.MachineName 256
            if (-not $hostName) { throw 'Missing local event host.' }
            $events.Add([ordered]@{
                timestamp = Utc-Time $event.TimeCreated
                host = $hostName
                channel = $(if ($isSysmon) { 'Sysmon' } else { 'Security' })
                eventId = [int]$event.Id
                user = Safe-Text $user 256
                sourceIp = $(if ($isSysmon) { '' } else { Safe-Text $data['IpAddress'] 128 })
                process = $(if ($isSysmon) { Safe-Text $data['Image'] 1024 } else { Safe-Text $data['ProcessName'] 1024 })
                commandLine = $(if ($isSysmon) { Safe-Text $data['CommandLine'] 8192 -Command } else { '' })
            })
            $channel.coverage.eventCount += 1
        } catch { $channel.coverage.skippedCount += 1 }
    }
}
$result = [ordered]@{
    collectedAt = Utc-Time ([DateTime]::UtcNow)
    defender = $defenderStatus
    coverage = @($defender.coverage, $security.coverage, $sysmon.coverage)
    defenderEvents = @($defenderEvents.ToArray())
    events = @($events.ToArray())
}
$json = ConvertTo-Json -InputObject $result -Depth 6 -Compress
if ($utf8.GetByteCount($json) -gt 5MB) { throw 'Local telemetry exceeded its bounded response size.' }
[Console]::Write($json)
