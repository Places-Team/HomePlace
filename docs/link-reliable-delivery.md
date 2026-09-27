# Link reliable delivery and commands

These server APIs are additive to Link protocol v1. Existing single-request file
uploads and heartbeat clients remain supported. Native apps need to opt in.

## Resumable file upload

The sending device needs `share.relay` permission and `share.send` capability.
The receiving device needs `file.receive`. All calls use the sender's Link bearer
credential. Maximum file size follows the server's configured upload limit,
up to 10 GiB. Keep the upload ID locally until completion.

1. `POST /api/link/mobile/share/uploads` with JSON
   `{ "targetDeviceId": "...", "filename": "...", "mimeType": "...", "size": 123 }`.
   The response contains `id`, `offset`, `chunkBytes` (8 MiB) and `expiresAt`.
2. `PATCH /api/link/mobile/share/uploads/{id}` with the next binary chunk,
   `Content-Length` and `X-Upload-Offset`. The response supplies the new offset.
   On a timeout or `409`, call `GET` on the same URL and resume from its offset.
   Do not create a new upload merely because one chunk response was lost.
3. When offset equals size, `POST` to the same URL with no body. A successful
   `201` means the encrypted transfer was finalized and its offer queued for
   the recipient. The recipient still accepts it via the existing Link flow.
   `DELETE` on the same URL cancels an unfinished upload and frees its chunks.

Chunks are encrypted on disk, belong to one paired sender and expire after
24 hours. Finalization verifies the reconstructed file and uses the existing
recipient-bound, encrypted transfer. It temporarily needs room for both the
staged chunks and the final transfer. Configure the reverse proxy to allow an
8 MiB binary request (plus overhead) and disable request buffering for this
route when appropriate. The server's 10 GiB policy is independent of proxy
limits.

## Device commands

`POST /api/link/commands` is a same-origin, signed-in dashboard operation:
`{ "deviceId": "...", "action": "system.lock" }` or `system.sleep`.
The action must be advertised by a device on the same account. The server
queues a `command.execute` heartbeat event with `commandId`, `action` and
`expiresAt`. It does not execute shell commands on the server. The desktop
client must allowlist the action locally and report either `succeeded` or
`failed` to `POST /api/link/commands/result` with its bearer credential:
`{ "commandId": "...", "status": "succeeded", "message": "..." }`.
`GET /api/link/commands` exposes the last 50 commands and outcomes to the
account. A command expires after five minutes. A queued or acknowledged event
is never counted as successful execution without a result from the device.

## Incident delivery

Short outages retain the existing delay. A reported outage that remains down
is escalated with an urgent reminder, no more often than once an hour.
`notification.deliver` remains in the per-device Link queue until the device
acknowledges its event ID and is retained in device history afterward. Browser
push is sent independently; it may wake an installed web app when the platform
allows. Native background wake-up requires APNs/FCM integration and is not
claimed by this server change. A sleeping native client receives queued
notifications on its next heartbeat.
