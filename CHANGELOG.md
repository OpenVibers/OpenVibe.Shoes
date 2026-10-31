# Changelog

What changed in OpenVibe.Shoes, newest first.

## 0.1.0 — 2026-10-31

The first version: every shoe, every market, the right price.

- **Models and offers.** `shoe_models` and `shoe_offers`: one page per model (`/shoe/<brand>-<model>`), every
  store's offer with price, shipping, list price, condition, size and colourway when the source names them, the
  source's own check time and a stale flag. The all-in price is price + shipping when shipping is stated.
- **The offers job.** Every 30 minutes (off under `SHOES_DRILL`) it reads OpenVibe.Deals' public newest offers,
  keeps the footwear (a footwear word or a model only a shoe has), reads each product's public record for its
  brand, and writes the offers into Shoes' own catalogue. One snapshot per offer per day.
- **The shoe page.** Current prices by store, the price history drawn from Shoes' own snapshots, the size-price
  curve where sizes are known, colourways, and cited specs/fit/release/care — or "not known yet".
- **The drops job.** The official release calendar (Nike SNKRS by default) and optional RSS feeds, parsed by a
  pure parser that never invents a date; each release keeps its source page and read time.
- **Watches.** A price watch at a size (`POST /api/v1/me/watches`) and a pasted listing link
  (`POST /api/v1/me/track`) are created in OpenVibe.Watch with the person in `X-OV-Subject`; a pasted URL goes
  through `openvibe-shared/egress` first. Without a service token the watch is saved and marked "not connected".
- **Today.** A drop reminder goes on the person's own Today agenda with their Network token. Raffles are never
  automated.
- **The API.** Search with facets, one model with offers/history/curve/facts, the price a Watch polls, drops, the
  person's watches and a pasted link, the source status, and an OpenAPI 3.1 document.
- **The home.** `sc.room`: hero, live proof, the biggest price drops today, dropping this week, popular models,
  three scenes (a size-price curve, a drop reminder on Today, a pasted Marketplace link), explore, developers,
  questions, and the rest of OpenVibe.
- **Account data.** A person's watches are exported and deleted with their account; the catalogue is the
  network's public record.
- **No affiliate links, no Marketplace scraping, no invented specs.**
