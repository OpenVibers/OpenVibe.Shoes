'use strict';

/**
 * Shoes' catalogue: the models, the offers on them, the price history, the size-price curve, the drops, the cited
 * facts and a person's watches. Everything the pages and the API show is read here; nothing is computed in the view.
 *
 * The rules that matter:
 *   - an offer keeps the time its source was checked (checked_at) and a stale flag (older than the hours allowed);
 *   - the price history keeps ONE snapshot per offer per day: the first check of that day wins, so a busy store
 *     cannot invent a curve by being checked often;
 *   - the all-in price is the price plus the shipping when the store states shipping, and the wire says whether
 *     the shipping was known;
 *   - a "drop" is a real saving the source stated (its list price against its current all-in price) or the fall
 *     between two of our own daily snapshots. It is never a made-up number;
 *   - a model is a brand and a model name; the page is /shoe/<brand>-<model>.
 */
const crypto = require('crypto');
const parse = require('./domain/parse');

const iso = (v) => (v == null ? null : (v instanceof Date ? v.toISOString() : String(v)));
const num = (v) => (v == null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const money = (v) => (v == null ? null : Math.round(Number(v) * 100) / 100);

/** The wire form of an offer: what the source said, and when. */
function wireOffer(row, { staleHours = 48, now = Date.now() } = {}) {
    if (!row) return null;
    const price = num(row.price_amount);
    const shipping = num(row.shipping_amount);
    const list = num(row.list_price_amount);
    const all = parse.allIn(price, shipping);
    const drop = list != null && all.amount != null ? money(list - all.amount) : null;
    return {
        id: row.id,
        model_id: row.model_id,
        slug: row.slug || null,
        store: row.store_domain,
        store_name: row.store_name || null,
        title: row.title,
        url: row.url,
        price,
        list_price: list,
        shipping,
        shipping_known: shipping != null,
        all_in: all.amount,
        drop_from_list: drop != null && drop > 0 ? drop : null,
        currency: row.currency || 'USD',
        condition: row.condition || null,
        size: row.size || null,
        colourway: row.colourway || null,
        checked_at: iso(row.checked_at),
        stale: row.stale === true || parse.isStale(row.checked_at, now, staleHours),
        source: row.source,
    };
}

/** The wire form of a model with its numbers. */
function wireModel(row, { now = Date.now() } = {}) {
    if (!row) return null;
    const priceMin = num(row.price_min);
    const priceMax = num(row.price_max);
    const drop = num(row.drop_amount);
    return {
        id: row.id,
        slug: row.slug,
        brand: row.brand,
        model: row.model,
        name: row.name,
        price_min: priceMin,
        price_max: priceMax,
        offer_count: Number(row.offer_count) || 0,
        store_count: Number(row.store_count) || 0,
        stale_count: Number(row.stale_count) || 0,
        checked_at: iso(row.checked_at),
        drop_amount: drop != null && drop > 0 ? drop : null,
        drop_percent: row.drop_percent != null ? num(row.drop_percent) : (drop != null && row.price_max != null && Number(row.price_max) > 0 ? Math.round((drop / (Number(row.price_max) + drop)) * 10000) / 100 : null),
        first_seen_at: iso(row.first_seen_at),
        updated_at: iso(row.updated_at),
    };
}

function wireDrop(row) {
    if (!row) return null;
    let sizes = row.sizes;
    if (typeof sizes === 'string') { try { sizes = JSON.parse(sizes); } catch { sizes = []; } }
    return {
        id: row.id,
        slug: row.slug,
        brand: row.brand,
        model: row.model,
        colourway: row.colourway || null,
        release_at: iso(row.release_at),
        price: num(row.price_amount),
        currency: row.currency || 'USD',
        sizes: Array.isArray(sizes) ? sizes.map(String) : [],
        source_name: row.source_name,
        source_url: row.source_url,
        fetched_at: iso(row.fetched_at),
    };
}

function wireWatch(row) {
    if (!row) return null;
    return {
        id: row.id,
        kind: row.kind,
        slug: row.slug || row.model_slug || null,
        size: row.size || null,
        condition: row.condition || null,
        threshold: num(row.threshold_amount),
        currency: row.currency || 'USD',
        source_url: row.source_url || null,
        remote_id: row.remote_id || null,
        status: row.status,
        note: row.note || null,
        created_at: iso(row.created_at),
    };
}

function shortHash(value) {
    return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 6);
}

function createCatalogue(s, { staleHours = 48 } = {}) {
    const db = s.db;
    const nowMs = () => s.now();

    /** The model for a brand and a model name; it is created the first time it is seen. */
    async function ensureModel({ brand, model, name }) {
        const b = parse.cleanName(brand, 80);
        const m = parse.cleanName(model, 120);
        if (!b || !m) return null;
        const slug = parse.slugFor(b, m);
        if (!slug) return null;
        const existing = await db.maybe('SELECT * FROM shoe_models WHERE slug = $1', [slug]);
        if (existing) return existing;
        try {
            return await db.one(
                `INSERT INTO shoe_models (id, slug, brand, model, name, first_seen_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $6::timestamptz)
                 ON CONFLICT (slug) DO UPDATE SET updated_at = EXCLUDED.updated_at
                 RETURNING *`,
                [s.newId('shm'), slug, b, m, parse.cleanName(name || m, 120), s.iso()],
            );
        } catch (err) {
            // A concurrent importer inserted the same model between the SELECT and the INSERT.
            const again = await db.maybe('SELECT * FROM shoe_models WHERE slug = $1', [slug]);
            if (again) return again;
            throw err;
        }
    }

    /**
     * One offer from a source. The model is created from the product name and the source's brand; the snapshot for
     * today is written only when there is none yet (one per offer per day).
     */
    async function upsertOffer(input) {
        const title = parse.cleanName(input.title, 200);
        if (!title) return null;
        const modelTitle = parse.cleanName(input.modelName || title, 200);
        const brand = parse.brandOf(modelTitle, input.brand);
        const model = parse.modelOf(modelTitle, brand);
        if (!brand || !model) return null;
        const modelRow = await ensureModel({ brand, model, name: modelTitle });
        if (!modelRow) return null;

        const price = parse.amountOf(input.price);
        const listPrice = parse.amountOf(input.listPrice);
        const shipping = parse.amountOf(input.shipping);
        const checkedAt = input.checkedAt instanceof Date ? input.checkedAt : new Date(input.checkedAt || s.now());
        if (Number.isNaN(checkedAt.getTime())) return null;
        const condition = parse.conditionOf(input.condition);
        const size = parse.cleanSize(input.size || parse.sizeOf(title));
        const stale = parse.isStale(checkedAt, nowMs(), staleHours);
        const sourceId = String(input.sourceId || '').trim();
        if (!sourceId) return null;
        const url = String(input.url || '');
        if (!/^https?:\/\//i.test(url)) return null;
        const store = String(input.store || '').toLowerCase().slice(0, 120);
        if (!store) return null;

        const row = await db.one(
            `INSERT INTO shoe_offers
               (id, model_id, source, source_id, store_domain, store_name, title, url, price_amount, list_price_amount,
                currency, shipping_amount, condition, size, colourway, checked_at, stale, active, raw, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::timestamptz, $17, true, $18::jsonb, $19::timestamptz, $19::timestamptz)
             ON CONFLICT (source, source_id) DO UPDATE SET
               model_id = EXCLUDED.model_id, store_name = EXCLUDED.store_name, title = EXCLUDED.title, url = EXCLUDED.url,
               price_amount = EXCLUDED.price_amount, list_price_amount = EXCLUDED.list_price_amount,
               currency = EXCLUDED.currency, shipping_amount = EXCLUDED.shipping_amount,
               condition = EXCLUDED.condition, size = EXCLUDED.size, colourway = EXCLUDED.colourway,
               checked_at = EXCLUDED.checked_at, stale = EXCLUDED.stale, active = true, raw = EXCLUDED.raw,
               updated_at = EXCLUDED.updated_at
             RETURNING *`,
            [
                s.newId('sho'), modelRow.id, String(input.source || 'deals'), sourceId, store,
                input.storeName || null, title, url, price, listPrice, String(input.currency || 'USD'), shipping,
                condition, size, parse.cleanName(input.colourway, 60) || null,
                checkedAt.toISOString(), stale, JSON.stringify(input.raw || {}), s.iso(),
            ],
        );
        if (!row) return null;
        await writeSnapshot(row, price, checkedAt);
        return row;
    }

    /** One snapshot per offer per day: the first check of that day wins. */
    async function writeSnapshot(offer, price, checkedAt) {
        const day = parse.dayOf(checkedAt);
        if (!day) return null;
        return await db.maybe(
            `INSERT INTO shoe_snapshots (id, offer_id, model_id, price_amount, shipping_amount, checked_at, day, created_at)
             VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::date, $8::timestamptz)
             ON CONFLICT (offer_id, day) DO NOTHING
             RETURNING *`,
            [s.newId('shs'), offer.id, offer.model_id, price, num(offer.shipping_amount), checkedAt.toISOString(), day, s.iso()],
        );
    }

    /** The models, with their numbers: the filters, the sort and the facets. */
    async function listShoes({ q = null, brand = null, size = null, condition = null, store = null, sort = 'recent', limit = 24, offset = 0 } = {}) {
        const args = [];
        const where = [];
        if (q) {
            args.push(`%${String(q).trim()}%`);
            where.push(`(m.name ILIKE $${args.length} OR m.brand ILIKE $${args.length} OR m.model ILIKE $${args.length})`);
        }
        if (brand) { args.push(String(brand)); where.push(`m.brand = $${args.length}`); }
        if (size) {
            args.push(String(size));
            where.push(`EXISTS (SELECT 1 FROM shoe_offers o WHERE o.model_id = m.id AND o.active AND o.size = $${args.length})`);
        }
        if (condition) {
            args.push(String(condition));
            where.push(`EXISTS (SELECT 1 FROM shoe_offers o WHERE o.model_id = m.id AND o.active AND o.condition = $${args.length})`);
        }
        if (store) {
            args.push(String(store));
            where.push(`EXISTS (SELECT 1 FROM shoe_offers o WHERE o.model_id = m.id AND o.active AND o.store_domain = $${args.length})`);
        }
        const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const order = {
            price: 'price_min ASC NULLS LAST, m.name ASC',
            price_desc: 'price_max DESC NULLS LAST, m.name ASC',
            recent: 'checked_at DESC NULLS LAST, m.name ASC',
            drop: 'drop_amount DESC NULLS LAST, checked_at DESC NULLS LAST',
            popular: 'offer_count DESC NULLS LAST, checked_at DESC NULLS LAST',
            name: 'm.brand ASC, m.model ASC',
        }[sort] || 'checked_at DESC NULLS LAST, m.name ASC';
        const staleParam = args.length + 1;
        args.push(staleHours);
        const limitParam = args.length + 1;
        args.push(Math.max(1, Math.min(100, limit)));
        const offsetParam = args.length + 1;
        args.push(Math.max(0, offset));
        const rows = await db.many(
            `SELECT m.*,
               (SELECT MIN(o.price_amount + COALESCE(o.shipping_amount, 0)) FROM shoe_offers o WHERE o.model_id = m.id AND o.active AND o.price_amount IS NOT NULL) AS price_min,
               (SELECT MAX(o.price_amount + COALESCE(o.shipping_amount, 0)) FROM shoe_offers o WHERE o.model_id = m.id AND o.active AND o.price_amount IS NOT NULL) AS price_max,
               (SELECT COUNT(*)::int FROM shoe_offers o WHERE o.model_id = m.id AND o.active) AS offer_count,
               (SELECT COUNT(DISTINCT o.store_domain)::int FROM shoe_offers o WHERE o.model_id = m.id AND o.active) AS store_count,
               (SELECT COUNT(*) FILTER (WHERE o.stale OR o.checked_at < now() - ($${staleParam} || ' hours')::interval)::int FROM shoe_offers o WHERE o.model_id = m.id AND o.active) AS stale_count,
               (SELECT MAX(o.checked_at) FROM shoe_offers o WHERE o.model_id = m.id AND o.active) AS checked_at,
               (SELECT MAX(GREATEST(
                  COALESCE(o.list_price_amount - (o.price_amount + COALESCE(o.shipping_amount, 0)), 0),
                  COALESCE((
                    SELECT x.prev_price - x.price_amount
                    FROM (
                      SELECT s.price_amount, LAG(s.price_amount) OVER (ORDER BY s.day) AS prev_price,
                             ROW_NUMBER() OVER (ORDER BY s.day DESC) AS rn
                      FROM shoe_snapshots s WHERE s.offer_id = o.id
                    ) x WHERE x.rn = 1
                  ), 0)
                )) FROM shoe_offers o WHERE o.model_id = m.id AND o.active AND o.price_amount IS NOT NULL) AS drop_amount
             FROM shoe_models m
             ${clause}
             ORDER BY ${order}
             LIMIT $${limitParam} OFFSET $${offsetParam}`,
            args,
        );
        return rows.map((r) => wireModel(r, { now: nowMs() }));
    }

    /** How many models the same filters match, for a page's "next" link. */
    async function countShoes({ q = null, brand = null, size = null, condition = null, store = null } = {}) {
        const args = [];
        const where = [];
        if (q) {
            args.push(`%${String(q).trim()}%`);
            where.push(`(m.name ILIKE $${args.length} OR m.brand ILIKE $${args.length} OR m.model ILIKE $${args.length})`);
        }
        if (brand) { args.push(String(brand)); where.push(`m.brand = $${args.length}`); }
        if (size) { args.push(String(size)); where.push(`EXISTS (SELECT 1 FROM shoe_offers o WHERE o.model_id = m.id AND o.active AND o.size = $${args.length})`); }
        if (condition) { args.push(String(condition)); where.push(`EXISTS (SELECT 1 FROM shoe_offers o WHERE o.model_id = m.id AND o.active AND o.condition = $${args.length})`); }
        if (store) { args.push(String(store)); where.push(`EXISTS (SELECT 1 FROM shoe_offers o WHERE o.model_id = m.id AND o.active AND o.store_domain = $${args.length})`); }
        const row = await db.one(`SELECT COUNT(*)::int AS n FROM shoe_models m ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`, args);
        return Number(row && row.n) || 0;
    }

    /** The facets of the whole catalogue: the brands, the sizes, the conditions, the stores and the price range. */
    async function facets() {
        const [brands, sizes, conditions, stores, prices, checked, counts] = await Promise.all([
            db.many('SELECT m.brand AS value, COUNT(DISTINCT m.id)::int AS count FROM shoe_models m GROUP BY m.brand ORDER BY count DESC, value ASC'),
            db.many('SELECT o.size AS value, COUNT(*)::int AS count FROM shoe_offers o WHERE o.active AND o.size IS NOT NULL GROUP BY o.size ORDER BY count DESC, value ASC'),
            db.many('SELECT o.condition AS value, COUNT(*)::int AS count FROM shoe_offers o WHERE o.active AND o.condition IS NOT NULL GROUP BY o.condition ORDER BY count DESC, value ASC'),
            db.many('SELECT o.store_domain AS value, COUNT(*)::int AS count FROM shoe_offers o WHERE o.active GROUP BY o.store_domain ORDER BY count DESC, value ASC'),
            db.many('SELECT MIN(o.price_amount) AS min, MAX(o.price_amount) AS max FROM shoe_offers o WHERE o.active AND o.price_amount IS NOT NULL'),
            db.many('SELECT (SELECT MAX(x.checked_at) FROM shoe_offers x WHERE x.active) AS checked_at, COUNT(*) FILTER (WHERE o.stale OR o.checked_at < now() - ($1 || \' hours\')::interval)::int AS stale FROM shoe_offers o WHERE o.active', [staleHours]),
            db.many('SELECT (SELECT COUNT(*)::int FROM shoe_models) AS models, (SELECT COUNT(*)::int FROM shoe_offers WHERE active) AS offers, (SELECT COUNT(*)::int FROM shoe_drops WHERE release_at > now()) AS drops'),
        ]);
        const c = counts[0] || { models: 0, offers: 0, drops: 0 };
        return {
            brands: brands.map((b) => ({ value: b.value, count: Number(b.count) || 0 })),
            sizes: sizes.map((b) => ({ value: b.value, count: Number(b.count) || 0 })),
            conditions: conditions.map((b) => ({ value: b.value, count: Number(b.count) || 0 })),
            stores: stores.map((b) => ({ value: b.value, count: Number(b.count) || 0 })),
            price_min: num(prices[0] ? prices[0].min : null),
            price_max: num(prices[0] ? prices[0].max : null),
            checked_at: checked[0] ? iso(checked[0].checked_at) : null,
            stale_offers: Number(checked[0] ? checked[0].stale : 0) || 0,
            models: Number(c.models) || 0,
            offers: Number(c.offers) || 0,
            drops: Number(c.drops) || 0,
        };
    }

    /** One model. */
    async function modelBySlug(slug) {
        return (await db.maybe('SELECT * FROM shoe_models WHERE slug = $1', [String(slug || '')])) || null;
    }

    async function modelById(id) {
        if (!id) return null;
        return (await db.maybe('SELECT * FROM shoe_models WHERE id = $1', [String(id)])) || null;
    }

    /** The offers of a model, cheapest all-in first. */
    async function offersOf(modelId) {
        const rows = await db.many(
            `SELECT o.*, m.slug FROM shoe_offers o JOIN shoe_models m ON m.id = o.model_id
             WHERE o.model_id = $1 AND o.active
             ORDER BY (o.price_amount + COALESCE(o.shipping_amount, 0)) ASC NULLS LAST, o.checked_at DESC`,
            [modelId],
        );
        return rows.map((r) => wireOffer(r, { staleHours, now: nowMs() }));
    }

    /** The price history of a model: one point per day, the lowest all-in price of that day. */
    async function history(modelId, { days = 90 } = {}) {
        const rows = await db.many(
            `SELECT s.day, MIN(s.price_amount + COALESCE(s.shipping_amount, 0)) AS price, COUNT(*)::int AS offers, MAX(s.checked_at) AS checked_at
             FROM shoe_snapshots s
             WHERE s.model_id = $1 AND s.price_amount IS NOT NULL
               AND s.day >= (CURRENT_DATE - ($2::int || ' days')::interval)
             GROUP BY s.day ORDER BY s.day ASC`,
            [modelId, Math.max(1, Math.min(365, days))],
        );
        return rows.map((r) => ({
            day: iso(r.day).slice(0, 10),
            price: num(r.price),
            offers: Number(r.offers) || 0,
            checked_at: iso(r.checked_at),
        }));
    }

    /** The size-price curve: the lowest all-in price per size, and what it costs against the model's middle. */
    async function curve(modelId) {
        const rows = await db.many(
            `SELECT o.size AS size,
                    MIN(o.price_amount + COALESCE(o.shipping_amount, 0)) AS min_price,
                    AVG(o.price_amount + COALESCE(o.shipping_amount, 0)) AS avg_price,
                    COUNT(*)::int AS offers,
                    COUNT(DISTINCT o.store_domain)::int AS stores,
                    MAX(o.checked_at) AS checked_at
             FROM shoe_offers o
             WHERE o.model_id = $1 AND o.active AND o.size IS NOT NULL AND o.price_amount IS NOT NULL
             GROUP BY o.size`,
            [modelId],
        );
        const points = rows.map((r) => ({
            size: r.size,
            min_price: num(r.min_price),
            avg_price: num(r.avg_price),
            offers: Number(r.offers) || 0,
            stores: Number(r.stores) || 0,
            checked_at: iso(r.checked_at),
        })).sort((a, b) => a.size.localeCompare(b.size, 'en', { numeric: true }));
        if (!points.length) return { points: [], median: null };
        const prices = points.map((p) => p.min_price).filter((p) => p != null).sort((a, b) => a - b);
        const mid = prices.length ? prices[Math.floor((prices.length - 1) / 2)] : null;
        return {
            points: points.map((p) => ({
                ...p,
                vs_median_percent: mid && p.min_price != null ? Math.round((p.min_price - mid) * 10000) / 100 : null,
            })),
            median: mid,
        };
    }

    /** The drops, soonest first. */
    async function listDrops({ from = null, to = null, limit = 60 } = {}) {
        const args = [];
        const where = [];
        if (from) { args.push(new Date(from).toISOString()); where.push(`d.release_at >= $${args.length}::timestamptz`); }
        if (to) { args.push(new Date(to).toISOString()); where.push(`d.release_at <= $${args.length}::timestamptz`); }
        const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
        args.push(Math.max(1, Math.min(200, limit)));
        const rows = await db.many(`SELECT d.* FROM shoe_drops d ${clause} ORDER BY d.release_at ASC LIMIT $${args.length}`, args);
        return rows.map(wireDrop);
    }

    /** The drops a source published in the last read, and one of them by its page id. */
    async function dropById(id) {
        const row = await db.maybe('SELECT * FROM shoe_drops WHERE id = $1', [String(id || '')]);
        return row ? wireDrop(row) : null;
    }

    /** The official releases that match a model, soonest first (a cited release date on its page). */
    async function dropsForModel(model, { limit = 5 } = {}) {
        if (!model) return [];
        const rows = await db.many(
            `SELECT * FROM shoe_drops
             WHERE lower(brand) = lower($1) AND lower(model) = lower($2)
               AND release_at >= now() - interval '1 day'
             ORDER BY release_at ASC LIMIT $3`,
            [model.brand, model.model, Math.max(1, Math.min(20, limit))],
        );
        return rows.map(wireDrop);
    }

    /** One drop from an official release page. */
    async function upsertDrop(input) {
        const brand = parse.cleanName(input.brand, 80);
        const model = parse.cleanName(input.model, 120);
        if (!brand || !model) return null;
        const sourceKey = String(input.sourceKey || '').trim();
        if (!sourceKey) return null;
        const sourceUrl = String(input.sourceUrl || '');
        if (!/^https?:\/\//i.test(sourceUrl)) return null;
        const base = parse.slugFor(brand, `${model} ${input.colourway || ''}`) || parse.slugFor(brand, model);
        const slug = `${base.slice(0, 72)}-${shortHash(sourceKey)}`.slice(0, 80).replace(/-$/, '');
        const row = await db.one(
            `INSERT INTO shoe_drops
               (id, slug, brand, model, colourway, release_at, price_amount, currency, sizes, source_name, source_url, source_key, fetched_at, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7, $8, $9::jsonb, $10, $11, $12, $13::timestamptz, $14::timestamptz, $14::timestamptz)
             ON CONFLICT (source_name, source_key) DO UPDATE SET
               release_at = EXCLUDED.release_at, price_amount = EXCLUDED.price_amount, currency = EXCLUDED.currency,
               sizes = EXCLUDED.sizes, colourway = EXCLUDED.colourway, source_url = EXCLUDED.source_url,
               fetched_at = EXCLUDED.fetched_at, updated_at = EXCLUDED.updated_at
             RETURNING *`,
            [
                s.newId('shd'), slug, brand, model, parse.cleanName(input.colourway, 60) || null,
                new Date(input.releaseAt).toISOString(), parse.amountOf(input.price), String(input.currency || 'USD'),
                JSON.stringify(Array.isArray(input.sizes) ? input.sizes : []),
                String(input.sourceName || 'official release page'), sourceUrl, sourceKey,
                new Date(input.fetchedAt || s.now()).toISOString(), s.iso(),
            ],
        );
        return row ? wireDrop(row) : null;
    }

    /** A cited fact on a model. Only a source's own words; no fact without its URL. */
    async function addFact({ modelId, kind, label, value, sourceName, sourceUrl, fetchedAt }) {
        const k = String(kind || '');
        if (!['specs', 'fit', 'release', 'care'].includes(k)) return null;
        if (!/^https?:\/\//i.test(String(sourceUrl || ''))) return null;
        const row = await db.one(
            `INSERT INTO shoe_facts (id, model_id, kind, label, value, source_name, source_url, fetched_at, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9::timestamptz) RETURNING *`,
            [s.newId('shf'), modelId, k, parse.cleanName(label, 80), String(value).slice(0, 500),
                parse.cleanName(sourceName, 120), sourceUrl, new Date(fetchedAt || s.now()).toISOString(), s.iso()],
        );
        return row || null;
    }

    async function factsOf(modelId) {
        const rows = await db.many('SELECT * FROM shoe_facts WHERE model_id = $1 ORDER BY kind ASC, label ASC', [modelId]);
        return rows.map((r) => ({
            kind: r.kind, label: r.label, value: r.value,
            source_name: r.source_name, source_url: r.source_url, fetched_at: iso(r.fetched_at),
        }));
    }

    /** A person's watch: the price watch or the pasted listing. */
    async function createWatch(input) {
        const row = await db.one(
            `INSERT INTO shoe_watches
               (id, subject, kind, model_id, slug, size, condition, threshold_amount, currency, source_url, remote_id, status, note, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::timestamptz, $14::timestamptz)
             RETURNING *`,
            [
                s.newId('shw'), String(input.subject), String(input.kind), input.modelId || null, input.slug || null,
                input.size || null, input.condition || null, parse.amountOf(input.threshold), String(input.currency || 'USD'),
                input.sourceUrl || null, input.remoteId || null, String(input.status || 'active'), input.note || null, s.iso(),
            ],
        );
        return wireWatch(row);
    }

    /** A person's watches, newest first. */
    async function listWatches(subject) {
        const rows = await db.many(
            `SELECT w.*, m.slug AS model_slug FROM shoe_watches w
             LEFT JOIN shoe_models m ON m.id = w.model_id
             WHERE w.subject = $1 ORDER BY w.created_at DESC`,
            [String(subject)],
        );
        return rows.map(wireWatch);
    }

    /** The lowest all-in price for a model, optionally for one size, condition and store (the price a Watch reads). */
    async function priceFor(modelId, { size = null, condition = null } = {}) {
        const args = [modelId];
        const where = ['o.model_id = $1', 'o.active', 'o.price_amount IS NOT NULL'];
        if (size) { args.push(String(size)); where.push(`o.size = $${args.length}`); }
        if (condition) { args.push(String(condition)); where.push(`o.condition = $${args.length}`); }
        const row = await db.one(
            `SELECT MIN(o.price_amount + COALESCE(o.shipping_amount, 0)) AS all_in,
                    MAX(o.checked_at) AS checked_at, COUNT(*)::int AS offers
             FROM shoe_offers o WHERE ${where.join(' AND ')}`,
            args,
        );
        return { price: num(row && row.all_in), checked_at: row ? iso(row.checked_at) : null, offers: Number((row && row.offers) || 0) };
    }

    /** Record what a job did; the pages and /api/ready use it for an honest "last checked". */
    async function startJobRun({ job, sourceName, sourceUrl }) {
        const row = await db.one(
            `INSERT INTO shoe_job_runs (job, source_name, source_url, started_at)
             VALUES ($1, $2, $3, $4::timestamptz) RETURNING id`,
            [String(job), String(sourceName || job), sourceUrl || null, s.iso()],
        );
        return row ? row.id : null;
    }
    async function finishJobRun(id, { ok = true, counts = {}, error = null } = {}) {
        if (id == null) return;
        await db.exec(
            `UPDATE shoe_job_runs SET finished_at = $1::timestamptz, ok = $2, counts = $3::jsonb, error = $4 WHERE id = $5`,
            [s.iso(), !!ok, JSON.stringify(counts || {}), error ? String(error).slice(0, 500) : null, id],
        );
    }
    async function lastJobRuns() {
        const rows = await db.many(
            `SELECT DISTINCT ON (job) job, source_name, source_url, started_at, finished_at, ok, counts, error
             FROM shoe_job_runs ORDER BY job, started_at DESC`,
        );
        return rows.map((r) => ({
            job: r.job, source_name: r.source_name, source_url: r.source_url,
            started_at: iso(r.started_at), finished_at: iso(r.finished_at), ok: r.ok,
            counts: typeof r.counts === 'string' ? JSON.parse(r.counts) : r.counts, error: r.error || null,
        }));
    }

    /** The number of rows a table holds (the seed report and the tests). */
    async function counts() {
        const row = await db.one(
            `SELECT (SELECT COUNT(*)::int FROM shoe_models) AS models,
                    (SELECT COUNT(*)::int FROM shoe_offers) AS offers,
                    (SELECT COUNT(*)::int FROM shoe_snapshots) AS snapshots,
                    (SELECT COUNT(*)::int FROM shoe_drops) AS drops,
                    (SELECT COUNT(*)::int FROM shoe_watches) AS watches,
                    (SELECT COUNT(*)::int FROM shoe_facts) AS facts`,
        );
        return {
            models: Number(row.models) || 0,
            offers: Number(row.offers) || 0,
            snapshots: Number(row.snapshots) || 0,
            drops: Number(row.drops) || 0,
            watches: Number(row.watches) || 0,
            facts: Number(row.facts) || 0,
        };
    }

    return {
        ensureModel, upsertOffer, writeSnapshot, listShoes, countShoes, facets, modelBySlug, modelById, offersOf, history,
        curve, listDrops, dropById, dropsForModel, upsertDrop, addFact, factsOf, createWatch, listWatches, priceFor,
        startJobRun, finishJobRun, lastJobRuns, counts, wireOffer, wireModel, wireDrop, wireWatch,
    };
}

module.exports = { createCatalogue, wireOffer, wireModel, wireDrop, wireWatch };
