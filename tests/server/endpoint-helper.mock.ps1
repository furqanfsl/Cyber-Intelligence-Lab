# Synthetic harness: local telemetry cmdlets are replaced before the helper runs.
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$HelperPath, [string]$Scenario = 'events')
$ErrorActionPreference = 'Stop'
$global:EndpointMockScenario = $Scenario
function Get-MpComputerStatus {
    [CmdletBinding()]param()
    if ($global:EndpointMockScenario -eq 'unavailable') { throw 'synthetic-private-error-do-not-return' }
    return [pscustomobject]@{ AntivirusEnabled = $true; RealTimeProtectionEnabled = $true; AntivirusSignatureLastUpdated = [DateTime]::Parse('2026-10-09T10:00:00Z').ToUniversalTime() }
}
function Mock-Event([int]$Id, [string]$Data, [string]$Name = 'synthetic-host') {
    $event = [pscustomobject]@{
        Id = $Id; MachineName = $Name
        TimeCreated = [DateTime]::Parse('2026-10-09T11:59:00Z').ToUniversalTime()
        XmlValue = '<Event xmlns="http://schemas.microsoft.com/win/2004/08/events/event"><EventData>' + $Data + '</EventData></Event>'
    }
    $event | Add-Member -MemberType ScriptMethod -Name ToXml -Value { return $this.XmlValue }
    return $event
}
function Get-WinEvent {
    [CmdletBinding()]param([string]$ListLog, [hashtable]$FilterHashtable, [int]$MaxEvents)
    if ($global:EndpointMockScenario -eq 'unavailable') { throw 'synthetic-private-error-do-not-return' }
    if ($ListLog) { return [pscustomobject]@{ IsEnabled = $global:EndpointMockScenario -ne 'disabled' } }
    if ($global:EndpointMockScenario -eq 'empty') {
        $errorRecord = [Management.Automation.ErrorRecord]::new([Exception]::new('No synthetic matches'), 'NoMatchingEventsFound', [Management.Automation.ErrorCategory]::ObjectNotFound, $null)
        throw $errorRecord
    }
    if ($FilterHashtable.LogName -eq 'Microsoft-Windows-Windows Defender/Operational') {
        return @(
            (Mock-Event 1116 '<Data Name="Detection ID">{SYNTHETIC-1}</Data><Data Name="Threat ID">42</Data><Data Name="Threat Name">Test/Synthetic</Data><Data Name="Severity ID">4</Data><Data Name="Path">synthetic-private-path-do-not-return</Data><Data Name="User">synthetic-private-user-do-not-return</Data>'),
            (Mock-Event 1117 '<Data Name="Detection ID">{SYNTHETIC-1}</Data><Data Name="Threat ID">42</Data><Data Name="Threat Name">Test/Synthetic</Data><Data Name="Severity ID">4</Data><Data Name="Action ID">6</Data><Data Name="Error Code">0x00000000</Data>')
        )
    }
    if ($FilterHashtable.LogName -eq 'Security') {
        if ($global:EndpointMockScenario -eq 'truncated') { return @(1..$MaxEvents | ForEach-Object { Mock-Event 4625 '<Data Name="TargetUserName">synthetic-user</Data><Data Name="TargetDomainName">synthetic-domain</Data><Data Name="IpAddress">192.0.2.1</Data>' }) }
        if ($global:EndpointMockScenario -eq 'bad-fields') { return @(Mock-Event 4625 '' '') }
        return @(Mock-Event 4625 '<Data Name="TargetUserName">synthetic-user</Data><Data Name="TargetDomainName">synthetic-domain</Data><Data Name="IpAddress">192.0.2.1</Data><Data Name="ProcessName">C:\synthetic\sample.exe</Data>')
    }
    if ($FilterHashtable.LogName -eq 'Microsoft-Windows-Sysmon/Operational') {
        return @(Mock-Event 1 '<Data Name="User">synthetic-domain\synthetic-user</Data><Data Name="Image">C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe</Data><Data Name="CommandLine">powershell.exe -enc ZQBjAGgAbwA=</Data>')
    }
    throw 'Unexpected synthetic channel request.'
}
& $HelperPath -StartTime '2026-10-09T11:45:00.000Z' -EndTime '2026-10-09T12:00:00.000Z' -IncludeSysmon
