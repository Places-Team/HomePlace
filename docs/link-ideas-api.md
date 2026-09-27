# Link ideas API

Ideas and sections are personal to the paired HomePlace account. A Link device must request and receive `ideas.manage` during pairing. Existing devices need fresh approval; the server never infers this permission from calendar or reminder access. All routes require the device bearer credential.

## Read

`GET /api/link/ideas?archived=0&categoryId=<id>&q=<text>&cursor=<id>` returns:

```json
{
  "categories": [{ "id": "...", "name": "Inbox", "position": 0 }],
  "ideas": [{ "id": "...", "categoryId": "...", "title": "...", "note": "", "pinned": false, "archived": false, "createdAt": "...", "updatedAt": "..." }],
  "nextCursor": null
}
```

The page contains up to 100 ideas, pinned first and then newest updates. Pass `nextCursor` to fetch the following page. `q` searches title and note, up to 100 characters. `archived=1` selects archived ideas; the default is active ideas. The category list is always returned for the account.

## Change

`POST /api/link/ideas` accepts JSON with one of these actions:

| Action | Fields | Result |
| --- | --- | --- |
| `createCategory` | `name` | `{ "category": ... }` |
| `renameCategory` | `id`, `name` | `{ "ok": true }` |
| `deleteCategory` | `id` | `{ "ok": true }`; ideas move to Inbox |
| `createIdea` | `title`, optional `note`, `categoryId` | `{ "idea": ... }` |
| `updateIdea` | `id`, optional `title`, `note`, `categoryId`, `pinned`, `archived` | `{ "ok": true }` |
| `deleteIdea` | `id` | `{ "ok": true }` |
| `import` | `categories`, `ideas` | `{ "ok": true, "imported": N }` |

An omitted `categoryId` on create uses Inbox. Title is limited to 500 characters, note to 2,000, section name to 40. Up to 100 sections are allowed per account. Writes are rate-limited per device. Mobile should use the same actions and permission, not maintain a second ideas store.

Import is for explicit migration from Desktop's former local store. Each item includes `sourceId`, `title`, `category`, and ISO `createdAt`; batches contain at most 30 ideas. `(userId, sourceId)` makes retries idempotent. Desktop keeps its local copy after a confirmed import, so a failed or interrupted transfer cannot erase ideas.
