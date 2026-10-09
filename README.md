# Maldoori RMM

A responsive IT operations dashboard with device inventory and CPU, RAM, and disk metrics, company filters, remote desktop workflows, backup and antivirus actions, and company ticket management.

## Run

Requires Node.js 20 or newer. No package installation is needed.

```sh
cd /workspace/Maldoori
npm run dev
```

The server listens on port 3000 (override with `PORT`). Run `npm run check` for JavaScript syntax checks.

## Current scope

This is an interactive prototype. Six sample endpoints across three companies are included. Tickets can be created, assigned, prioritized, edited, and resolved. Demo state persists in this browser's local storage; JSON reports can be exported.

Monitoring values are sample snapshots. Remote desktop, backups, antivirus installation, and scanning are explicitly simulated. The application does not connect to endpoints, stream desktops, create real backups, install software, or authenticate users. Do not use it to store sensitive support data.

Production integration requires a backend with tenant isolation and role-based authorization; authenticated endpoint enrollment and telemetry; consent-controlled remote sessions; encrypted backup storage with retention and restoration; licensed antivirus deployment; and auditable operator actions. Browser-local data must be replaced with a company-scoped database.

The UI uses optional Google Fonts and falls back to system fonts when offline.

## Live MeshCentral integration

The live integration is a separate application; the original demo remains available with `npm run dev`. It requires Node.js 24, `npm ci`, and a trusted HTTPS MeshCentral endpoint. Its management protocol follows MeshCentral 1.1.59's `meshctrl.js`. Certificate verification remains enabled.

Copy `.env.example` to `.env`, set its permissions to `600`, and fill the credentials locally on the deployment server. `RMM_PASSWORD` must be a unique password with at least 16 characters. For MeshCentral, use a dedicated integration account with access only to the intended groups; a MeshCentral login-token username/password is preferred to a personal administrator password. The account needs permission to list devices, create groups (if desired), and generate enrollment invitations. Do not disable two-factor authentication on your personal account to make the integration work. Never put credentials in browser code, commits, chat, or installation bundles.

For Droplet deployment, credentials can instead live in `/etc/maldoori/credentials.json` with owner-only permissions (`600`) under a protected directory (`700`). Set `CREDENTIALS_FILE` to that path. The JSON keys are `PUBLIC_URL`, `MESH_URL`, `MESH_USERNAME`, `MESH_PASSWORD`, `RMM_USERNAME`, and `RMM_PASSWORD`; explicit environment variables override these values. The server rejects a group- or world-accessible credentials file. Enter credentials locally via hidden terminal prompts. Login tokens expire; replace the protected file values and restart only Maldoori before expiry. Never commit this file or copy it into deployment archives.

Run `npm run live` to start the backend on loopback port 3001. For this Droplet, MeshCentral already owns port 443, so the initial HTTPS reverse proxy for Maldoori should listen on 8443 at `https://rmm.skybaseitsolutions.com:8443`. `PUBLIC_URL` must match that browser origin exactly, including the port; update the protected credentials file accordingly before starting. Keep MeshCentral serving `mesh.skybaseitsolutions.com` on its existing port; do not replace its PM2 process or TLS files. Proxy only the RMM hostname to `127.0.0.1:3001`. Proxy requests retain their browser Origin header. Allow public TCP 8443 for the HTTPS frontend; port 3001 should not be exposed publicly. Configure PM2/systemd startup for this separate service and back up the `data` directory securely. Node.js 24 installed separately at `/opt/maldoori-node24/bin/node` must be the explicit interpreter for the Maldoori process, preserving MeshCentral's existing Node.js 20 installation.

This release supports a single trusted operator login, server-side credentials, HTTP-only sessions, mutation origin checks, login throttling, an SQLite company/group map and audit log, periodic inventory synchronization, existing-group linking, company group creation, 24-hour agent enrollment invitations, and dynamically generated device desktop links. The operator can see every group accessible to the integration account. It does not offer customer logins or a tenant-isolated multi-user portal.

After login, link each existing device group to a company before creating duplicate groups. For a new company, create a new agent group, generate an enrollment invitation, and privately send that link to an authorized customer. Installing the group-specific Windows agent enrolls the computer in MeshCentral. Successful synchronization reflects new, removed, and offline devices every 30 seconds. Enrollment invitations enable ongoing management; obtain authorization before agent installation. Desktop opens MeshCentral's authenticated interface for the actual node ID, without passing login credentials or issuing unattended-control bypasses.

The live dashboard has no sample devices or invented resource metrics. A failed synchronization explicitly labels cached data and disables remote actions until a successful synchronization. MeshCentral enrollment, permissions, and TLS must be tested on the real deployment; local tests use a private HTTPS MeshCentral fixture and do not establish connectivity to the user's server. Real CPU/RAM collection, backup jobs, antivirus deployment, and a backend ticket system are future integrations.

Validation: `npm run check`, `npm test`, and `npm audit --omit=dev`. The integration test requires OpenSSL, creates an isolated test certificate, explicitly trusts that test CA in its child process, and exercises authentication, origin checks, group mapping, enrollment, device synchronization, remote links, outages, logout, and SQLite persistence.
