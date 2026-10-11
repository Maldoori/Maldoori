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

This release supports a single trusted operator login, server-side credentials, HTTP-only sessions, mutation origin checks, login throttling, an SQLite company/location/group map and audit log, periodic inventory synchronization, existing-group linking, company and group creation, company renaming, 24-hour agent enrollment invitations, dynamically generated device desktop links, and Windows service status/start/stop/restart. The operator can see every group accessible to the integration account. It does not offer customer logins or a tenant-isolated multi-user portal.

After login, link each existing device group to a company before creating duplicate groups. For a new company, create a new agent group, generate an enrollment invitation, and privately send that link to an authorized customer. Installing the group-specific Windows agent enrolls the computer in MeshCentral. Successful synchronization reflects new, removed, and offline devices every 30 seconds. Enrollment invitations enable ongoing management; obtain authorization before agent installation. Desktop opens MeshCentral's authenticated interface for the actual node ID, without passing login credentials or issuing unattended-control bypasses.

Use **Add device** to choose a company, location, and device group, then generate its enrollment link without creating another company. Companies can have several locations, and each location can have groups such as Workstations and Servers. The company **Add device** and group **Enroll device** shortcuts preselect the relevant assignment. One valid link can enroll multiple computers. When no company is linked yet, Add device guides you to the one-time company/group setup. Generating a link does not create a phantom device; the computer appears only when its installed agent registers. Existing company mappings migrate automatically into a Main office location and Default devices group without changing MeshCentral IDs or reinstalling agents. Back up the SQLite database with its online backup API before upgrading; copying only the database file while WAL mode is active is insufficient.

Windows service management uses MeshCentral's `runcommands` action with PowerShell, agent privileges, and `reply:true`. The integration account must have the necessary remote command rights in the device group. Only generated service-list/start/stop/restart commands are exposed; arbitrary scripts, startup-type changes, and wildcard service names are not accepted. Service changes wait for the Windows service to reach the requested state and return a fresh service list. Core Windows/security services and MeshCentral agent services are protected from changes in this UI. Stop/restart asks the operator to confirm the potential application interruption. Offline/inaccessible/non-Windows devices are rejected; concurrent service requests on one device are serialized by refusing overlapping requests. Failures and timeouts never report a successful change. Each requested and completed operation is recorded in the local audit table, and MeshCentral also logs remote commands. A timed-out mutation may have reached the computer; refresh the status before retrying. Agent versions and permissions still require verification on a real Windows device; fixture tests do not execute Windows commands.

The live dashboard has no sample devices or invented resource metrics. A failed synchronization explicitly labels cached data and disables remote actions until a successful synchronization. MeshCentral enrollment, permissions, and TLS must be tested on the real deployment; local tests use a private HTTPS MeshCentral fixture and do not establish connectivity to the user's server. Real CPU/RAM collection, backup jobs, antivirus deployment, and a backend ticket system are future integrations.

Validation: `npm run check`, `npm test`, and `npm audit --omit=dev`. The integration test requires OpenSSL, creates an isolated test certificate, explicitly trusts that test CA in its child process, and exercises authentication, origin checks, company/location/group boundaries, enrollment, device synchronization, remote links, Windows service replies and errors, outages, logout, and SQLite persistence. Additional tests exercise repeatable legacy-database migration, protected services, and command-injection rejection. Optional browser validation can use `BROWSER_TEST_MODULE=/absolute/path/to/playwright/index.mjs npm test` with `/usr/bin/chromium`; it verifies enrollment, location/group creation, and service controls against the fixture.

### Optional one-click desktop launch

On the reviewed MeshCentral 1.1.59 installation at `/opt/meshcentral`, run `sudo python3 /opt/maldoori/scripts/install-meshcentral-autoconnect.py`, then restart MeshCentral. The installer creates a supported custom template under `meshcentral-web/views`; it leaves the package template unchanged and refuses to replace other custom templates. Maldoori links include `maldooriConnect=1`. The hook waits for the selected device, authenticated control connection, and enabled visible Connect button, then clicks the normal button once. Server permissions, session selection, and user consent still apply. It neither retries failed sessions nor bypasses authentication. Desktop-browser template only; native mobile templates are unchanged. Before upgrading MeshCentral, remove this generated override and review/rebuild it for the new version to avoid retaining an outdated frontend. To roll back, remove only `/opt/meshcentral/meshcentral-web/views/default.handlebars` if it contains the Maldoori launch marker, then restart MeshCentral.

### Small business customer organization

The main hierarchy is Customer → Company → Computer. Use Add customer, then Add company and select that customer. A customer can have multiple companies. Edit company assigns existing companies to a customer without moving or reinstalling their agents. Existing companies initially appear under Unassigned customer. These are organization records within the operator workspace, not customer login accounts.

Add device selects the company and defaults to Main office / Default devices. Expand Advanced only when choosing another location or group. Installed computers display their agent-reported names beneath their company and appear automatically after enrollment.

### Acronis connection (initial integration)

The Backups tab tests OAuth client-credentials authentication against the configured Acronis data center and links to its console. Credentials and access tokens remain server-side, TLS verification is enabled, redirects are rejected, and failed authentication never reveals provider response bodies. This initial connection does not retrieve per-device backup results, execute backups, schedule plans, or restore data. Those operations remain in Acronis until tenant/device mapping and the relevant APIs have been verified with the account. Authentication alone does not establish successful protection.

On the Droplet, run `sudo python3 scripts/configure-acronis.py` to enter a replacement API client ID and secret through hidden prompts. It updates `/etc/maldoori/credentials.json` atomically with mode 600 and preserves existing MeshCentral and RMM settings. Restart `maldoori`, open Backups, and test the connection. Revoke any API credentials previously disclosed in chat. Never commit secrets or include them in shell arguments.

Previously discovered computers are retained in SQLite when a successful MeshCentral inventory omits them. They remain visible as Offline, including after an RMM restart, while their MeshCentral group remains accessible to the integration account. Removed group permissions hide retained records; unsuccessful synchronization remains explicitly marked as stale. Retention starts when this version first discovers the computer and cannot recover computers omitted before that discovery. Disconnecting or removing an agent does not delete its retained inventory record.

Computer cards provide Edit and Delete. Edit stores a persistent Maldoori display name without renaming the operating system or MeshCentral node. Delete requires confirmation and hides the node from Maldoori, including after synchronization and restart; it does not uninstall agents, remove the MeshCentral node, or delete Acronis backups. Windows services controls have been removed from the live UI.

Windows computer cards now request read-only PowerShell telemetry through the MeshCentral agent: CPU processor load, used physical memory, and used space on the Windows system drive. Readings display their collection time and refresh on dashboard polling, with a 30-second cache and bounded concurrent requests. Offline/unsupported devices and failed readings do not show invented values. Command permissions are required. Local fixture tests validate parsing, access checks, and display behavior; real Windows execution needs confirmation after deployment.

### Acronis resource linking and customer task history

Backups imports accessible Acronis resources and provider task history using the resource-management v4 and task-manager v2 APIs. Link an RMM computer to the matching resource using both customer and computer name; names alone never auto-match across customers. Links persist in SQLite and one resource cannot link to two computers. Removing a link does not affect backup plans. Task state/result codes are provider-reported and shown as customer task history, not per-computer backup success or recovery-point verification. Provider-specific task-to-device correlation and backup execution remain pending. Errors label cached results, and incomplete pagination is explicitly marked. Credentials, task payloads, and raw task context are not sent to browsers.

Per-resource backup summaries accept only the tenant-confirmed backup task type D332948D-A7A9-4E07-B76C-253DCF6E17FB, an exact GUID reference to one uniquely identified resource, and completed/ok with a valid completion time for the last successful task. Tasks with no resource reference or multiple matching resources remain unverified. This reflects returned task history, not a guarantee that a recovery point still exists or that future backups will succeed. Live correlation must be checked on the tenant; it never uses computer names as identifiers.

The Backups interface uses searchable computer cards, link counts, readable timestamps, and expandable backup/recovery history and connection settings. Manage in Acronis opens the configured provider console, where Backup now, scheduling, and recovery currently execute. These controls are not implemented as direct RMM API actions. The read-only diagnostic also probes policy-management API availability to inform the next integration stage.

Dashboard (formerly Overview) includes a Customize dashboard dialog for showing/hiding inventory totals, customers/companies, computer cards/live metrics, quick actions, and optional Acronis backups. Move widgets up or down and choose one, two, or three columns; narrow screens adapt automatically. Layouts are stored in this browser’s localStorage and survive refresh. Other pages remain accessible even when their dashboard widgets are hidden. Reset layout restores defaults. This does not add custom code, arbitrary widgets, or cross-browser layout synchronization.
