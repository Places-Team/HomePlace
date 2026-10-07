# Temporary exchange API

Temporary exchanges complement Link's direct device-to-device offers. An exchange has a 128-bit URL-safe bearer code, a fixed expiry, and an optional first-open limit. The default is a link that anyone holding the URL can open. `access: "account"` instead requires a signed-in HomePlace user or a paired device with `share.relay` permission.

The server stores text and files encrypted at rest. It stores the code encrypted for the owner and uses only its SHA-256 hash for recipient lookup. Treat the URL as a secret: anyone who obtains a public link before it expires can read its contents. Never put private text or tokens in URL query parameters.

## Owner authentication

Creation, listing, and deletion accept an authenticated HomePlace browser session. Browser mutations require same-origin requests. Native applications use the existing Link device bearer credential with `share.relay` permission. All JSON responses are `Cache-Control: no-store`.

## Create and manage

- `POST /api/exchange` creates text. JSON: `{ "text": "...", "expiresInSeconds": 3600, "access": "link", "deleteAfterOpen": false }`. Text is at most 16 KiB in UTF-8. Returns `201 { "exchange": { "token", "kind", "access", "filename", "mimeType", "size", "deleteAfterOpen", "createdAt", "expiresAt" } }`.
- `POST /api/exchange/file` uploads raw file bytes, not multipart. Headers: `x-homeplace-size` (integer bytes), `x-homeplace-filename-base64` (UTF-8 name encoded as standard Base64), `x-homeplace-expires` (`600`, `3600`, or `86400`), `x-homeplace-access` (`link` or `account`), `x-homeplace-delete-after-open` (`true` or `false`), and `content-type`. The body must exactly match the stated size. Maximum 10 GiB, subject to the server's configured limit and current free space. Returns the same `201` exchange object.
- `GET /api/exchange` lists the owner's active, unconsumed exchanges, newest first.
- `DELETE /api/exchange/{token}` removes an exchange and its file. Only its owner can delete it.

Missing options default to one hour, public-link access, and reusable until expiry. At most 100 active exchanges and 20 GiB of active file data per account are retained; the server-wide active file cap is 40 GiB. File creation is limited to two requests per minute per account. `GET /api/link/info` publishes `limits.maxFileBytes` for all clients. This effective limit is at most `MAX_FILE_UPLOAD_GIB` (1–10 GiB) and shrinks to preserve 2 GiB of free space on the HomePlace data volume. Clients should refresh it before sending a file; the upload endpoint remains authoritative. Use the returned code to construct `{server-origin}/x/{token}`; do not assume the configured server URL equals the browser's LAN or external origin. Reverse proxies must permit the same body size and stream requests without buffering large files on disk.

The web UI offers a link for the current browser address and, when different, a link using the configured `APP_URL` origin. Both addresses use the same code and expiry. The configured address must be reachable by the recipient.

## Recipient

Public one-time exchanges (`access: "link"` and `deleteAfterOpen: true`) automatically
use short links, including older clients that omit `quick` or send `false`.
For the simplest creation flow, set `quick: true` in the text JSON or
`x-homeplace-quick: true` on a file upload. The server overrides other access,
expiry, and reuse options: anyone with the code may open it once within 10
minutes. The response and owner listing include `shortCode` (five case-sensitive
Base58 characters); always prefer `{server-origin}/f/{shortCode}` when present.
Show the actual returned `expiresAt`, not the requested lifetime. Account-only
or reusable exchanges retain the existing 22-character `/x/{token}` link unless
the caller explicitly chooses `quick: true`. Existing links are not rewritten.
The short route limits lookup attempts per client and across the server. Its
landing page does not consume the exchange; opening text or starting a file
download does. Do not use five-character codes for long-lived or reusable data.
Short-code lookups use a keyed index, so a database-only copy cannot cheaply
enumerate the five-character code space without the server secret.

- `GET /api/exchange/{token}` returns metadata only. It never consumes a one-time exchange or reveals text.
- `POST /api/exchange/{token}/open` returns `{ "text": "..." }`. This is the explicit text-open action.
- `GET /api/exchange/{token}/file` downloads the file with attachment disposition and SHA-256 in `x-homeplace-sha256`.
- `GET /x/{token}` is the browser landing page for the same flow. It does not consume the exchange until the visitor opens text or starts a file download.

Codes are 22 URL-safe characters. A one-time exchange is atomically claimed when text is opened or the file download begins. Later access returns `404`; an interrupted first download cannot be resumed. Range requests return `416`. One-time text is removed immediately after opening; one-time file data and its exchange record are removed after the download stream ends or is cancelled. Expired exchanges and files are pruned during subsequent exchange activity and hourly server maintenance. Clients should show expiry and the one-time limitation clearly before creating a link.
