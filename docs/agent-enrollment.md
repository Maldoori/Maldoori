# Windows agent installation and connectivity

Use the RMM Add device flow to select the correct company, location, and device group. Open the generated invitation on the authorized endpoint; links expire after 24 hours. Download the matching installer and explain ongoing remote management before installing with administrator approval. Keep invitation links private: they contain enrollment tokens.

## Diagnose before changing protection

Download `scripts/agent-diagnostics.ps1` from this branch. Review the script and run it on the affected Windows computer in PowerShell:

```powershell
.\agent-diagnostics.ps1 -InstallerPath "$env:USERPROFILE\Downloads\meshagent64-SkyBase.exe"
```

If organizational execution policy prevents running it, ask the administrator to approve the script. Do not disable protection or bypass policy. The script prints JSON to the console, reads service status and the installer hash/signature, and makes DNS, TCP and certificate-validated HTTPS checks. It does not execute the installer, alter services, or change firewall/security settings. Inspect the output before sharing it privately with support.

- DNS failure/unexpected addresses: check domain renewal, nameservers and A/AAAA records against DigitalOcean. Do not assume an old IP is still correct.
- TCP failure: inspect authorized outbound access to the configured MeshCentral host and port, server listeners and firewall rules.
- HTTPS failure: inspect certificate trust/expiry and proxy or filtering behavior. Do not disable certificate validation.
- HTTP response: confirms an HTTPS endpoint answered, not that it is the correct MeshCentral service or that an agent can authenticate. Redirects are not followed. Agent WebSocket traffic still needs testing.
- Service absent: installation may be incomplete, the service may be renamed, or protection may have quarantined it. A stopped/running service alone does not establish connectivity.
- Installer absent: check its path and Acronis quarantine; do not infer a false positive from a missing file.
- Signature not Valid: inspect publisher and source. A valid signature is publisher evidence, not proof of safety or universal antivirus trust.

## Acronis case

Supply the exact detection name/action, affected product version, detection time and timezone, final downloaded file SHA-256 and signature status. Ask the existing technician for a secure sample-upload route and a false-positive determination. The diagnostic report is not a replacement for Acronis's system-information report. Never publish client reports or agent samples in a public GitHub issue. If approved, use a narrowly scoped vendor-supported exception; do not disable protection or exclude whole folders.

## Acceptance check on one authorized Windows endpoint

1. Record the installer hash/signature and verify its source before installation.
2. Confirm Acronis permits installation without unexpected quarantine alerts.
3. Confirm the agent service is running and the device appears in the intended company/location/group after synchronization.
4. Verify telemetry and an authorized remote session; test required user-consent prompts.
5. Reboot with the user's agreement and confirm automatic reconnection.
6. Confirm uninstall/reinstall behaves as expected on this test endpoint before client rollout.

These checks require an actual Windows endpoint and the live MeshCentral server. Repository changes alone cannot resolve or verify the Acronis detection.
