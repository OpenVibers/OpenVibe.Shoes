# OpenVibe.Shoes

> Every shoe, every market, the right price.

**Status:** v1 written and tested (see [STATUS.json](STATUS.json)).
**Domain:** `open.shoes` · **Port:** 5180 · **Service id:** `shoes` · **Env prefix:** `SHOES`
**License:** AGPL-3.0-only (same as every OpenVibe service).

OpenVibe.Shoes is the network's shoe resource: one page per model (`/shoe/<brand>-<model>`) with every store's
offer in one all-in price, a price history from Shoes' own daily snapshots, the size-price curve where sizes are
known, and cited specs, fit notes, release facts and care notes — or an honest "not known yet". A person can ask
to be told when the model drops below a price at their size, or paste any listing link and have OpenVibe.Watch
keep it. Official release dates are a drops calendar with "remind me" on OpenVibe.Today. Shoes never enters a
raffle or a draw, never scrapes Facebook Marketplace, and carries no affiliate links.

## What it reads

| Source | What | Key |
|---|---|---|
| **OpenVibe.Deals** | the network's own offer aggregator: its public newest-offer pages and each product's public record (brand). No key. | no |
| **eBay Browse API** | official item summaries, only when a developer key pair is set | `SHOES_EBAY_CLIENT_ID` + `SHOES_EBAY_CLIENT_SECRET` |
| **A brand's or a store's own release page** | the official release calendar (Nike SNKRS by default), parsed by a pure parser that never invents a date | no |
| **OpenVibe.Watch** | a watch for a person, created with their own Network token | the person's session |
| **OpenVibe.Today** | a drop reminder on the person's own agenda (their Network token) | the person's session |

Every offer keeps its store, its currency, the price, the shipping the store stated, the condition, the size and
colourway when the source names them, the source's own check time and a stale flag. Every price is **all-in**:
price + shipping when shipping is stated. A missing key turns that part off with a plain note; it is never an
error. No source is a scrape: Deals reads stores through the network's sources, eBay is the official API, and a
pasted Marketplace link is handed to Watch, which applies its own fetch rules.

## Pages

| Route | What it shows |
|---|---|
| `/` | the room's front door: hero, live proof, the biggest price drops today, dropping this week, popular models, the three scenes (a size-price curve, a drop reminder on Today, a pasted link), explore, developers, questions |
| `/shoes?q=&brand=&size=&condition=&sort=&page=` | the catalogue with facets; every offer all-in and dated |
| `/shoe/:slug` | one model: offers by store, the daily price history (SVG from Shoes' own snapshots), the size-price curve, colourways, cited facts or "not known yet", and the watch form |
| `/drops` | the official release calendar, grouped by day, with "remind me" (on Today) and the never-automated-entries note |
| `/track` | paste a listing link; it becomes a Watch |
| `/watches` | a signed-in person's watches (private, no-store) |
| `/developers` | the API, sources and examples |
| `/api/openapi.json` | the OpenAPI 3.1 document |

All pages are server-rendered through `openvibe-shared/shell` and the room kit (`rooms.js`, `kit.card`,
`kit.rail`, `sc.room`), with the room id `shoes` and the accent `#FF7E76` (dark) / `#B02A2D` (light). Every page is
complete without JavaScript; forms are plain POSTs.

## API

Everything under `/api/v1`; errors are `application/problem+json` with a `code`. Public reads take no key.

| Route | Answer |
|---|---|
| `GET /api/v1/shoes?q&brand&size&condition&store&sort&page&limit` | `{ shoes, facets, page, per_page, total, sort, filters }`; sorts `recent`, `drop`, `price`, `price_desc`, `popular`, `name` |
| `GET /api/v1/shoes/:slug` | `{ shoe, offers, history, curve, facts, drops }` |
| `GET /api/v1/shoes/:slug/price?size=&condition=` | `{ slug, size, condition, price, currency, checked_at, offers }` — the URL a Watch polls |
| `GET /api/v1/drops?from&to` | `{ from, to, drops }`, soonest first |
| `GET /api/v1/drops/:id` | one drop |
| `GET /api/v1/me/watches` | session only: the person's watches |
| `POST /api/v1/me/watches` | session only: `{ slug, size?, condition?, threshold, currency? }` → a price watch in OpenVibe.Watch |
| `POST /api/v1/me/track` | session only: `{ url }` → a Watch for a pasted listing, through Watch's own rules |
| `GET /api/v1/status` | the last read of each source, the counts, and whether eBay/Watch are configured |
| `GET /api/openapi.json` | OpenAPI 3.1 |

A signed-in write made with the session cookie must come from `open.shoes` (`Sec-Fetch-Site: same-origin`, or an
`Origin` equal to the site): another site cannot set a watch for a visitor. A bad Bearer is refused, never
downgraded to the session or anonymous.

## Jobs (`server/jobs/*`)

Each refuses to start under `SHOES_DRILL=1`; tests and `scripts/seed.js` call their `runOnce()`.

| Job | Reads | Writes | Default |
|---|---|---|---|
| `offers` | OpenVibe.Deals' public newest offers, then each candidate's public product for its brand | a model, an offer with its all-in inputs, one snapshot per offer per day | every 30 min, 20 pages |
| `drops` | the official release calendar and any configured RSS feeds | a drop with its source page and read time | every 6 h |
| `ebay` | the official Browse API (only with a key pair) | an offer, the same as any other source | every 60 min, off without keys |

A job records each run in `shoe_job_runs` (source, start, finish, counts, error); `/api/v1/status` and the home FAQ
show it. The importer stops at the first page Deals answers empty, so a quiet source costs nothing.

## Database

PostgreSQL through `openvibe-sdk/db`, numbered migrations (`migrations/0001_initial.sql`). The tests use PGlite;
`npm run test:pg` runs the same suite through PgBouncer.

| Table | Holds |
|---|---|
| `shoe_models` | `shm_` + ULID, unique slug, brand, model, first seen |
| `shoe_offers` | `sho_` + ULID, source + source id (unique), store, title, URL, price, list price, shipping, condition, size, colourway, checked time, stale, raw public item |
| `shoe_snapshots` | `shs_` + ULID, offer, model, price, checked time, day — unique per offer per day (the first check wins) |
| `shoe_drops` | `shd_` + ULID, unique slug, release time, price, sizes, source name/URL/key, read time |
| `shoe_watches` | `shw_` + ULID, subject, kind `price\|link`, model, size, condition, threshold, source URL, remote Watch id, status, note |
| `shoe_facts` | cited specs/fit/release/care: kind, label, value, source name/URL, read time |
| `shoe_job_runs` | one row per job run: source, start, finish, ok, counts, error |
| `account_data_events`, `telemetry_samples` | the SDK's account receipts and request telemetry |

## Environment

Only names in code and docs; values live in `/etc/openvibe/shoes.env` (see [.env.example](.env.example)).

- **Service:** `NODE_ENV`, `PORT` (5180), `HOST`, `BASE_URL`, `TRUST_PROXY`, `COOKIE_SECURE`, `SHOES_DRILL`.
- **Database:** `DATABASE_URL`, `DATABASE_DIRECT_URL`, `SHOES_PGLITE_DIR`, `VALKEY_URL`, `VALKEY_PREFIX`.
- **Network:** `OV_NETWORK_URL`, `OV_NETWORK_INTERNAL_URL`, `OV_NETWORK_ISSUER`, `OV_OAUTH_CLIENT_ID`,
  `OV_OAUTH_CLIENT_SECRET`, `OV_OAUTH_REDIRECT_URI`, `OV_SESSION_AUDIENCE`, `SHOES_AUDIENCE`.
- **Events:** `SHOES_EVENTS_SECRET`, `SHOES_EVENTS_URL`, `SHOES_EVENTS_ENDPOINT`, `SHOES_EVENTS_INTERVAL_MS`.
- **Sources:** `SHOES_DEALS_URL`, `SHOES_OFFERS_PAGES`, `SHOES_PRODUCT_LOOKUPS`, `SHOES_STALE_HOURS`,
  `SHOES_UPSTREAM_TIMEOUT_MS`, `SHOES_REQUEST_GAP_MS`, `SHOES_DROPS_URL`, `SHOES_DROPS_SOURCE_NAME`, `SHOES_DROP_FEEDS`,
  `SHOES_EBAY_CLIENT_ID`, `SHOES_EBAY_CLIENT_SECRET`, `SHOES_EBAY_MARKETPLACE`, `SHOES_EBAY_CATEGORY_ID`,
  `SHOES_EBAY_LIMIT`.
- **Watch:** `SHOES_WATCH_URL`, `SHOES_WATCH_INTERNAL_URL`, `SHOES_WATCH_EVERY_SEC`.
- **Today:** `SHOES_TODAY_URL`, `SHOES_TODAY_INTERNAL_URL`.
- **Jobs:** `SHOES_OFFERS_INTERVAL_MS`, `SHOES_DROPS_INTERVAL_MS`, `SHOES_EBAY_INTERVAL_MS`.

## Run it

```bash
npm ci --include=dev
npm test                 # every unit and HTTP test on PGlite
npm run test:pg          # the same through PostgreSQL + PgBouncer
npm run seed             # one first run of every job against the live sources (needs the network)
npm start                # http://127.0.0.1:5180
```

Without `DATABASE_URL`, development uses an embedded PGlite database in `data/pglite` (one process only). A
production start needs `DATABASE_URL` and `DATABASE_DIRECT_URL`; the owner role migrates on boot.

## Deploy

Copy `deploy/systemd/openvibe-shoes.service` to `/etc/systemd/system/` and
`deploy/nginx/open.shoes.conf` to `/etc/nginx/sites-available/`; the unit reads `/etc/openvibe/shoes.env`, works in
`/opt/openvibe.shoes`, runs as `ubuntu:ubuntu` on `127.0.0.1:5180`, and the vhost proxies `/api/`, `/auth/` and the
forms with their own limits. The `.gitignore` keeps `node_modules`, `data`, `.env` and keys out of the repo.

## First run (seed)

`npm run seed` reads the live sources once and prints what it wrote. A source that does not answer is reported as
a plain note and does not fail the other jobs. The first local run (2026-10-31, 60 Deals pages) wrote:

| Source | Result |
|---|---|
| OpenVibe.Deals | 1,500 offers read, 182 footwear candidates, 165 product lookups, **178 offers** |
| Nike SNKRS launch calendar | **16 official releases** |
| eBay | off (no developer key pair) |
| **Catalogue** | **169 models · 178 offers · 178 daily snapshots · 16 drops · 0 facts** |

The same counts are in [STATUS.json](STATUS.json) under `seed`. The catalogue opens with real models and real
releases; the price history is one day deep and grows with every daily check, and the "biggest price drops today"
section says so plainly when no store has cut a price yet.

## What v1 does not do

- No raffle, draw, reservation or checkout is automated, ever; the drops calendar links the official page and
  adds a reminder on Today.
- Specs/fit/release/care are shown only from cited sources; with none, the page says "not known yet".
- eBay is off until the host sets a developer key pair; Watch is called with the signed-in person's own Network
  token (a session without one still saves the watch on Shoes, marked "not connected").
- No affiliate links, no sponsored order, no Marketplace scraping.

<!-- versions:start -->
- openvibe-contracts: v0.265.0
- openvibe-sdk: v0.70.0
- openvibe-shared: v4.76.0
<!-- versions:end -->
