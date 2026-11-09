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
const productCatalog = require('../product-catalog');

// The one Share sheet (openvibe-shared ov-share.js): its stylesheet and script, and the gate that draws itself from
// markup. A page with a Share button needs the shared navbar, which loads the sheet on the first press.
const SHARE_HEAD = `<link rel="stylesheet" href="${require('openvibe-shared/serve').url('ov-share.css')}"><script src="${require('openvibe-shared/serve').url('ov-share.js')}" defer></script>`;

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
            description: 'Open.Shoes: every shoe, every market, the right price. A page per model with every store\'s all-in price, Shoes\' own price history, the size-price curve and a watch for your size.',
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
            description: 'Search every shoe in Open.Shoes by brand, model, size and condition; every price is all-in with its store and the time it was checked.',
            body: views.shoesIndex({ models, facets, query: { ...filters, sort }, page: pageNo, total }),
            active: '/shoes',
            robots: q || brand || size || condition || store ? 'noindex, follow' : 'index, follow',
        });
    });

    const expansionFaq = (name, text) => [{ '@type': 'FAQPage', mainEntity: [{ '@type': 'Question', name, acceptedAnswer: { '@type': 'Answer', text } }] }];
    r.get('/products', (req, res) => res.redirect(302, `/api/v1/products${req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : ''}`));
    for (const [route, kind, title, description] of [
        ['/laces', 'laces', 'Shoelaces and lacing guides', 'Estimate lace length from eyelet spacing and lacing method, then follow simple lacing diagrams.'],
        ['/socks', 'socks', 'Sock sizing by shoe size', 'Use the sock maker’s size chart for the correct shoe-size range, material and use.'],
        ['/care', 'care', 'Shoe care by upper material', 'Manufacturer-sourced shoe-care notes for leather, suede, knit, canvas, mesh and nubuck.'],
        ['/kids', 'kids', 'Baby and kids shoe fit guide', 'Measure growing feet, consult brand charts and set an optional remeasure reminder.'],
    ]) r.get(route, (req, res) => page(req, res, {
        title, description, body: views.expansionPage({ kind, signedIn: Boolean(signedIn(req)), notice: noticeOf(req) }), active: route,
        index: true, jsonLd: expansionFaq(`How do I use ${title.toLowerCase()}?`, description),
    }));

    r.get('/lace-length', (req, res) => {
        const result = req.query.eyelet_pairs ? productCatalog.laceLength({
            eyeletPairs: Number(req.query.eyelet_pairs), method: String(req.query.method || 'criss-cross'),
            horizontalCm: req.query.horizontal_cm === undefined ? 3.5 : Number(req.query.horizontal_cm),
            verticalCm: req.query.vertical_cm === undefined ? 2.5 : Number(req.query.vertical_cm),
            endsCm: req.query.ends_cm === undefined ? 25 : Number(req.query.ends_cm),
        }) : null;
        return page(req, res, { title: 'Lace length finder', description: 'Estimate lace length using eyelet count, spacing and method.', body: views.expansionPage({ kind: 'laces', result }), active: '/laces', index: true,
            jsonLd: [{ '@type': 'HowTo', name: 'Estimate shoelace length', step: ['Count eyelet pairs on one shoe.', 'Measure horizontal and vertical spacing in centimeters.', 'Choose a lacing pattern and tie-end length.', 'Compare the rounded estimate with your current lace.'].map((text) => ({ '@type': 'HowToStep', text })) }, ...expansionFaq('Is this lace length exact?', 'No. It is an estimate from your measurements; compare it with a lace that fits your shoe.') ] });
    });

    r.get('/kids/measure', (req, res) => page(req, res, { title: 'Printable foot measuring ruler', description: 'Print at actual size, verify the 10 cm calibration line, and measure each foot.', body: views.expansionPage({ kind: 'measure' }), active: '/kids', index: true,
        jsonLd: [{ '@type': 'HowTo', name: 'Measure a child’s foot at home', step: ['Print at 100% / Actual Size.', 'Verify the 10 cm calibration mark.', 'Measure the longest toe while the child is standing.', 'Use the larger foot measurement with the chosen brand’s chart.'].map((text) => ({ '@type': 'HowToStep', text })) }] }));

    r.post('/kids/growth-check', async (req, res) => {
        if (!signedIn(req)) return res.redirect(302, '/auth/login?next=%2Fkids');
        if (!guardOrigin(req, res)) return;
        const nickname = typeof req.body.nickname === 'string' ? req.body.nickname.trim().slice(0, 40) : '';
        const size = typeof req.body.size === 'string' ? req.body.size.trim().slice(0, 16) : '';
        const stage = req.body.stage === 'toddler' ? 'toddler' : req.body.stage === 'child' ? 'child' : '';
        if (req.body.consent !== 'yes' || !size || !stage) return res.redirect(302, `/kids?notice=${encodeURIComponent('Choose a current size and stage, then opt in to add a reminder.')}`);
        const due = new Date();
        due.setUTCDate(1);
        due.setUTCMonth(due.getUTCMonth() + (stage === 'toddler' ? 3 : 6));
        const days = new Date(Date.UTC(due.getUTCFullYear(), due.getUTCMonth() + 1, 0)).getUTCDate();
        due.setUTCDate(Math.min(new Date().getUTCDate(), days));
        due.setUTCHours(9, 0, 0, 0);
        const display = nickname ? `${nickname}: ` : '';
        const out = await upstreams.createTodayEvent({ kind: 'event', title: `Remeasure ${display}kids’ feet`.slice(0, 120), description: `Current shoe size: ${size}. Recheck both feet and compare with the shoe maker’s chart. This reminder contains no birthday.`, starts_at: due.toISOString(), tz: 'UTC', visibility: 'private' }, { token: req.viewer.token });
        const notice = out.ok ? `Private reminder added for ${due.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}.` : `Today could not add the reminder: ${out.detail}`;
        return res.redirect(302, `/kids?notice=${encodeURIComponent(notice)}`);
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
        const defaultAudience = signedIn(req) && ctx.sharing ? await ctx.sharing.defaultOf(req.viewer.subject).catch(() => 'private') : 'private';
        return page(req, res, {
            title: 'Your watches',
            description: 'The price watches and pasted listing links that OpenVibe.Watch carries for you.',
            body: views.watches({ watches: list, signedIn: Boolean(signedIn(req)), notice: noticeOf(req), defaultAudience }),
            active: '/watches', head: SHARE_HEAD,
            robots: 'noindex, nofollow',
        });
    });

    // The person's default for new watches, and "apply to all" (design rule 2).
    r.post('/watches/defaults', async (req, res) => {
        if (!signedIn(req)) return res.redirect(302, '/auth/login?next=%2Fwatches');
        if (!guardOrigin(req, res)) return;
        if (ctx.sharing) {
            const audience = ['private', 'people', 'link', 'public'].includes(req.body.audience) ? req.body.audience : 'private';
            await ctx.sharing.setDefault(req.viewer.subject, audience, { applyAll: String(req.body.apply_all || '') === '1' })
                .catch((err) => ctx.log.warn('[Shoes] the watch default was not saved:', err.message));
        }
        return res.redirect(302, '/watches');
    });

    // One watch's own page (design 2026-11-06, step 6): its owner's, or a reader it was shared with. A watch shared with
    // specific people answers the gate to everyone else and never shows what it looks for.
    r.get('/watches/:id', async (req, res) => {
        const id = String(req.params.id || '');
        const out = await catalogue.viewWatch(req.viewer || { kind: 'anonymous' }, id);
        if (!out) {
            const audience = ctx.sharing ? await ctx.sharing.audienceOf(id).catch(() => null) : null;
            if (audience === 'people') {
                return page(req, res, {
                    title: 'A watch shared with specific people', head: SHARE_HEAD, active: '/watches', robots: 'noindex, nofollow',
                    body: views.watchGate({ id, signedInAs: signedIn(req) ? req.viewer.username || '' : '', signInUrl: `/auth/login?next=${encodeURIComponent(req.originalUrl)}` }),
                }, 404);
            }
            return page(req, res, { title: 'Not found', body: views.notFound(), active: '/watches' }, 404);
        }
        const audience = ctx.sharing ? await ctx.sharing.audienceOf(id).catch(() => null) : null;
        return page(req, res, {
            title: out.watch.kind === 'price' ? 'A price watch' : 'A listing watch',
            description: 'A watch carried by OpenVibe.Watch for its owner, shared on Open.Shoes.',
            body: views.watchPage({ watch: out.watch, mine: out.mine, audience }),
            active: '/watches', head: SHARE_HEAD, robots: 'noindex, nofollow',
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
