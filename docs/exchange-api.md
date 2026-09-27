# Temporary exchange API

Temporary exchanges complement Link's direct device-to-device offers. An exchange has a 128-bit URL-safe bearer code, a fixed expiry, and an optional first-open limit. The default is a link that anyone holding the URL can open. `access: "account"` instead requires a signed-in HomePlace user or a paired device with `share.relay` permission.

The server stores text and files encrypted at rest. It stores the code encrypted for the owner and uses only its SHA-256 hash for recipient lookup. Treat the URL as a secret: anyone who obtains a public link before it expires can read its contents. Never put private text or tokens in URL query parameters.

## Owner authentication

Creation, listing, and deletion accept an authenticated HomePlace browser session. Browser mutations require same-origin requests. Native applications use the existing Link device bearer credential with `share.relay` permission. All JSON responses are `Cache-Control: no-store`.

## Create and manage

- `POST /api/exchange` creates text. JSON: `{ "text": "...", "expiresInSeconds": 3600, "access": "link", "deleteAfterOpen": false }`. Text is at most 16 KiB in UTF-8. Returns `201 { "exchange": { "token", "kind", "access", "filename", "mimeType", "size", "deleteAfterOpen", "createdAt", "expiresAt" } }`.
- `POST /api/exchange/file` uploads raw file bytes, not multipart. Headers: `x-homeplace-size` (integer bytes), `x-homeplace-filename-base64` (UTF-8 name encoded as standard Base64), `x-homeplace-expires` (`600`, `3600`, or `86400`), `x-homeplace-access` (`link` or `account`), `x-homeplace-delete-after-open` (`true` or `false`), and `content-type`. The body must exactly match the stated size. Maximum 500 MiB. Returns the same `201` exchange object.
- `GET /api/exchange` lists the owner's active, unconsumed exchanges, newest first.
- `DELETE /api/exchange/{token}` removes an exchange and its file. Only its owner can delete it.

Missing options default to one hour, public-link access, and reusable until expiry. At most 100 active exchanges and 1 GiB of active file data per account are retained; the server-wide active file cap is 4 GiB. File creation is limited to two requests per minute per account. Use the returned code to construct `{server-origin}/x/{token}`; do not assume the configured server URL equals the browser's LAN or external origin. A reverse proxy may impose a lower upload limit than HomePlace's 500 MiB limit.

## Recipient

- `GET /api/exchange/{token}` returns metadata only. It never consumes a one-time exchange or reveals text.
- `POST /api/exchange/{token}/open` returns `{ "text": "..." }`. This is the explicit text-open action.
- `GET /api/exchange/{token}/file` downloads the file with attachment disposition and SHA-256 in `x-homeplace-sha256`.
- `GET /x/{token}` is the browser landing page for the same flow. It does not consume the exchange until the visitor opens text or starts a file download.

Codes are 22 URL-safe characters. A one-time exchange is atomically claimed when text is opened or the file download begins. Later access returns `404`; an interrupted first download cannot be resumed. Range requests return `416`. One-time text is removed immediately after opening; one-time file data and its exchange record are removed after the download stream ends or is cancelled. Expired exchanges and files are pruned during subsequent exchange activity and hourly server maintenance. Clients should show expiry and the one-time limitation clearly before creating a link.
