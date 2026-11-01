'use strict';

/**
 * Shoes' server-rendered pages. They work without JavaScript: forms are plain POSTs and every link is a real link.
 * Public pages are served public; a page drawn for a signed-in person is private, no-store.
 *
 *   /                         the room's front door (sc.room: hero, proof, rails, scenes, explore, dev, faq)
 *   /shoes                    search and facets
 *   /shoe/:slug               one model: offers, own snapshots, size curve, cited facts, the watch form
 *   /shoe/:slug/watch         POST: a price watch through OpenVibe.Watch
 *   /track                    a pasted listing link, through Watch's own fetch rules
 *   /drops                    the official release calendar, with "remind me" on Today
 *   /drops/:id/remind         POST: put the release on the person's Today agenda
 *   /watches                  a signed-in person's watches
 *   /developers               the API
 *   /robots.txt, /sitemap.xml, /llms.txt, /llms-full.txt
 */
const express = require('express');
const { asyncRouter } = require('./router');
const { sameOrigin } = require('./principal');
const { send } = require('../render/layout');
const views = require('../views');
const discovery = require('./discovery');

const SORTS = new Set(['recent', 'drop', 'price', 'price_desc', 'popular', 'name']);
const PER_PAGE = 24;

function createPageRoutes(ctx) {
    const { config, catalogue, upstreams } = ctx;
    const r = asyncRouter();
    r.use(express.urlencoded({ extended: false, limit: '64kb' }));
    const page = (req, res, o, status = 200) => send(res, status, { viewer: req.viewer, config, path: req.originalUrl, ...o });
    const signedIn = (req) => req.viewer && req.viewer.kind === 'user' && req.viewer.subject;
    const base = () => String(config.baseUrl).replace(/\/+$/, '');
    const noticeOf = (req) => (typeof req.query.notice === 'string' ? req.query.notice.slice(0, 240) : null);
    const guardOrigin = (req, res) => {
        if (req.viewer && req.viewer.kind === 'user' && req.viewer.token && !sameOrigin(req, base())) {
            page(req, res, { title: 'Not from this site', body: views.signIn({ title: 'That came from somewhere else', next: '/' }), active: '/' }, 403);
            return false;
        }
        return true;
    };

    r.get('/', async (req, res) => {
        const now = Date.now();
        const [facets, dropping, popular, jobs] = await Promise.all([
            catalogue.facets(),
            catalogue.listDrops({ from: new Date(now).toISOString(), to: new Date(now + 7 * 86400_000).toISOString(), limit: 12 }),
            catalogue.listShoes({ sort: 'popular', limit: 8 }),
            catalogue.lastJobRuns(),
        ]);
        const dropsToday = await catalogue.listShoes({ sort: 'drop', limit: 12 });
        let curveModel = null; let curve = null;
        for (const m of popular.slice(0, 6)) {
            const c = await catalogue.curve(m.id);
            if (c.points.length) { curveModel = m; curve = c; break; }
        }
        const sceneDrop = dropping[0] || (await catalogue.listDrops({ from: new Date(now).toISOString(), limit: 1 }))[0] || null;
        const body = views.home({ facets, dropping, dropsToday, popular, curveModel, curve, sceneDrop, jobs, now });
        return page(req, res, {
            title: null,
            description: 'OpenVibe.Shoes: every shoe, every market, the right price. A page per model with every store\'s all-in price, Shoes\' own price history, the size-price curve and a watch for your size.',
            body,
            active: '/',
            index: true,
            jsonLd: discovery.homeJsonLd(config),
        });
    });

    r.get('/shoes', async (req, res) => {
        const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
        const brand = typeof req.query.brand === 'string' ? req.query.brand.trim().slice(0, 80) : '';
        const size = typeof req.query.size === 'string' ? req.query.size.trim().slice(0, 12) : '';
        const condition = ['new', 'used', 'deadstock'].includes(req.query.condition) ? req.query.condition : '';
        const store = typeof req.query.store === 'string' ? req.query.store.trim().slice(0, 120) : '';
        const sort = SORTS.has(req.query.sort) ? req.query.sort : 'recent';
        const pageNo = Math.max(1, Math.min(200, parseInt(req.query.page, 10) || 1));
        const filters = { q: q || null, brand: brand || null, size: size || null, condition: condition || null, store: store || null };
        const [models, facets, total] = await Promise.all([
            catalogue.listShoes({ ...filters, sort, limit: PER_PAGE, offset: (pageNo - 1) * PER_PAGE }),
            catalogue.facets(),
            catalogue.countShoes(filters),
        ]);
        return page(req, res, {
            title: q ? `Shoes matching “${q}”` : 'Every shoe',
            description: 'Search every shoe in OpenVibe.Shoes by brand, model, size and condition; every price is all-in with its store and the time it was checked.',
            body: views.shoesIndex({ models, facets, query: { ...filters, sort }, page: pageNo, total }),
            active: '/shoes',
            robots: q || brand || size || condition || store ? 'noindex, follow' : 'index, follow',
        });
    });

    r.get('/shoe/:slug', async (req, res) => {
        const model = await catalogue.modelBySlug(String(req.params.slug || '').slice(0, 80));
        if (!model) return page(req, res, { title: 'Not found', body: views.notFound(), active: '/shoes' }, 404);
        const [offers, history, curve, facts, releases] = await Promise.all([
            catalogue.offersOf(model.id),
            catalogue.history(model.id, { days: 90 }),
            catalogue.curve(model.id),
            catalogue.factsOf(model.id),
            catalogue.dropsForModel(model),
        ]);
        const low = offers.map((o) => o.all_in).filter((p) => p != null).sort((a, b) => a - b)[0];
        return page(req, res, {
            title: `${model.brand} ${model.model}${low != null ? `: ${views.money(low)} all-in` : ''}`,
            description: `${model.brand} ${model.model}: every store's all-in price, Shoes' own price history, the size-price curve${facts.length ? ' and cited specs' : ''}.`,
            body: views.shoe({ model, offers, history, curve, facts, drops: releases, signedIn: Boolean(signedIn(req)) }),
            active: '/shoes',
            index: true,
            jsonLd: [discovery.productJsonLd(config, model, offers, low)],
        });
    });

    r.post('/shoe/:slug/watch', async (req, res) => {
        if (!signedIn(req)) return res.redirect(302, `/auth/login?next=${encodeURIComponent(`/shoe/${req.params.slug}`)}`);
        if (!guardOrigin(req, res)) return;
        const model = await catalogue.modelBySlug(String(req.params.slug || '').slice(0, 80));
        if (!model) return page(req, res, { title: 'Not found', body: views.notFound(), active: '/shoes' }, 404);
        const threshold = Number(req.body.threshold);
        if (!Number.isFinite(threshold) || threshold <= 0) {
            const [offers, history, curve, facts, releases] = await Promise.all([catalogue.offersOf(model.id), catalogue.history(model.id), catalogue.curve(model.id), catalogue.factsOf(model.id), catalogue.dropsForModel(model)]);
            return page(req, res, { title: 'A price is needed', body: views.shoe({ model, offers, history, curve, facts, drops: releases, signedIn: true }), active: '/shoes' }, 400);
        }
        const size = String(req.body.size || '').slice(0, 12) || null;
        const condition = ['new', 'used', 'deadstock'].includes(req.body.condition) ? req.body.condition : null;
        const qs = new URLSearchParams({ size: size || '', condition: condition || '' });
        const feedUrl = `${base()}/api/v1/shoes/${encodeURIComponent(model.slug)}/price?${qs.toString()}`;
        const body = {
            name: `Shoes: ${model.brand} ${model.model}${size ? ` size ${size}` : ''} below $${threshold}`.slice(0, 120),
            source: { kind: 'api', url: feedUrl },
            cadence: { every_sec: config.watch.everySec },
            extraction: { kind: 'json', value_path: 'price' },
            condition: { op: 'lt', value: threshold },
            action: [{ kind: 'notification', category: 'service', priority: 'normal' }],
        };
        const out = await upstreams.createWatch(body, { token: req.viewer.token });
        await catalogue.createWatch({
            subject: req.viewer.subject, kind: 'price', modelId: model.id, slug: model.slug, size, condition,
            threshold, currency: 'USD', remoteId: out.ok && out.watch ? out.watch.id : null,
            status: out.ok ? 'active' : 'not_connected', note: out.ok ? null : out.detail,
        });
        const notice = out.ok ? 'Your watch is in OpenVibe.Watch. It will tell you when the all-in price drops below your number.' : `Saved on Shoes, but not connected to OpenVibe.Watch yet: ${out.detail}`;
        return res.redirect(302, `/watches?notice=${encodeURIComponent(notice)}`);
    });

    r.get('/track', (req, res) => page(req, res, {
        title: 'Track a listing link',
        description: 'Paste a store, eBay or Marketplace listing and OpenVibe.Watch keeps it, through its own fetch rules.',
        body: views.track({ signedIn: Boolean(signedIn(req)), notice: noticeOf(req) }),
        active: '/watches',
        robots: 'noindex, follow',
    }));

    r.post('/track', async (req, res) => {
        if (!signedIn(req)) return res.redirect(302, '/auth/login?next=%2Ftrack');
        if (!guardOrigin(req, res)) return;
        const checkedUrl = await upstreams.checkPastedUrl(req.body.url);
        if (!checkedUrl.ok) return page(req, res, { title: 'Track a listing link', body: views.track({ signedIn: true, notice: checkedUrl.detail, url: req.body.url }), active: '/watches', robots: 'noindex, follow' }, 400);
        const body = {
            name: `Shoes: a pasted listing (${checkedUrl.host})`.slice(0, 120),
            source: { kind: 'http', url: checkedUrl.url, method: 'GET' },
            cadence: { every_sec: config.watch.everySec },
            extraction: { kind: 'text' },
            condition: { op: 'changed' },
            action: [{ kind: 'notification', category: 'service', priority: 'normal' }],
        };
        const out = await upstreams.createWatch(body, { token: req.viewer.token });
        await catalogue.createWatch({
            subject: req.viewer.subject, kind: 'link', sourceUrl: checkedUrl.url,
            remoteId: out.ok && out.watch ? out.watch.id : null,
            status: out.ok ? 'active' : 'not_connected', note: out.ok ? null : out.detail,
        });
        const notice = out.ok ? 'The listing is a Watch in OpenVibe.Watch. It applies its own fetch rules to every check.' : `Saved on Shoes, but not connected to OpenVibe.Watch yet: ${out.detail}`;
        return res.redirect(302, `/watches?notice=${encodeURIComponent(notice)}`);
    });

    r.get('/drops', async (req, res) => {
        const now = Date.now();
        const list = await catalogue.listDrops({ from: new Date(now - 3600_000).toISOString(), limit: 120 });
        return page(req, res, {
            title: 'The drops calendar',
            description: 'Official shoe release dates, each cited to the brand\'s or store\'s own public release page, with a reminder on OpenVibe.Today. Raffle entries are never automated.',
            body: views.drops({ drops: list, signedIn: Boolean(signedIn(req)), notice: noticeOf(req) }),
            active: '/drops',
            index: true,
        });
    });

    r.post('/drops/:id/remind', async (req, res) => {
        if (!signedIn(req)) return res.redirect(302, `/auth/login?next=${encodeURIComponent('/drops')}`);
        if (!guardOrigin(req, res)) return;
        const drop = await catalogue.dropById(String(req.params.id || ''));
        if (!drop) return page(req, res, { title: 'Not found', body: views.notFound(), active: '/drops' }, 404);
        if (Date.parse(drop.release_at) < Date.now() - 5 * 60_000) {
            return res.redirect(302, `/drops?notice=${encodeURIComponent('That release has already happened, so there is nothing to remind you about.')}`);
        }
        const event = {
            kind: 'event',
            title: `Drop: ${drop.brand} ${drop.model}`.slice(0, 120),
            description: `${drop.colourway ? `${drop.colourway}. ` : ''}Official release: ${drop.source_url}${drop.price != null ? ` · ${drop.price} ${drop.currency}` : ''}. Listed by ${drop.source_name}; read ${drop.fetched_at}. Shoes never enters raffles.`.slice(0, 1000),
            starts_at: drop.release_at,
            tz: 'UTC',
            visibility: 'public',
        };
        const out = await upstreams.createTodayEvent(event, { token: req.viewer.token });
        const notice = out.ok ? 'The drop is on your OpenVibe.Today agenda. Today carries the reminder; Shoes never enters the raffle.' : `Could not add it to Today: ${out.detail}`;
        return res.redirect(302, `/drops?notice=${encodeURIComponent(notice)}`);
    });

    r.get('/watches', async (req, res) => {
        const list = signedIn(req) ? await catalogue.listWatches(req.viewer.subject) : [];
        return page(req, res, {
            title: 'Your watches',
            description: 'The price watches and pasted listing links that OpenVibe.Watch carries for you.',
            body: views.watches({ watches: list, signedIn: Boolean(signedIn(req)), notice: noticeOf(req) }),
            active: '/watches',
            robots: 'noindex, nofollow',
        });
    });

    r.get('/developers', (req, res) => page(req, res, {
        title: 'The Shoes API',
        description: 'The open JSON API for shoes, offers, price history, size curves, drops and watches, with an OpenAPI document.',
        body: views.developers({ baseUrl: base() }),
        active: '/developers',
        index: true,
    }));

    r.use(discovery.createDiscoveryRoutes(ctx));
    return r;
}

module.exports = { createPageRoutes };
