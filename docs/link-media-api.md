# Link media catalog API

Mobile and desktop clients use the same HomePlace server address selected at
pairing. Send `Authorization: Bearer <device credential>` on catalog, detail,
request and image calls. The paired device needs `media.request` permission.
Browser sessions can use their normal HomePlace cookie instead.

## Search and discovery

`GET /api/link/media?q=<text>&kind=all|movie|tv&category=all|anime&page=1&lang=ru|en`

- Omit `q` to browse trending titles, or use `category=anime` for Japanese
  animation across movies and series.
- `lang` defaults to the paired account's HomePlace language. Search uses
  Seerr's language-aware TMDB results. Russian `ё` queries retry with `е`
  only when the original query has no results.
- Each `items[]` entry has `id` (TMDB), `kind`, `title`, `originalTitle`,
  `overview`, `poster`, `backdrop`, `year`, `rating`, `isAnime`, and availability
  `status`. Show `title` as primary and `originalTitle` below it when different.
  `poster` and `backdrop` are server-relative URLs. Prefix the selected server
  base URL and send the same bearer credential when requesting the image.
- `configured: false` means Seerr has not been set up. `unavailable: true`
  means the configured service did not answer. Neither means an empty catalog.

`GET /api/link/media/{movie|tv}/{tmdbId}?lang=ru|en` returns `details` and
`profiles`. Details include genres, runtime, studios, seasons, original title,
backdrop and request status. Keep the title's TMDB ID and kind when opening a
card; do not search again by its displayed/localized title.

## Requests

`GET /api/link/media/requests` returns the current Seerr requests with titles,
posters and status. Owner/admin accounts may create one with
`POST /api/link/media/requests`:

```json
{
  "kind": "tv",
  "mediaId": 12345,
  "seasons": [1, 2],
  "profileKey": "optional key from details.profiles"
}
```

Omit `seasons` to request every season. A selected quality profile is checked
against current Sonarr/Radarr settings before submission. The response says
whether Seerr accepted the request or why it failed. Existing direct Arr
endpoints remain available for older clients; the catalog and this request
endpoint are the recommended flow for new UI.

Trending pages, search and individual details use the requested language.
Seerr's genre-based anime discovery uses its configured language, because its
`language` filter means the *original* language there; the localized detail is
always fetched when a title is opened. Native clients should not mistake this
filter for the UI language.
