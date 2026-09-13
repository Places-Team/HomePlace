# HomePlace Link development roadmap

## Purpose

HomePlace Link expands HomePlace from a server dashboard into a self-hosted
control centre for personal devices, applications and services. The HomePlace
web application is the control plane. A small agent on each device advertises
what that device can do and executes only explicitly supported actions.

The system must work for one person on one LAN, for a household with several
accounts, and for devices reaching HomePlace through a private or public
address. No hosted HomePlace account is required.

## Product principles

1. The user chooses the server. Every application starts by asking for a
   self-hosted HTTPS domain, local hostname or local IP address.
2. Connections are outbound from agents. HomePlace never requires an inbound
   port on a laptop or phone.
3. Capabilities are explicit. There is no general remote shell and no hidden
   command execution path.
4. Local operation remains useful. The dashboard, known devices and LAN
   actions continue to work when the public internet is unavailable.
5. Security decisions are visible. The application shows which server it is
   connected to, which certificate it trusts and which permissions are active.
6. Platforms may expose different capabilities. The interface renders only
   actions that the selected device currently advertises.
7. Protocol compatibility is versioned independently from application
   releases so older agents fail safely instead of guessing.

## Repository layout

Keep the control plane in this repository. Create separate repositories when
native client work begins so server containers do not acquire desktop and
mobile toolchains.

- `HomePlace`: web interface, API, realtime gateway, automation engine,
  protocol schemas and administrator documentation.
- `HomePlace-Agent`: shared agent core, Windows application, macOS application,
  Linux daemon and packaging.
- `HomePlace-Mobile`: Android and iOS applications, share extensions and store
  metadata.

The canonical protocol schemas live in `HomePlace`. Release automation exports
them as a versioned package and generates Rust, C#, Swift and Kotlin types.
Client repositories pin a protocol release rather than copying payload shapes.

## System topology

```text
Windows agent ─┐
macOS agent ───┤       outbound TLS/WebSocket
Linux agent ───┼────────────────────────────────┐
Android app ───┤                                │
iOS app ───────┘                                ▼
                                      ┌───────────────────┐
Browser ───── HTTPS ─────────────────▶│ HomePlace server  │
                                      │ device registry   │
Home Assistant ─ API/Webhook ────────▶│ command router    │
Docker/Proxmox/media services ───────▶│ automation engine │
                                      │ event and audit DB│
                                      └───────────────────┘
```

Agents establish one authenticated WebSocket connection and maintain it with
heartbeats. Ordinary REST endpoints handle pairing, uploads, downloads and
history. Web push or platform push wakes mobile applications when background
execution is restricted.

## Server connection onboarding

Every native application starts in an unpaired state and presents these
connection methods:

1. **Scan a QR code.** The HomePlace web interface creates a short-lived
   pairing payload containing the server URL, one-time token, server identifier
   and certificate fingerprint when needed.
2. **Enter an address.** Accept a full URL such as
   `https://home.example.net`, `https://homeplace.lan` or
   `http://192.168.1.20:3200`.
3. **Discover on the LAN.** Optional mDNS discovery advertises `_homeplace._tcp`
   and shows discovered servers without pairing automatically.

Address rules:

- Public hostnames require HTTPS.
- Plain HTTP is accepted only for loopback, RFC 1918 IPv4 and local IPv6
  addresses, with a persistent warning.
- Self-signed certificates require an explicit fingerprint confirmation.
- Redirects to a different host are never followed during pairing without a
  second confirmation.
- Credentials are never embedded in the URL.
- A connection test verifies `/api/link/info`, protocol range, server ID,
  clock skew and TLS identity before the pairing token is submitted.

Applications store named connection profiles. A profile contains the canonical
server ID, preferred URL, optional LAN URL, certificate trust record and device
credential reference. Secrets live in Keychain, Windows Credential Manager,
Android Keystore, iOS Keychain or a Linux secret service.

The first release uses one active server per device. The data model allows
multiple profiles from the start so later releases can switch between home,
work or test servers. Failover between public and LAN URLs is allowed only when
both endpoints prove the same server ID and key fingerprint.

## Pairing and device identity

1. An administrator opens **Devices → Add device** in HomePlace.
2. HomePlace creates a single-use token with a five-minute expiry and displays
   a QR code plus a human-readable code.
3. The agent creates a device key pair locally and submits its public key,
   platform information, requested display name and capability manifest.
4. HomePlace shows the request and requested permissions to the administrator.
5. Approval issues a scoped device credential. Only its hash and public key are
   stored by HomePlace.
6. The agent reconnects with proof of possession and receives its device ID.

Revocation is immediate. Re-pairing creates a new identity. Device credentials
cannot create users, approve other devices or expand their own capability set.

## Protocol model

Every realtime envelope contains:

```json
{
  "protocol": 1,
  "id": "command-or-event-id",
  "type": "command.request",
  "deviceId": "device-id",
  "sentAt": "2026-09-13T12:00:00Z",
  "expiresAt": "2026-09-13T12:00:30Z",
  "payload": {}
}
```

Initial message families:

- `agent.hello`, `agent.heartbeat`, `agent.capabilities`
- `device.state`, `device.event`
- `command.request`, `command.accepted`, `command.progress`
- `command.completed`, `command.failed`, `command.cancelled`
- `file.offer`, `file.accepted`, `file.progress`, `file.completed`
- `notification.deliver`, `notification.action`

Commands are idempotent by ID, expire quickly and have a stored result. The
server never silently retries destructive actions. Large files travel through
short-lived HTTP transfer URLs rather than WebSocket frames.

## Capability model

Capabilities use stable names and optional constraints:

```json
{
  "name": "file.receive",
  "version": 1,
  "constraints": {
    "maxBytes": 1073741824,
    "requiresConfirmation": true
  }
}
```

First capability groups:

- `clipboard.read`, `clipboard.write`
- `file.send`, `file.receive`
- `url.open`, `app.open`, `app.list`
- `system.lock`, `system.sleep`, `system.shutdown`, `system.restart`
- `system.wake.request`
- `device.battery`, `device.network`, `device.activeApplication`
- `media.state`, `media.play`, `media.pause`, `media.seek`
- `notification.receive`, `notification.action`
- `share.url`, `share.text`, `share.file`, `share.magnet`

Each capability has a protocol schema, risk level, required local permission,
confirmation policy and platform support table. An agent rejects unknown
commands even when the server sends them.

## HomePlace control-plane work

### Data model

Add persistent models for:

- devices and device key fingerprints;
- connection sessions and last-seen state;
- advertised capabilities and constraints;
- pairing requests and expiry;
- commands, progress and terminal results;
- file transfers and retention state;
- automation definitions, runs and step results;
- per-user device permissions;
- immutable audit events.

Frequently changing telemetry such as active application and battery remains a
latest-state record. Only meaningful transitions become history events.

### API and gateway

- `GET /api/link/info`: unauthenticated server identity and supported protocol
  range, with no installation secrets.
- `POST /api/link/pairing`: administrator creates a pairing request.
- `POST /api/link/pair`: agent submits a pairing request.
- `POST /api/link/pairing/:id/approve`: administrator approval.
- `GET /api/link/connect`: authenticated WebSocket upgrade.
- `POST /api/link/files`: create a bounded transfer.
- `PUT/GET /api/link/files/:id`: authenticated streaming transfer.
- `POST /api/link/devices/:id/commands`: dispatch a validated command.
- `GET /api/link/devices/:id/events`: paginated event history.

Apply body limits, rate limits and schema validation before database work.
Connection authentication and user sessions use separate credentials and
separate middleware.

### Web interface

Add a top-level **Devices** section with:

- online/offline cards, platform, connection path and last seen time;
- battery, network and active-application status where available;
- actions generated from current capabilities;
- command progress and clear failure messages;
- send text, URL or file workflow;
- pairing and revoke controls;
- per-device permission and confirmation settings;
- event timeline and audit history.

Add a global **Send to device** action to the command palette and item menus.
Service pages can expose contextual actions, such as sending a magnet link to
qBittorrent or a title to Radarr/Sonarr.

### Automation engine

Represent an automation as versioned triggers, conditions and actions. Initial
triggers include device online/offline, network change, battery threshold,
active application, incoming shared content, Home Assistant event, schedule
and webhook. Initial actions include device command, notification, Home
Assistant service call, qBittorrent add, Radarr/Sonarr request and webhook.

Every run records inputs and results. The editor validates capability and
permission requirements before enabling a rule. Add cooldowns, deduplication,
maximum concurrency and loop detection before multi-step rules are released.

## Desktop applications

### Shared core

Use Rust for transport, protocol handling, cryptographic identity, reconnect
logic, command validation and file streaming. Expose a narrow native interface
to each platform shell. Platform code owns permission prompts and operating
system APIs.

The core provides:

- connection profiles and server identity verification;
- exponential reconnect with jitter and network-change wake-up;
- signed capability manifests;
- command expiry, idempotency and cancellation;
- structured logs with secret redaction;
- resumable, checksummed file transfer;
- automatic update metadata verification;
- a simulator used by server integration tests.

### Windows

Use a Windows Service for background connectivity and a WinUI 3 tray
application for setup, consent and user-session actions. Communicate over a
restricted local named pipe.

Release order:

1. Pairing, tray status, heartbeat, notification receive and URL open.
2. Clipboard send/receive with explicit opt-in and loop suppression.
3. File receive/send with Windows notification and destination selection.
4. Lock, sleep, shutdown and restart with per-action confirmation policy.
5. Application launch from an administrator-approved allowlist.
6. Active application and media state reporting, disabled by default.

Package as signed MSIX plus a documented portable build. Support Windows 10
22H2 and Windows 11. Installation must clearly distinguish service-level and
interactive-user permissions.

### macOS

Use a SwiftUI menu-bar application with a LaunchAgent. Keep all user actions in
the logged-in session; do not install a privileged helper until a capability
actually requires one.

Release order:

1. Pairing, menu-bar status, heartbeat, notifications and URL open.
2. Clipboard sync with change hashes and pasteboard loop prevention.
3. Share extension and file transfer with destination approval.
4. Lock, sleep and application launch with visible permission state.
5. Active application and media reporting as separate privacy toggles.
6. Optional wake relay for other LAN devices.

Distribute a notarized universal application for Apple silicon and Intel. Store
credentials in Keychain and explain Accessibility or Automation permission only
at the moment a selected capability needs it.

### Linux

Ship a headless systemd user service first, followed by an optional tray UI.
Provide `.deb`, `.rpm`, AppImage and a static archive where practical.

Start with pairing, heartbeat, URL open through `xdg-open`, notifications,
clipboard adapters for X11 and Wayland, file transfer and systemd-logind power
actions. Detect unavailable desktop APIs and omit those capabilities instead of
reporting broken controls.

## Mobile applications

### Android

Use Kotlin and Jetpack Compose. A foreground service maintains reliable local
connectivity when the user enables continuous operation; push wakes the app for
lower-power remote delivery.

Initial features:

- QR/manual server setup and multiple saved profiles;
- Android share sheet for URLs, text, files and magnet links;
- send to qBittorrent, Radarr/Sonarr or another device;
- device list, remote actions and transfer progress;
- notifications with safe action buttons;
- clipboard receive through an explicit user action where Android background
  restrictions prevent silent clipboard access;
- home-screen quick actions and widgets after the core flows are stable.

Publish signed APKs on GitHub Releases and an F-Droid-compatible build before
considering other stores. Keep Firebase optional: self-hosted UnifiedPush or
websocket-only operation must remain possible.

### iOS and iPadOS

Use SwiftUI with a Share Extension. iOS does not allow a permanent arbitrary
background connection or silent global clipboard monitoring, so the capability
manifest must reflect foreground/background state honestly.

Initial features:

- QR/manual pairing and server profiles;
- share extension for URLs, text and files;
- device list, remote actions and transfer status;
- APNs-backed notification wake-up as an optional administrator-configured
  service;
- local-network permission for LAN discovery and connections;
- Shortcuts/App Intents for user-triggered automations.

Provide a reproducible Xcode build and document sideloading. App Store delivery
is optional and must not become a requirement for self-hosted use.

## Security baseline

- Use TLS 1.2 or newer for non-LAN connections.
- Hash bearer credentials and encrypt stored sensitive integration values.
- Sign pairing and command payloads; bind them to server and device IDs.
- Store private keys only in platform secure storage.
- Rate-limit pairing, authentication, commands and file offers separately.
- Require recent administrator authentication for revoke, shutdown and policy
  changes.
- Use explicit maximum size, MIME handling and retention for file transfers.
- Scan filenames and never write outside the selected destination.
- Keep application launch allowlisted; never accept arbitrary command lines.
- Record who requested an action, which device accepted it and the result.
- Provide one-click device revocation and a global emergency disable switch.
- Publish a threat model and security reporting policy before public beta.

## Delivery phases

### Phase 0: protocol and threat model

Deliver protocol schemas, capability registry, server identity, threat model,
agent simulator and compatibility tests.

Exit criteria: an old simulator and current server negotiate safely; malformed,
expired and replayed commands are rejected in automated tests.

### Phase 1: server foundation

Deliver device models, pairing UI, authenticated WebSocket gateway, heartbeat,
device list, command audit and administrator revocation.

Exit criteria: 100 simulated devices reconnect without duplicate sessions, and
revocation closes an active connection immediately.

### Phase 2: desktop minimum viable release

Deliver Windows, macOS and Linux pairing, presence, notifications, URL open and
clipboard transfer.

Exit criteria: installers work on clean supported systems; every advertised
capability succeeds or disappears when permission is removed.

### Phase 3: files and service handoff

Deliver bounded file transfer, share workflows, qBittorrent magnet handoff and
Radarr/Sonarr requests.

Exit criteria: interrupted transfers resume and verify checksums; expired links
and unauthorized recipients cannot read a transfer.

### Phase 4: Android and iOS

Deliver server selection, pairing, share extensions, device controls,
notifications and transfer progress.

Exit criteria: LAN-only and public-domain installations both complete pairing;
background limitations are represented through capabilities rather than silent
failure.

### Phase 5: automations

Deliver trigger/action editor, run history, cooldowns, loop detection and Home
Assistant/device scenarios.

Exit criteria: retries are bounded, duplicate events do not duplicate actions,
and disabling a rule prevents queued future steps.

### Phase 6: public beta and hardening

Deliver signed releases, update channels, migration tests, accessibility pass,
localization, backup/restore coverage, security documentation and release
rollback procedures.

Exit criteria: the previous two released client versions remain compatible with
the current server, and a documented rollback preserves device identities.

## Test strategy

- Schema contract tests generated for every supported client language.
- Property tests for envelope parsing, expiry and idempotency.
- Integration tests using the agent simulator and temporary HomePlace server.
- Network tests for disconnects, captive portals, DNS changes and LAN/public
  endpoint switching.
- Security tests for replay, privilege escalation, path traversal, oversized
  payloads and revoked credentials.
- Platform tests on clean Windows, macOS, Linux, Android and iOS environments.
- Browser tests at desktop and 375px widths for pairing, devices and actions.
- Upgrade tests across database migrations and the supported protocol window.

## Release and maintenance

Use semantic versions for applications and an integer protocol version with an
advertised supported range. Publish checksums, signatures, release notes and a
software bill of materials. Keep stable, beta and nightly channels separate.

The server displays outdated or incompatible agents without exposing actions
they cannot safely execute. Native applications check signed release metadata
but let self-hosters disable update checks or point them at their own mirror.

Telemetry is off by default. Diagnostics are local, redact addresses and
tokens, and can be exported explicitly for a support request.
