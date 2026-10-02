# Plants, private photos and watering reminders

Run `npm test` for scheduling and upload-boundary checks, and `npm run test:plants` for isolated SQLite/route integration checks. The latter creates a temporary database, disables real Telegram delivery and removes its fixtures on completion. It never uses the deployed database. Set `KEEP_PLANT_TEST_DATA=1` to retain the temporary fixtures for local browser checks.

Plants belong to the paired device's account. All endpoints require the existing bearer device credential and `plants.manage`. The website can use its own authenticated session. Clients must continue to preserve local records and ask before importing old local-only plants.

## Discovery and records

`GET /api/link/info` advertises `features.plants`, `features.plantPhotos`, `features.plantReminders` and `limits.maxPlantPhotoBytes` (12 MiB).

`GET /api/link/plants` returns `plants` (including deletion tombstones) and the account's notification `settings`. Existing CRUD fields remain compatible. Each plant additionally has `remindersEnabled` and `photo`, which is either `null` or `{ url, version, maxBytes }`. The photo URL is a server-relative authenticated endpoint, not a public share link. Resolve it against the verified paired server and send only that server's device credential. Cache photos locally by server, account, client ID and photo version. Remove stale cache entries when the photo becomes null or the record is deleted. Photo changes increment the same plant revision.

`POST /api/link/plants` accepts the existing `create`, `update` and `delete` actions. `remindersEnabled` is optional: creates default to true; updates without it preserve the server value. Text updates preserve the photograph. The additional `water` action accepts `{ action: "water", clientId, revision, lastWateredAt }` and cancels queued notifications for the previous watering cycle. Conflict responses remain HTTP 409 with the current plant. Keep pending local changes on conflict and let the user choose how to resolve them.

## Photos

`GET /api/link/plants/{clientId}/photo` returns the current JPEG, PNG or WebP image with a private no-store response. A missing photo or a plant belonging to another account returns 404. A revoked or unapproved device cannot fetch it.

`POST /api/link/plants/{clientId}/photo` takes the raw image body, `Content-Type: image/jpeg` (or PNG/WebP), and `If-Match: <plant revision>`. Do not use multipart or base64 JSON. The server bounds the streamed body at 12 MiB, verifies its signature, stores it privately and returns `{ plant }` with an incremented revision and photo metadata. Mobile and desktop clients should resize oversized originals and convert HEIC/HEIF to JPEG locally before upload.

`DELETE` on the same URL requires `If-Match` and returns the updated plant. Missing revision: 428. Stale revision: 409 with the current plant. Oversized file: 413. Unsupported or mismatched media type: 415. Successful record deletion also deletes its current photo.

Upload the plant record first, then its photo using the returned revision. On an offline retry, refresh the current revision and merge deliberately; do not silently overwrite a newer photograph. Upload existing local photos only when the user has enabled/imported server plant sync. Keep local originals until successful transfer.

## Notification settings

`GET /api/link/plants/settings` returns `{ settings }`. `PATCH` accepts any subset of:

```json
{
  "enabled": true,
  "app": true,
  "telegram": false,
  "time": "09:00",
  "timeZone": "Europe/Moscow",
  "repeatDays": 1
}
```

Time zones are IANA names. `repeatDays` is 0 (one notification per watering cycle) or 1–30 (repeat while overdue). Each plant's `intervalDays` is 1–365 and uses local calendar days rather than fixed 24-hour spans. All devices edit the same account settings; present the current state before changing it. Telegram defaults off and uses the server integration's configured chat, which may be shared with other people. Explain this when enabling Telegram.

The server schedules reminders independently of the uptime-monitor toggle. Delivery is persisted and deduplicated by plant, watering cycle and scheduled date. Telegram failures retry with backoff, and app notifications use the existing durable Link queue for sleeping devices. Successful channels are not repeated during retries. A new watering timestamp, disabled reminders, deletion or a newer scheduled slot cancels stale work. Delivery retries expire after seven days; obsolete completed cycles are retained for thirty days. Current-cycle markers survive cleanup to prevent one-time reminders from being resent.

Web notifications are account-scoped and link to `/plants?plant={clientId}`. Native clients should recognize this destination and open the corresponding plant. Local-only plant notifications may continue to work offline; once server reminders are enabled, coordinate notification IDs/tags (`plant-{clientId}`) to avoid duplicate local and server alerts.
