'use strict';

/**
 * open.shoes' model pages in OpenVibe.Search (openvibe-publishing/search-feed, contracts 0.273.0): one
 * search.index-document@1 per shoe model (/shoe/<slug>, the slug as the id), sent as shoes.index_document.upserted|deleted
 * through this service's events outbox. The document is what the page says: the model's name and brand, the lowest
 * all-in price seen today (in dollars, the way the page shows it) and how many stores sell it. A network search for a
 * shoe found deals and coupons but never the one page with every store's price (2026-11-02).
 *
 * A model with no live offer is a thin page, kept in Search but noindex; a model that left the catalogue gets a
 * tombstone (exists()). The catalogue is small (199 models on 2026-11-02) and its prices move through the day, so a
 * sweep a minute after boot and every six hours is enough: the sequencer (shoes_index_revisions) gives an unchanged
 * document its old revision, and a quiet sweep sends nothing. Off under SHOES_DRILL.
 */
const { createServiceOutbox } = require('openvibe-sdk/events');
const { createSearchFeed } = require('openvibe-publishing/search-feed');

const EVENT_TYPES = ['shoes.index_document.upserted', 'shoes.index_document.deleted'];
const START_DELAY_MS = 60_000;
const INTERVAL_MS = 6 * 3_600_000;

const dollars = (n) => (n == null || !Number.isFinite(Number(n)) ? null : `$${Math.round(Number(n)).toLocaleString('en-US')}`);
const iso = (t) => (t ? new Date(t).toISOString() : null);

/** One model row (with its live offers' figures) → what its page says, as search-feed's document description. */
function describe(row) {
    const stores = Number(row.store_count) || 0;
    const from = dollars(row.price_min);
    const where = stores ? `${stores} store${stores === 1 ? '' : 's'}` : null;
    const price = from && where ? `From ${from} at ${where} today.` : where ? `Sold at ${where} today.` : 'No store lists it right now.';
    return {
        listed: true,
        noindex: !stores,
        title: row.name,
        summary: `${row.name} by ${row.brand}. ${price} Every store's price, the price history and the size curve on open.shoes.`,
        body: [row.name, row.brand, row.model, price].filter(Boolean).join('\n'),
        facets: { brand: row.brand, stores, ...(row.price_min != null ? { lowest_price: Math.round(Number(row.price_min)) } : {}) },
        authorship: { mode: 'imported' },
        publishedAt: iso(row.first_seen_at),
        updatedAt: iso(row.checked_at || row.updated_at),
    };
}

function createSearchIndex({ config, s, log = console, outbox = null }) {
    const db = s.db;
    const out = outbox || createServiceOutbox({
        db, source: 'shoes', eventsUrl: config.events.url || null, networkInternalUrl: config.networkInternalUrl,
        clientId: config.oauth.clientId, clientSecret: config.oauth.clientSecret, log, eventTypes: EVENT_TYPES,
    });
    // The page is /shoe/<slug>, so the slug is the document's id: rows come back keyed by it, in slug order.
    const rows = async (after, limit) => db.many(
        `SELECT m.slug AS id, m.name, m.brand, m.model, m.first_seen_at, m.updated_at,
                (SELECT MIN(o.price_amount + COALESCE(o.shipping_amount, 0)) FROM shoe_offers o
                  WHERE o.model_id = m.id AND o.active AND o.price_amount IS NOT NULL AND o.currency = 'USD') AS price_min,
                (SELECT COUNT(DISTINCT o.store_domain)::int FROM shoe_offers o WHERE o.model_id = m.id AND o.active) AS store_count,
                (SELECT MAX(o.checked_at) FROM shoe_offers o WHERE o.model_id = m.id AND o.active) AS checked_at
           FROM shoe_models m WHERE m.slug > $1 ORDER BY m.slug LIMIT $2`,
        [String(after || ''), limit],
    );
    const feed = createSearchFeed({
        owner: 'shoes', db, outbox: out, baseUrl: config.baseUrl, now: s.now, log,
        types: {
            shoe: {
                page: (row) => `/shoe/${row.id}`,
                document: describe,
                rows,
                exists: async (ids) => (ids.length ? (await db.many('SELECT slug FROM shoe_models WHERE slug = ANY($1::text[])', [ids])).map((r) => r.slug) : []),
            },
        },
    });
    const timers = [];

    async function sweep() {
        const res = await feed.sweep();
        const r = res.shoe;
        if (r.sent || r.removed || r.failed) log.log(`[Search] shoe models: ${r.sent} sent, ${r.removed} removed, ${r.failed} failed of ${r.seen}`);
        if (out.kick) out.kick().catch(() => {});
        return res;
    }
    const quietly = () => { sweep().catch((err) => log.warn(`[Search] sweep failed: ${(err && err.message) || err}`)); };

    function start() {
        if (config.drill || timers.length) return false;
        out.start();
        const kick = setTimeout(quietly, START_DELAY_MS);
        if (kick.unref) kick.unref();
        const tick = setInterval(quietly, INTERVAL_MS);
        if (tick.unref) tick.unref();
        timers.push(kick, tick);
        return true;
    }

    function stop() {
        for (const t of timers.splice(0)) { clearTimeout(t); clearInterval(t); }
        out.stop();
    }

    return { feed, outbox: out, describe, sweep, start, stop, status: () => out.status() };
}

module.exports = { createSearchIndex, describe, EVENT_TYPES };
