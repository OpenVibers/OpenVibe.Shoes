'use strict';

/**
 * /api/v1 — OpenVibe.Shoes' JSON API.
 *
 *   GET    /shoes?q&brand&size&condition&store&sort&page&limit   public search, with facets
 *   GET    /shoes/:slug                                          offers, own history, size curve, cited facts
 *   GET    /shoes/:slug/price?size=&condition=                   the lowest all-in price (a Watch polls this)
 *   GET    /drops?from&to                                        official release dates, soonest first
 *   GET    /drops/:id                                            one release
 *   GET    /me/watches                                           the signed-in person's watches
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

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SORTS = new Set(['recent', 'drop', 'price', 'price_desc', 'popular', 'name']);
const CONDITIONS = new Set(['new', 'used', 'deadstock']);

function createApi(ctx) {
    const { config, catalogue, principal, upstreams } = ctx;
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
