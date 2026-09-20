# HomePlace

**HomePlace is a self-hosted dashboard and monitoring panel for your home
server.**

One page to open in the morning: every service you run, whether it is up, how
the machine is doing, and one click to get anywhere. Containers appear on their
own; you decide which ones become tiles.

- 🧩 **Auto-discovery** — containers on your Docker host show up by themselves,
  one click puts one on the dashboard, the arrow opens logs and details
- 🟢 **Status at a glance** — availability checks with uptime history, kept by
  HomePlace itself so it works with nothing else installed
- 🖱 **Arrange it yourself** — drag tiles anywhere on the grid, resize by the
  corner, keep the gaps you want
- 📊 **Hardware** — CPU, memory, disks, temperatures, network, plus per-container
  CPU and memory, from Prometheus
- 🖥 **Proxmox** — guests, physical disks and SMART, storages
- 🔔 **Telegram alerts and bot health** — monitor the main bot and additional
  bot tokens, including recent webhook failures, and alert paired phones without
  relying on Telegram itself
- 🎨 **A home page, not a NOC screen** — background photos from your phone's
  gallery, a slideshow, weather, a calendar, a now-playing tile
- 🔔 **Alerts that are not just "it is down"** — rules on any metric, held for a
  time you choose, delivered to Telegram and to the browser
- 🧰 **Your services, not just their tiles** — Jellyfin, qBittorrent, the *arr
  stack, Proxmox Backup Server and Home Assistant report into the board
- 🐳 **A containers page that is an operations view**, not a second way to build
  the dashboard: search, sort, live CPU and memory, controls per row
- ⌨️ **Ctrl+K** — search across services, containers and pages
- 📱 **Installable** on a phone home screen
- 🌗 **Light and dark**, five accents, **English and Russian**
- 🔐 **Local accounts**, with optional single sign-on through FriendPlace

Everything host-specific lives in `.env`. Nothing about your server is in this
repository.

---

## Quick start

```bash
git clone https://github.com/Places-Team/HomePlace.git
cd HomePlace
cp .env.example .env
docker compose up -d --build
```

Open <http://localhost:3200> and the setup wizard asks you to create the owner
account. That wizard is reachable only while the panel has no accounts at all —
once the owner exists it closes for good.

Prometheus, Proxmox and Telegram are configured **in the interface**, under
Settings — address, token, and Save runs a real connection test. Anything you
would rather pin in the deployment can go into `.env` instead, and then the
settings page shows it as fixed. The `?` in the top bar has a short guide to
everything else.

---

## How it fits together

```
                         ┌────────────────────┐
   browser ──────────────│     HomePlace      │
                         │  Next.js + SQLite  │
                         └─────────┬──────────┘
              ┌────────────────────┼─────────────────────┐
              │                    │                     │
     docker-socket-proxy      Prometheus              Proxmox API
     containers, control      metrics & history       guests, disks, SMART
              │
      /var/run/docker.sock (read-only, never exposed to the app)
```

HomePlace stores what you arranged — accounts, tabs, tiles, widget settings —
plus a rolling window of its own availability checks. It deliberately does not
store metric history: Prometheus already does that better, and pointing
`PROMETHEUS_URL` at an existing one is less work than maintaining a second
time-series database.

### Why a socket proxy

Anything that can write to `/var/run/docker.sock` can start a privileged
container and own the host. Mounting it into a web application hands that power
to every bug in the application. The bundled `docker-socket-proxy` allowlists
only what the panel uses — listing containers, reading logs, and start/stop/
restart — and refuses everything else, including `exec`.

If you want a strictly read-only panel, set `ALLOW_CONTAINER_CONTROL=0`.
The refusal happens in the server, not in the interface, so it holds regardless
of who signs in.

### Container labels

A container can describe how it wants to appear, so an existing compose file
needs no changes elsewhere:

```yaml
labels:
  homeplace.title: "Jellyfin"
  homeplace.icon: "🎬"
  homeplace.group: "Media"
  homeplace.url: "https://media.example.com"
  homeplace.hide: "false"
```

---

## Authentication

Local login and password is the primary way in, and it always works.

**FriendPlace SSO is optional.** [FriendPlace](https://github.com/Olmae/FriendPlace)
can act as an OAuth 2.0 provider; if you run one, set `FRIENDPLACE_URL` and the
client credentials and a "Sign in with FriendPlace" button appears. With those
variables empty the integration does not exist as far as the login page is
concerned — which is the expected state for most people cloning this project.

With `FRIENDPLACE_ADMINS_ONLY=true` (the default) only administrators there may
enter. If that FriendPlace does not report administrator status, everyone is
refused rather than quietly let in.

Roles: **owner** (created by the wizard, cannot be locked out), **admin** (edits
the dashboard, controls containers), **viewer** (reads).

Forgot the password? `make admin-reset LOGIN=me PASSWORD=…` — it runs inside the
container, where the database already is.

---

## Configuration

Full reference with comments: [`.env.example`](.env.example). In short:

| Variable | What it does |
|---|---|
| `APP_URL` | Public address; used for OAuth redirects and cookie security |
| `HOMEPLACE_NAME` | Installation name shown to devices before pairing |
| `HOMEPLACE_SERVER_ID` | Optional UUID override for a restored installation identity |
| `AUTH_SECRET` | Session signing key, at least 32 bytes — `make secret` generates one |
| `TRUST_PROXY_HEADERS` | Trust forwarding headers from a sanitizing reverse proxy |
| `HOST_DATA_DIR` | Where the SQLite database lives on the host |
| `DOCKER_API_URL` / `DOCKER_HOSTS` | Docker endpoint, or several |
| `ALLOW_CONTAINER_CONTROL` | `0` makes the panel read-only (use `1` to allow control; the bundled socket proxy needs a numeric flag, not true/false) |
| `PROMETHEUS_URL` | Enables hardware metrics and charts |
| `PROXMOX_URL` + token | Enables the hypervisor view |
| `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` | Alerts; `TELEGRAM_PROXY_URL` for a SOCKS5/HTTP proxy |
| `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` | Calendar widget |
| `UPLOADS_DIR` | Where uploaded pictures live; inside `DATA_DIR` by default |
| `FRIENDPLACE_*` | Optional SSO |
| `DEFAULT_LOCALE` | `en` or `ru` |
| `CHECK_FOR_UPDATES` | Check the public GitHub releases feed and suggest newer versions to owners and administrators; never installs them automatically |
| `HOMEPLACE_VERSION` | Optional deployed version override for custom image build pipelines |

### What each integration adds

| Missing | Still works | You lose |
|---|---|---|
| Prometheus | Everything else | Charts, CPU/RAM/disk/temperature widgets |
| Docker | Everything else | Auto-discovery, container control, container-state checks |
| Proxmox | Everything else | Guests, physical disks, SMART |
| FriendPlace | Everything else | The SSO button |
| Telegram | Everything else | Notifications — the event feed still records everything |
| Google | Everything else | The calendar widget |
| Jellyfin / qBittorrent / *arr / PBS / Home Assistant | Everything else | Their own widgets; each is configured separately in Settings |
| Internet | Everything else | Weather, and the online icon pack |

---

## Development

Node 20.9 or newer.

```bash
npm install
cp .env.example .env          # DATABASE_URL defaults to ./data/homeplace.db
npx prisma db push
npm run dev                   # http://localhost:3200
```

```
src/
  app/            routes — (app) is everything behind the login
  actions/        server actions: the only place that writes
  components/     interface, widgets/ holds the dashboard cards
  lib/            integrations: docker, prometheus, proxmox, friendplace, telegram
  i18n/           en.ts is the base dictionary; other locales are checked against it
prisma/schema.prisma
```

`src/lib/layout.ts` holds the grid arithmetic — collision resolution,
compaction, reading order — as pure functions, deliberately separate from the
pointer handling in `Board.tsx`.

A few conventions worth knowing before changing things:

- **No literal colours.** Everything goes through a CSS variable in
  `globals.css`, which is what makes light/dark and the accents work.
- **The dictionary is type-checked.** Add a key to `en.ts` and TypeScript will
  point at every other locale until it is translated.
- **Integrations degrade, they do not throw.** A Prometheus that stops answering
  turns one card into "no data" instead of taking the page down.
- **Secrets never in git, and never in plain text.** `.env` is the preferred
  home for them; anything entered in the interface is encrypted with a key
  derived from `AUTH_SECRET` before it reaches the database (`lib/secretBox.ts`).

---

## Roadmap

Where this is going, roughly in order.

The device hub, native applications, connection model and staged delivery plan
are described in [HomePlace Link roadmap](docs/homeplace-link-roadmap.md).

### Next

- [x] Settings split into sections — the page had outgrown one column
- [x] Adding a widget by picking from categories, each with a sketch of itself
- [x] The calendar widget drawn as an actual calendar
- [x] Putting a configured service onto the board in one click
- [x] Keyboard-only layout editing — arrows move a focused tile, Shift resizes
- [x] Live-streaming container logs
- [x] More widget kinds: multi-series charts, gauges, an uptime strip
- [x] An icon picker with a bundled set
- [x] Per-user dashboards alongside the shared ones
- [x] Weather widget
- [x] Google Calendar — with your own OAuth client, since a public one cannot
      be shipped
- [x] Uploading background and slideshow images to the panel
- [x] Reminders that repeat, on the board and in your notifications
- [x] Folders hold anything, widgets included, and can be pinned in place
- [ ] Grouping tiles into labelled sections, as an alternative to folders

### Alerts and notifications

- [x] Telegram, with a delay before alerting, recovery messages and quiet hours
- [x] Rules on metrics, not only availability: "disk over 90%", "CPU pinned for
      ten minutes"
- [x] More destinations: ntfy and webhooks
- [ ] Email as a destination
- [ ] Grouping and escalation
- [x] Web push in the browser and on the phone, independent of Telegram

### Service integrations

- [x] **Home Assistant** — entities and toggles on the board, discovered from
      the house rather than typed in by hand
- [x] **qBittorrent** — active torrents and speeds
- [x] **Jellyfin** — what is playing, what to watch next, with artwork
- [x] ***arr stack** — queue and health
- [ ] Deeper *arr: upcoming calendar, search from the panel
- [x] **FatSecret** — a personal food diary with computed КБЖУ targets, foods from FatSecret search
- [x] **Proxmox Backup Server** — last backup, datastore usage
- [ ] **Weather** and a calendar widget for the home-page feel
- [ ] **Uptime Kuma** import, for people migrating

### Automation

- [ ] Scenarios: on an event, do a thing (restart a container, send a message)
- [ ] Scheduled actions
- [ ] A read-only public status page for the services you choose

### Apps and agents

- [x] HomePlace Link v1 discovery endpoint and base protocol schemas
- [ ] Device registry and secure pairing
- [ ] Windows, macOS and Linux agents
- [ ] Android and iOS applications with share extensions
- [ ] Device actions, clipboard, file transfer and cross-device notifications
- [ ] Event-driven automations across devices and connected services

### Housekeeping

- [ ] Import and export of the whole configuration as one file
- [ ] Multi-host Docker in the interface rather than only in `.env`
- [ ] Optional longer metric retention for installations without Prometheus
- [ ] A test suite worth the name

---

## License

[Apache-2.0](LICENSE)

Third-party acknowledgements are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Security reporting and deployment guidance are documented in
[SECURITY.md](SECURITY.md).
