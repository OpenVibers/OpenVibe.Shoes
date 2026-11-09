'use strict';

/**
 * /api/v1 — Open.Shoes' JSON API.
 *
 *   GET    /shoes?q&brand&size&condition&store&sort&page&limit   public search, with facets
 *   GET    /shoes/:slug                                          offers, own history, size curve, cited facts
 *   GET    /shoes/:slug/price?size=&condition=                   the lowest all-in price (a Watch polls this)
 *   GET    /drops?from&to                                        official release dates, soonest first
 *   GET    /drops/:id                                            one release
 *   GET    /me/watches                                           the signed-in person's watches
 *   GET    /watches/:id                                        one watch: its owner's, or one shared with the reader
 *   POST   /me/watches                                           a price watch through OpenVibe.Watch
 *   POST   /me/track                                             a pasted listing link through Watch's rules
 *   GET    /status                                               the last read of each source
 *   GET    /openapi.json                                         this API as OpenAPI 3.1
 *
 * Errors are application/problem+json with a `code`. A person is the shoes_at session cookie or a Network user
 * token as a Bearer; a session write must come from open.shoes itself (403 shoes.cross_site).
 */
const express = require('express');
const { http } = require('openvibe-contracts');
const { asyncRouter } = require('./router');
const { openapi } = require('./openapi');
const productCatalog = require('../product-catalog');

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SORTS = new Set(['recent', 'drop', 'price', 'price_desc', 'popular', 'name']);
const CONDITIONS = new Set(['new', 'used', 'deadstock']);

function createApi(ctx) {
    const { config, catalogue, products: productStore, principal, upstreams } = ctx;
    const r = asyncRouter();
    r.use(express.json({ limit: '64kb' }));
    r.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    r.use(principal.middleware);

    const fail = (res, req, status, code, detail) => http.sendProblem(res, status, code, { detail, ctx: req.ov });
    const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

    r.get('/shoes', async (req, res) => {
        const page = Math.max(1, Math.min(200, parseInt(req.query.page, 10) || 1));
        const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 24));
        const sort = SORTS.has(req.query.sort) ? req.query.sort : 'recent';
        const filters = {
            q: str(req.query.q, 80) || null,
            brand: str(req.query.brand, 80) || null,
            size: str(req.query.size, 12) || null,
            condition: CONDITIONS.has(req.query.condition) ? req.query.condition : null,
            store: str(req.query.store, 120) || null,
        };
        const [shoes, facets, total] = await Promise.all([
            catalogue.listShoes({ ...filters, sort, limit, offset: (page - 1) * limit }),
            catalogue.facets(),
            catalogue.countShoes(filters),
        ]);
        res.set('Cache-Control', 'public, max-age=60');
        return res.json({ shoes, facets, page, per_page: limit, total, sort, filters });
    });

    r.get('/shoes/:slug', async (req, res) => {
        const slug = str(req.params.slug, 80);
        if (!SLUG.test(slug)) return fail(res, req, 404, 'shoe.not_found', 'No such shoe.');
        const model = await catalogue.modelBySlug(slug);
        if (!model) return fail(res, req, 404, 'shoe.not_found', 'No such shoe.');
        const days = Math.max(1, Math.min(365, parseInt(req.query.days, 10) || 90));
        const [offers, history, curve, facts, drops] = await Promise.all([
            catalogue.offersOf(model.id),
            catalogue.history(model.id, { days }),
            catalogue.curve(model.id),
            catalogue.factsOf(model.id),
            catalogue.dropsForModel(model),
        ]);
        const prices = offers.map((o) => o.all_in).filter((p) => p != null).sort((a, b) => a - b);
        const shoe = catalogue.wireModel({
            ...model,
            price_min: prices[0] ?? null,
            price_max: prices[prices.length - 1] ?? null,
            offer_count: offers.length,
            stale_count: offers.filter((o) => o.stale).length,
            checked_at: offers.map((o) => o.checked_at).filter(Boolean).sort().pop() || null,
        });
        res.set('Cache-Control', 'public, max-age=60');
        return res.json({ shoe, offers, history, curve, facts, drops });
    });

    r.get('/shoes/:slug/price', async (req, res) => {
        const slug = str(req.params.slug, 80);
        if (!SLUG.test(slug)) return fail(res, req, 404, 'shoe.not_found', 'No such shoe.');
        const model = await catalogue.modelBySlug(slug);
        if (!model) return fail(res, req, 404, 'shoe.not_found', 'No such shoe.');
        const size = str(req.query.size, 12) || null;
        const condition = CONDITIONS.has(req.query.condition) ? req.query.condition : null;
        const out = await catalogue.priceFor(model.id, { size, condition });
        res.set('Cache-Control', 'no-store');
        return res.json({ slug, size, condition, price: out.price, currency: 'USD', checked_at: out.checked_at, offers: out.offers });
    });

    // One catalog envelope for every product kind. Until a cited and permitted feed is configured, accessories
    // correctly return an empty result with a plain source note instead of invented products or prices.
    r.get('/products', async (req, res) => {
        const kind = str(req.query.kind, 20) || null;
        if (kind && !productCatalog.KINDS.includes(kind)) return fail(res, req, 400, 'product.kind_invalid', 'kind must be shoe, laces, socks, care, insoles or kids.');
        const q = str(req.query.q, 80).toLowerCase();
        const size = str(req.query.size, 20);
        const models = kind && kind !== 'shoe' ? [] : await catalogue.listShoes({ q: q || null, size: size || null, limit: 100, offset: 0 });
        const shoeProducts = models.filter((m) => !q || `${m.brand} ${m.model}`.toLowerCase().includes(q)).map((m) => productCatalog.asProduct(m));
        const otherProducts = kind === 'shoe' ? [] : await productStore.list({ kind, q: q || null, size: size || null, limit: 100, offset: 0 });
        const resultProducts = [...shoeProducts, ...otherProducts].slice(0, 100);
        res.set('Cache-Control', 'public, max-age=60');
        return res.json({ products: resultProducts, total: resultProducts.length, kind, source_note: kind && resultProducts.length === 0 ? 'No cited, permitted product catalog is available for this kind yet; no product or offer data is being inferred.' : null });
    });

    r.get('/products/:id', async (req, res) => {
        const slug = str(req.params.id, 160);
        const stored = await productStore.bySlug(slug);
        if (stored) return res.json({ product: stored });
        const model = await catalogue.modelBySlug(slug);
        if (!model) return fail(res, req, 404, 'product.not_found', 'No product with that id.');
        return res.json({ product: productCatalog.asProduct(model, await catalogue.factsOf(model.id)) });
    });

    r.get('/products/:id/offers', async (req, res) => {
        const id = str(req.params.id, 160);
        const stored = await productStore.bySlug(id);
        if (stored) return res.json({ product_id: stored.id, offers: await productStore.offers(id) });
        const model = await catalogue.modelBySlug(id);
        if (!model) return fail(res, req, 404, 'product.not_found', 'No product with that id.');
        const offers = await catalogue.offersOf(model.id);
        return res.json({ product_id: model.slug, offers });
    });

    r.get('/tools/lace-length', (req, res) => {
        const result = productCatalog.laceLength({
            eyeletPairs: Number(req.query.eyelet_pairs), method: str(req.query.method, 30) || 'criss-cross',
            horizontalCm: req.query.horizontal_cm === undefined ? 3.5 : Number(req.query.horizontal_cm),
            verticalCm: req.query.vertical_cm === undefined ? 2.5 : Number(req.query.vertical_cm),
            endsCm: req.query.ends_cm === undefined ? 25 : Number(req.query.ends_cm),
        });
        if (!result) return fail(res, req, 400, 'lace.input_invalid', 'Use 2–16 eyelet pairs, criss-cross or bow-tie, and valid spacing/end measurements in cm.');
        return res.json(result);
    });

    r.get('/sizes/convert', (req, res) => {
        const result = productCatalog.sizeConvert({ system: str(req.query.system, 20), size: str(req.query.size, 20), brand: str(req.query.brand, 40) || 'darn-tough' });
        if (!result) return fail(res, req, 400, 'size.input_invalid', 'Provide a Darn Tough shoe-size system (men, women or kids) and a numeric shoe size.');
        return res.json(result);
    });

    r.get('/drops', async (req, res) => {
        const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 3600_000);
        const to = req.query.to ? new Date(String(req.query.to)) : null;
        if (Number.isNaN(from.getTime()) || (to && Number.isNaN(to.getTime()))) return fail(res, req, 400, 'request.invalid', 'from and to must be ISO times.');
        if (to && from.getTime() > to.getTime()) return fail(res, req, 400, 'request.invalid', 'from must not be later than to.');
        const drops = await catalogue.listDrops({ from: from.toISOString(), to: to ? to.toISOString() : null, limit: 200 });
        res.set('Cache-Control', 'public, max-age=60');
        return res.json({ from: from.toISOString(), to: to ? to.toISOString() : null, drops });
    });

    r.get('/drops/:id', async (req, res) => {
        const drop = await catalogue.dropById(str(req.params.id, 40));
        if (!drop) return fail(res, req, 404, 'drop.not_found', 'No such drop.');
        return res.json(drop);
    });

    r.get('/me/watches', principal.requirePerson, async (req, res) => {
        const watches = await catalogue.listWatches(req.principal.subject);
        return res.json({ watches });
    });

    // One watch's data: its owner's, or a reader it was shared with (design 2026-11-06, step 6). A signed-out reader of
    // an Anyone-with-the-link watch needs no token; the check is canView inside catalogue.viewWatch.
    r.get('/watches/:id', async (req, res) => {
        const out = await catalogue.viewWatch(req.principal, String(req.params.id || ''));
        if (!out) return fail(res, req, 404, 'watch.not_found', 'No such watch.');
        return res.json({ watch: out.watch });
    });

    r.post('/me/watches', principal.requirePerson, async (req, res) => {
        const b = req.body && typeof req.body === 'object' ? req.body : {};
        const slug = str(b.slug, 80);
        const threshold = Number(b.threshold);
        if (!SLUG.test(slug)) return fail(res, req, 400, 'watch.invalid', 'slug must be a shoe slug from /api/v1/shoes.');
        if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1_000_000) return fail(res, req, 400, 'watch.invalid', 'threshold must be a positive amount.');
        const size = str(b.size, 12) || null;
        const condition = CONDITIONS.has(b.condition) ? b.condition : null;
        const model = await catalogue.modelBySlug(slug);
        if (!model) return fail(res, req, 404, 'shoe.not_found', 'No such shoe.');
        const qs = new URLSearchParams({ size: size || '', condition: condition || '' });
        const feedUrl = `${String(config.baseUrl).replace(/\/+$/, '')}/api/v1/shoes/${encodeURIComponent(slug)}/price?${qs.toString()}`;
        const body = {
            name: `Shoes: ${model.brand} ${model.model}${size ? ` size ${size}` : ''} below $${threshold}`.slice(0, 120),
            source: { kind: 'api', url: feedUrl },
            cadence: { every_sec: config.watch.everySec },
            extraction: { kind: 'json', value_path: 'price' },
            condition: { op: 'lt', value: threshold },
            action: [{ kind: 'notification', category: 'service', priority: 'normal' }],
        };
        const out = await upstreams.createWatch(body, { token: req.principal.token });
        const watch = await catalogue.createWatch({
            subject: req.principal.subject, kind: 'price', modelId: model.id, slug, size, condition, threshold,
            currency: 'USD', remoteId: out.ok && out.watch ? out.watch.id : null,
            status: out.ok ? 'active' : 'not_connected', note: out.ok ? null : out.detail,
        });
        return res.status(201).json({ watch, remote: out.ok ? out.watch : null, note: out.ok ? null : out.detail });
    });

    r.post('/me/track', principal.requirePerson, async (req, res) => {
        const b = req.body && typeof req.body === 'object' ? req.body : {};
        const checkedUrl = await upstreams.checkPastedUrl(b.url);
        if (!checkedUrl.ok) return fail(res, req, 400, checkedUrl.code, checkedUrl.detail);
        const body = {
            name: `Shoes: a pasted listing (${checkedUrl.host})`.slice(0, 120),
            source: { kind: 'http', url: checkedUrl.url, method: 'GET' },
            cadence: { every_sec: config.watch.everySec },
            extraction: { kind: 'text' },
            condition: { op: 'changed' },
            action: [{ kind: 'notification', category: 'service', priority: 'normal' }],
        };
        const out = await upstreams.createWatch(body, { token: req.principal.token });
        const watch = await catalogue.createWatch({
            subject: req.principal.subject, kind: 'link', sourceUrl: checkedUrl.url,
            remoteId: out.ok && out.watch ? out.watch.id : null,
            status: out.ok ? 'active' : 'not_connected', note: out.ok ? null : out.detail,
        });
        return res.status(201).json({ watch, remote: out.ok ? out.watch : null, note: out.ok ? null : out.detail });
    });

    r.get('/status', async (_req, res) => {
        const [counts, jobs, facets] = await Promise.all([catalogue.counts(), catalogue.lastJobRuns(), catalogue.facets()]);
        res.set('Cache-Control', 'public, max-age=30');
        return res.json({
            service: 'shoes', counts,
            facets: { models: facets.models, offers: facets.offers, stores: facets.stores.length, drops: facets.drops, checked_at: facets.checked_at },
            jobs,
            sources: {
                deals: config.sources.dealsUrl,
                drops: config.sources.dropsUrl,
                ebay: upstreams.ebayConfigured() ? 'configured' : 'off (no key pair)',
                watch: 'the person\'s own Network token',
            },
        });
    });

    r.get('/openapi.json', (req, res) => res.json(openapi(config)));

    r.use((req, res) => fail(res, req, 404, 'route.not_found', 'No such API route.'));
    return r;
}

module.exports = { createApi };
