'use strict';

const { KINDS } = require('./product-catalog');

function json(value, fallback = []) {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') { try { const out = JSON.parse(value); return Array.isArray(out) ? out : fallback; } catch { return fallback; } }
    return fallback;
}

function wireProduct(row) {
    return {
        id: row.slug, kind: row.kind, title: row.title, brand: row.brand || null, model: row.model || null,
        url: row.url || null, image: row.image || null, sizes: json(row.sizes), materials: json(row.materials), uses: json(row.uses),
        source: { name: row.source_name, url: row.source_url }, checked_at: row.checked_at instanceof Date ? row.checked_at.toISOString() : String(row.checked_at), facts: json(row.facts),
    };
}

function wireOffer(row) {
    const price = row.price_amount == null ? null : Number(row.price_amount);
    const shipping = row.shipping_amount == null ? null : Number(row.shipping_amount);
    return {
        id: row.id, product_id: row.product_slug, store: row.store_domain, store_name: row.store_name || null,
        title: row.title, url: row.url, price, shipping, shipping_known: shipping !== null,
        all_in: price == null ? null : Math.round((price + (shipping || 0)) * 100) / 100,
        currency: row.currency, size: row.size || null, condition: row.condition || null,
        checked_at: row.checked_at instanceof Date ? row.checked_at.toISOString() : String(row.checked_at), stale: row.stale === true, source: row.source,
    };
}

function createProductStore(store) {
    const { db } = store;
    return {
        async list({ kind = null, q = null, size = null, limit = 100, offset = 0 } = {}) {
            const rows = await db.many(`SELECT * FROM shoe_products
                WHERE ($1::text IS NULL OR kind = $1)
                  AND ($2::text IS NULL OR title ILIKE '%' || $2 || '%' OR brand ILIKE '%' || $2 || '%')
                  AND ($3::text IS NULL OR sizes ? $3)
                ORDER BY lower(title), slug LIMIT $4 OFFSET $5`, [kind, q, size, limit, offset]);
            return rows.map(wireProduct);
        },
        async bySlug(slug) {
            const row = await db.maybe('SELECT * FROM shoe_products WHERE slug = $1 LIMIT 1', [slug]);
            return row ? wireProduct(row) : null;
        },
        async offers(slug) {
            const rows = await db.many(`SELECT o.*, p.slug AS product_slug FROM shoe_product_offers o
                JOIN shoe_products p ON p.id = o.product_id WHERE p.slug = $1 ORDER BY o.checked_at DESC`, [slug]);
            return rows.map(wireOffer);
        },
        async upsert(input) {
            if (!input || !KINDS.includes(input.kind) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(input.slug || ''))
                || !input.title || !input.sourceName || !/^https?:\/\//.test(String(input.sourceUrl || ''))) throw new TypeError('product kind, slug, title and cited source are required');
            const id = `sp_${input.slug}`;
            await db.exec(`INSERT INTO shoe_products (id, kind, slug, title, brand, model, url, image, sizes, materials, uses, source_name, source_url, checked_at, facts)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13,$14,$15::jsonb)
                ON CONFLICT (slug) DO UPDATE SET kind=EXCLUDED.kind,title=EXCLUDED.title,brand=EXCLUDED.brand,model=EXCLUDED.model,
                url=EXCLUDED.url,image=EXCLUDED.image,sizes=EXCLUDED.sizes,materials=EXCLUDED.materials,uses=EXCLUDED.uses,
                source_name=EXCLUDED.source_name,source_url=EXCLUDED.source_url,checked_at=EXCLUDED.checked_at,facts=EXCLUDED.facts,updated_at=now()`,
            [id, input.kind, input.slug, input.title, input.brand || null, input.model || null, input.url || null, input.image || null,
                JSON.stringify(input.sizes || []), JSON.stringify(input.materials || []), JSON.stringify(input.uses || []), input.sourceName, input.sourceUrl,
                input.checkedAt || store.iso(), JSON.stringify(input.facts || [])]);
            return this.bySlug(input.slug);
        },
        async upsertOffer(input) {
            if (!input || !input.productSlug || !input.source || !input.sourceId || !/^https?:\/\//.test(String(input.url || ''))) throw new TypeError('product, source id and http(s) offer URL are required');
            const product = await db.maybe('SELECT id FROM shoe_products WHERE slug=$1', [input.productSlug]);
            if (!product) throw new Error('product not found');
            const id = store.newId('spo');
            const saved = await db.one(`INSERT INTO shoe_product_offers (id,product_id,source,source_id,store_domain,store_name,title,url,price_amount,shipping_amount,currency,size,condition,checked_at,stale,raw)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)
                ON CONFLICT (source,source_id) DO UPDATE SET store_domain=EXCLUDED.store_domain,store_name=EXCLUDED.store_name,title=EXCLUDED.title,url=EXCLUDED.url,
                price_amount=EXCLUDED.price_amount,shipping_amount=EXCLUDED.shipping_amount,currency=EXCLUDED.currency,size=EXCLUDED.size,condition=EXCLUDED.condition,checked_at=EXCLUDED.checked_at,stale=EXCLUDED.stale,raw=EXCLUDED.raw RETURNING id`,
            [id, product.id, input.source, input.sourceId, input.storeDomain, input.storeName || null, input.title, input.url, input.price ?? null, input.shipping ?? null,
                input.currency || 'USD', input.size || null, input.condition || null, input.checkedAt || store.iso(), Boolean(input.stale), JSON.stringify(input.raw || {})]);
            return (await this.offers(input.productSlug)).find((offer) => offer.id === saved.id) || null;
        },
    };
}

module.exports = { createProductStore, wireProduct, wireOffer };
