# AGENTS.md — OpenVibe.Shoes

## Project overview

OpenVibe.Shoes is the network's shoe resource at `https://open.shoes`: one page per model with every
store's all-in offer, Shoes' own daily price history and size-price curve, cited specs/fit/care notes,
and an official drops calendar. A person can watch a price or paste a listing link, which Shoes hands
to OpenVibe.Watch.

- **Entry:** `server/index.js` (Express); app wiring in `server/http/router.js`; port `5180`,
  service id `shoes`, env prefix `SHOES`.
- **Pages:** `server/http/pages.js` (server-rendered HTML via `server/render/layout.js`/`html.js`,
  `server/views/index.js`); own CSS in `public/css/`. No SPA and no build step.
- **API:** `server/http/api.js` (`/api/v1`), OpenAPI in `server/http/openapi.js`, discovery in
  `server/http/discovery.js` (robots, sitemap, llms.txt), SSO in `server/auth/`.
- **Domain:** `server/domain/parse.js` (pure source parsers), `server/domain/drops.js` (release
  calendar); jobs in `server/jobs/` (`offers.js`, `drops.js`, `ebay.js`).
- **Identity:** `server/identity/` and `server/auth/` for Network sessions; the person's own token is
  forwarded to Watch and Today.

## Owns, does not own

Owns the shoe catalogue, offers and daily snapshots, drops, watches stored on Shoes, cited facts and
job-run records (`shoe_models`, `shoe_offers`, `shoe_snapshots`, `shoe_drops`, `shoe_watches`,
`shoe_facts`, `shoe_job_runs`, `account_data_events`, `telemetry_samples`). It publishes a search
index document and its share of account export/deletion.

Does not own: store catalogues or prices (Deals and the official APIs are the sources), a person's
general watch list (OpenVibe.Watch — Shoes forwards the link and keeps only its own `shw_` row), the
calendar (OpenVibe.Today), or any checkout. **No raffle, draw, reservation or checkout is automated,
ever; no affiliate links, no sponsored ordering and no Marketplace scraping.**

## Who calls it, what it calls

Public pages and `GET /api/v1/*` need no token; a signed-in person's writes (watch, remind) use their
Network session. Shoes calls OpenVibe.Deals' public offer/product APIs, the eBay Browse API only
when a developer key pair is configured, the official release calendar/rSS feeds, and the person's
own Network token to call OpenVibe.Watch (`shw_` ↔ remote watch) and OpenVibe.Today (drop
reminders). A missing source key turns that source off with a plain note, never an error.

## Database and migrations

PostgreSQL through `openvibe-sdk/db`; migrations `migrations/NNNN_*.sql` (0001 initial, 0002 search
index, 0003 shares, 0004 outbox, 0005 product catalog), applied at boot with the owner role. Tests use
PGlite; `npm run test:pg` runs the same suite through PgBouncer. Never edit a migration that has run;
a schema removal waits for a contract migration. Each job writes one `shoe_job_runs` row (counts and
errors) and refuses to start under `SHOES_DRILL=1`; tests call `runOnce()`.

## Frontend loading model

Every page is server-rendered HTML with the shared Frame (`openvibe-shared/shell`, navbar/footer,
`/shared/*`); page-specific CSS is in `public/css`. There is no bundler and no route-feature loader.
Interactive bits (watch form, reminder, the small price chart) are inline server output plus small
scripts; keep pages usable without JavaScript and phone-first.

## Auth

Network SSO (RS256 JWT + session cookie) using the `shoes` OAuth client; public reads are anonymous.
A person's Watch/Today call uses their own Network token — never a service token on their behalf. A
session without a usable token can still save the watch on Shoes, marked "not connected". Forms are
origin-checked; `/internal/events` is HMAC-verified and loopback-only.

## Deploy

Install `deploy/systemd/openvibe-shoes.service` and `deploy/nginx/open.shoes.conf`; the unit reads
`/etc/openvibe/shoes.env`, works in `/opt/openvibe.shoes`, runs as `ubuntu:ubuntu` on
`127.0.0.1:5180`. The vhost proxies `/api/`, `/auth/` and the forms with their own limits.
`sudo ovhost deploy shoes` is the production path (git-checkout, install on lockfile change,
restart, wait for `/api/ready`); rollback with `sudo ovhost rollback shoes --to <sha>`.

## Commands and tests

```bash
npm ci --include=dev
npm start                  # http://127.0.0.1:5180
npm test                   # every test/*.test.js, PGlite, mock Network
npm test -- importer       # only matching files
npm run test:pg            # the same through PgBouncer
npm run seed               # one run of every job against live sources (needs the network)
```

`test/run.js` uses `openvibe-shared/test-runner` (90 s, serial); files get a temp PGlite database and
an in-process Network mock, never the network. Tests cover the parsers and all-in price, snapshots
(first check per offer per day wins), the jobs' stop/error behavior, the API and pages, Watch/Today
forwarding, account export/deletion and the shared discovery artifacts. `VERBOSE=1` shows each file's
output.

## Conventions and pitfalls

- CommonJS, 4-space indent, single quotes, semicolons; no linter. Paths and domain logic stay in
  `server/domain/` so a parser is testable without HTTP.
- **Prices are all-in** (price + stated shipping); keep currency and the source's own check time, and
  mark a stale offer rather than hiding it.
- **The first snapshot of an offer per day wins** (unique key); do not overwrite history.
- **Cite or say "not known yet":** never invent a spec, fit note or release date; a parser that
  cannot read a date leaves it out.
- **Respect the source rules:** Deals public pages, eBay's official API only with keys, official
  release pages; no scraping of Marketplace or Facebook, no affiliate URLs.
- New environment variables go in `.env.example` and the README list; secrets live only in
  `/etc/openvibe/shoes.env`.
