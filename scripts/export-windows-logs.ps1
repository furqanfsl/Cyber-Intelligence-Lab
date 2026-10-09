# This script is opt-in. It is not invoked by the application or test suite.
# Export only records you are authorized to access. Output contains private data.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$OutputPath,
    [Parameter(Mandatory = $true)][string]$StartTime,
    [Parameter(Mandatory = $true)][string]$EndTime,
    [ValidateRange(1, 10000)][int]$MaxRecords = 10000,
    [switch]$IncludeSysmon
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Convert-ExplicitTime([string]$Value) {
    if ($Value -notmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?(Z|[+-]\d{2}:\d{2})$') {
        throw 'StartTime and EndTime require ISO 8601 values with an explicit timezone.'
    }
    return [DateTimeOffset]::Parse($Value, [Globalization.CultureInfo]::InvariantCulture)
}

$from = Convert-ExplicitTime $StartTime
$until = Convert-ExplicitTime $EndTime
if ($until -le $from -or ($until - $from).TotalDays -gt 7) {
    throw 'Choose an increasing time range of at most seven days.'
}
if (-not [IO.Path]::IsPathRooted($OutputPath)) {
    throw 'OutputPath must be an explicit absolute local file path.'
}
$target = [IO.Path]::GetFullPath($OutputPath)
if ($target.StartsWith('\\') -or $target -notmatch '^[A-Za-z]:\\') {
    throw 'Use a local drive path, not a network share.'
}
if ([IO.DriveInfo]::new([IO.Path]::GetPathRoot($target)).DriveType -eq [IO.DriveType]::Network) {
    throw 'Mapped network drives are not allowed for this local-only export.'
}
if ([IO.Path]::GetExtension($target) -ne '.json' -or (Test-Path -LiteralPath $target)) {
    throw 'Use a new .json output filename; existing files are never overwritten.'
}
if (-not (Test-Path -LiteralPath ([IO.Path]::GetDirectoryName($target)) -PathType Container)) {
    throw 'Create the intended private output directory before running this script.'
}

function Read-AuthorizedEvents([string]$LogName, [int[]]$Ids) {
    try {
        return @(Get-WinEvent -FilterHashtable @{
            LogName = $LogName; Id = $Ids
            StartTime = $from.LocalDateTime; EndTime = $until.LocalDateTime
        } -MaxEvents ($MaxRecords + 1) -ErrorAction Stop)
    } catch {
        if ($_.FullyQualifiedErrorId -like 'NoMatchingEventsFound*') { return @() }
        throw 'A requested local event channel is unavailable or access was denied. No export was written. Check authorization and channel availability; this script does not elevate or install anything.'
    }
}

$records = @(Read-AuthorizedEvents 'Security' @(4624, 4625))
if ($IncludeSysmon) {
    $records += @(Read-AuthorizedEvents 'Microsoft-Windows-Sysmon/Operational' @(1, 3))
}
if ($records.Count -gt $MaxRecords) {
    throw 'More records match than MaxRecords allows. Narrow the time range; no partial export was written.'
}

$normalized = @($records | Sort-Object TimeCreated, RecordId | ForEach-Object {
    # Named EventData avoids version-dependent positional field indexes.
    [xml]$xml = $_.ToXml()
    $data = @{}
    foreach ($entry in $xml.Event.EventData.Data) {
        $data[[string]$entry.Name] = [string]$entry.InnerText
    }
    $isSysmon = $_.LogName -eq 'Microsoft-Windows-Sysmon/Operational'
    $user = if ($isSysmon) { [string]$data['User'] } else { [string]$data['TargetUserName'] }
    if (-not $isSysmon -and $user -and $user -ne '-' -and $user -notmatch '\\' -and $data['TargetDomainName'] -and $data['TargetDomainName'] -ne '-') {
        $user = [string]$data['TargetDomainName'] + '\' + $user
    }
    $ip = if ($isSysmon) { [string]$data['SourceIp'] } else { [string]$data['IpAddress'] }
    $process = if ($isSysmon) { [string]$data['Image'] } else { [string]$data['ProcessName'] }
    $command = if ($isSysmon) { [string]$data['CommandLine'] } else { '' }
    if ($user -eq '-') { $user = '' }
    if ($ip -eq '-') { $ip = '' }
    [ordered]@{
        id = [string]$_.RecordId
        timestamp = $_.TimeCreated.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fff'Z'", [Globalization.CultureInfo]::InvariantCulture)
        host = [string]$_.MachineName
        channel = $(if ($isSysmon) { 'Sysmon' } else { 'Security' })
        eventId = [int]$_.Id
        user = $user; sourceIp = $ip; process = $process; commandLine = $command
    }
})
# -InputObject preserves JSON array shape even for zero or one record.
$json = ConvertTo-Json -InputObject @($normalized) -Depth 4
$bytes = [Text.UTF8Encoding]::new($false).GetBytes($json)
if ($bytes.Length -gt 5MB) { throw 'Export exceeds 5 MiB. Narrow the time range; no file was written.' }
$temporary = $target + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
try {
    $stream = [IO.File]::Open($temporary, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
    # Same-directory rename publishes the complete file without replacing an existing target.
    [IO.File]::Move($temporary, $target)
} finally {
    if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }
}
Write-Output "Exported $($normalized.Count) authorized local records. The output is sensitive; do not upload or commit it."
