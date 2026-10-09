# Isolated synthetic exporter tests. Get-WinEvent is replaced before script invocation.
# No real event channels, administrator privileges, Pester or packages are used.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$global:loglabMockMode = 'normal'
$global:loglabMockCalls = @()
$global:loglabMockRecords = @()

function New-SyntheticRecord([int]$Id, [string]$LogName, [long]$RecordId) {
    $sysmon = $LogName -eq 'Microsoft-Windows-Sysmon/Operational'
    $data = if ($sysmon) {
        '<Data Name="User">SYNTHETIC\synthetic-user</Data><Data Name="Image">C:\synthetic\pwsh.exe</Data><Data Name="CommandLine">pwsh -enc synthetic-value</Data><Data Name="SourceIp">192.0.2.100</Data>'
    } else {
        '<Data Name="TargetUserName">synthetic-user</Data><Data Name="TargetDomainName">SYNTHETIC</Data><Data Name="IpAddress">192.0.2.42</Data><Data Name="ProcessName">C:\synthetic\logon.exe</Data>'
    }
    $record = [pscustomobject]@{
        Id = $Id; LogName = $LogName; RecordId = $RecordId
        TimeCreated = ([DateTimeOffset]::Parse('2026-10-09T09:00:00Z')).UtcDateTime.AddSeconds($RecordId); MachineName = 'SYNTHETIC-LAB-01'
        Xml = '<Event xmlns="http://schemas.microsoft.com/win/2004/08/events/event"><EventData>' + $data + '</EventData></Event>'
    }
    $record | Add-Member -MemberType ScriptMethod -Name ToXml -Value { return $this.Xml }
    return $record
}

function global:Get-WinEvent {
    [CmdletBinding()]
    param([hashtable]$FilterHashtable, [long]$MaxEvents)
    $global:loglabMockCalls += $FilterHashtable.LogName
    if ($global:loglabMockMode -eq 'denied') { throw 'Synthetic access denial' }
    if ($global:loglabMockMode -eq 'empty') { return }
    @($global:loglabMockRecords | Where-Object {
        $_.LogName -eq $FilterHashtable.LogName -and $_.Id -in $FilterHashtable.Id
    } | Select-Object -First $MaxEvents)
}

if ((Get-Command Get-WinEvent).CommandType -ne 'Function') { throw 'Synthetic mock did not replace the cmdlet.' }
for ($index = 1; $index -le 5; $index++) { $global:loglabMockRecords += New-SyntheticRecord 4625 'Security' $index }
$global:loglabMockRecords += New-SyntheticRecord 4624 'Security' 6
$global:loglabMockRecords += New-SyntheticRecord 1 'Microsoft-Windows-Sysmon/Operational' 7
$global:loglabMockRecords += New-SyntheticRecord 3 'Microsoft-Windows-Sysmon/Operational' 8
$temp = Join-Path ([IO.Path]::GetTempPath()) ('cyber-loglab-exporter-synthetic-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp | Out-Null
$exporter = Join-Path $PSScriptRoot '..\..\scripts\export-windows-logs.ps1'
$parameters = @{ StartTime = '2026-10-09T09:00:00Z'; EndTime = '2026-10-09T10:00:00Z' }

function Assert([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "Synthetic exporter assertion failed: $Message" }
}
function Reject([scriptblock]$Action, [string]$Target) {
    $rejected = $false
    try { & $Action | Out-Null } catch { $rejected = $true }
    Assert $rejected 'expected rejection'
    Assert (-not (Test-Path -LiteralPath $Target)) 'failure created an output file'
}

$security = Join-Path $temp 'security.json'
& $exporter @parameters -OutputPath $security | Out-Null
$rows = Get-Content -Raw -LiteralPath $security | ConvertFrom-Json
Assert ($rows.Count -eq 6) 'Security-only count'
Assert ($global:loglabMockCalls -notcontains 'Microsoft-Windows-Sysmon/Operational') 'optional Sysmon was read without opt-in'
Assert ($rows[0].user -eq 'SYNTHETIC\synthetic-user') 'named domain/account extraction'
Assert ($rows[0].sourceIp -eq '192.0.2.42') 'Security IpAddress extraction'
Assert ($rows[0].timestamp -match 'Z$') 'explicit UTC timestamp'
Assert ($rows[0].timestamp -eq '2026-10-09T09:00:01.000Z') 'UTC calendar conversion'

$all = Join-Path $temp 'all.json'
& $exporter @parameters -OutputPath $all -IncludeSysmon | Out-Null
$rows = Get-Content -Raw -LiteralPath $all | ConvertFrom-Json
Assert ($rows.Count -eq 8) 'opt-in Sysmon count'
Assert (@($rows | Where-Object { $_.channel -eq 'Sysmon' -and $_.eventId -eq 3 }).Count -eq 1) 'network context retained'
Assert (($rows | Where-Object { $_.eventId -eq 3 }).sourceIp -eq '192.0.2.100') 'Sysmon SourceIp extraction'

$tooMany = Join-Path $temp 'too-many.json'
Reject { & $exporter @parameters -OutputPath $tooMany -MaxRecords 2 } $tooMany
$denied = Join-Path $temp 'denied.json'; $global:loglabMockMode = 'denied'
Reject { & $exporter @parameters -OutputPath $denied } $denied
$global:loglabMockMode = 'normal'
$wrongTime = Join-Path $temp 'wrong-time.json'
Reject { & $exporter -StartTime '2026-10-09T09:00:00' -EndTime '2026-10-09T10:00:00Z' -OutputPath $wrongTime } $wrongTime
$longTime = Join-Path $temp 'long-time.json'
Reject { & $exporter -StartTime '2026-10-01T09:00:00Z' -EndTime '2026-10-09T10:00:00Z' -OutputPath $longTime } $longTime
$old = [IO.File]::ReadAllBytes($security)
$overwritten = $false
try { & $exporter @parameters -OutputPath $security | Out-Null } catch { $overwritten = $true }
Assert $overwritten 'existing file not rejected'
Assert ([Convert]::ToBase64String($old) -eq [Convert]::ToBase64String([IO.File]::ReadAllBytes($security))) 'existing file changed'

$global:loglabMockRecords = @($global:loglabMockRecords | Select-Object -First 1)
$one = Join-Path $temp 'one.json'
& $exporter @parameters -OutputPath $one | Out-Null
Assert ([IO.File]::ReadAllText($one).Trim().StartsWith('[')) 'one record must remain an array'
Assert (@(Get-ChildItem -LiteralPath $temp -Filter '*.tmp').Count -eq 0) 'temporary export files remain'
$global:loglabMockRecords[0].Xml = $global:loglabMockRecords[0].Xml.Replace('Name="TargetUserName">synthetic-user', 'Name="TargetUserName">SYNTHETIC\synthetic-user')
$qualified = Join-Path $temp 'qualified.json'
& $exporter @parameters -OutputPath $qualified | Out-Null
$qualifiedRows = Get-Content -Raw -LiteralPath $qualified | ConvertFrom-Json
Assert ($qualifiedRows[0].user -eq 'SYNTHETIC\synthetic-user') 'already-qualified account was prefixed twice'

Write-Output 'PASS: synthetic exporter filters, named fields, UTC, Sysmon opt-in/context, count/date bounds, denial, exclusive output and array shape. No real Get-WinEvent cmdlet was called.'
