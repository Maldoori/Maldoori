<# Read-only checks. Does not install software, change protection, or collect enrollment tokens. #>
[CmdletBinding()]
param(
    [string]$MeshUrl = 'https://mesh.skybaseitsolutions.com',
    [string]$InstallerPath
)
$ErrorActionPreference = 'Stop'
$endpoint = [uri]$MeshUrl
if (-not $endpoint.IsAbsoluteUri -or $endpoint.Scheme -ne 'https' -or $endpoint.UserInfo -or $endpoint.Query -or $endpoint.Fragment) {
    throw 'Use an HTTPS MeshCentral base URL without credentials, query parameters, or invitation tokens.'
}
$report = [ordered]@{ CapturedAt = (Get-Date).ToUniversalTime().ToString('o'); MeshHost = $endpoint.DnsSafeHost; MeshPort = $endpoint.Port }
try {
    $report.DnsAddresses = @(Resolve-DnsName -Name $endpoint.DnsSafeHost -ErrorAction Stop | Where-Object { $_.Type -in @('A','AAAA') } | Select-Object -ExpandProperty IPAddress)
} catch { $report.DnsError = 'DNS lookup failed. Check domain renewal, DNS records, and local filtering.' }
try {
    $report.TcpReachable = [bool](Test-NetConnection -ComputerName $endpoint.DnsSafeHost -Port $endpoint.Port -InformationLevel Quiet -WarningAction SilentlyContinue)
} catch { $report.TcpReachable = $false }
# Default .NET certificate checks remain enabled. Do not bypass TLS verification.
try {
    Add-Type -AssemblyName System.Net.Http
    $handler = New-Object System.Net.Http.HttpClientHandler
    $handler.AllowAutoRedirect = $false
    $client = New-Object System.Net.Http.HttpClient($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(15)
    try {
        $response = $client.GetAsync($endpoint, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
        try { $report.HttpsStatus = [int]$response.StatusCode; $report.TlsValidated = $true }
        finally { $response.Dispose() }
    } finally { $client.Dispose(); $handler.Dispose() }
} catch { $report.HttpsError = 'HTTPS failed. Check certificate trust, expiry, DNS, proxy settings, and connectivity.' }
try {
    $report.AgentServices = @(Get-Service | Where-Object { $_.Name -match 'meshagent|meshcentral' -or $_.DisplayName -match 'meshagent|meshcentral' } | ForEach-Object { @{ Name=$_.Name; Status=[string]$_.Status } })
} catch { $report.AgentServiceError = 'Unable to inspect services with current permissions.' }
if ($InstallerPath) {
    if (-not (Test-Path -LiteralPath $InstallerPath -PathType Leaf)) {
        $report.InstallerError = 'File not found. Verify its location and check security quarantine. Absence does not prove quarantine.'
    } else {
        $report.InstallerSha256 = (Get-FileHash -LiteralPath $InstallerPath -Algorithm SHA256).Hash
        $signature = Get-AuthenticodeSignature -LiteralPath $InstallerPath
        $report.SignatureStatus = [string]$signature.Status
        if ($signature.SignerCertificate) { $report.Signer = $signature.SignerCertificate.Subject }
    }
}
$report.Scope = 'TCP and HTTPS checks do not verify agent authentication, WebSocket traffic, or Acronis approval. Renamed agent services may not be found.'
$report | ConvertTo-Json -Depth 4
