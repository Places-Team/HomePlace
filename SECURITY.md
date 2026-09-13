# Security policy

## Reporting a vulnerability

Please do not publish an exploitable vulnerability in a regular issue. Open a
private security advisory from the repository's **Security** tab and include
the affected version, deployment model, reproduction steps and potential
impact. Reports should not contain real credentials or personal data.

## Supported version

Security fixes are applied to the current `main` branch. Self-hosted operators
should pull and rebuild regularly; old container images do not receive fixes
automatically.

## Deployment baseline

- Put an internet-facing installation behind an HTTPS reverse proxy.
- Set a random `AUTH_SECRET` of at least 32 bytes and protect the `.env` file.
- Keep the SQLite database and uploads on a private local volume with backups.
- Never expose the Docker socket directly. Use the restricted socket proxy.
- Leave `TRUST_PROXY_HEADERS=0` unless the reverse proxy removes client-supplied
  forwarding headers and writes trusted replacements.
- Keep `ALLOW_CONTAINER_CONTROL=0` when HomePlace only needs observation.
- Do not disable TLS certificate verification for public services.

## HomePlace Link boundary

HomePlace Link keeps device credentials separate from browser sessions by
design. The pairing implementation must issue scoped identities, store only
hashes of short-lived single-use tokens and permit only advertised
capabilities. The protocol does not provide a remote shell. Commands must have
identifiers, expiration times, permission checks and audit records before
dispatch.

The unauthenticated `/api/link/info` endpoint exposes only the server identity,
protocol compatibility, server time and implemented feature flags. It does not
expose application versions, account information, network topology or secrets.
