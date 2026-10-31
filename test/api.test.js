'use strict';

/**
 * Every /api/v1 route on a booted app: the public search and one shoe, the price a Watch polls, the drops, the
 * signed-in price watch and pasted link (through the Watch stand-in), the cross-site refusal, the source status
 * and the OpenAPI document.
 */
const { boot, check, done } = require('./helpers/boot');
const { assert, equal } = require('./helpers/check');

(async () => {
    const t = await boot();
    try {
        await t.ctx.jobs.offers.runOnce({ pages: 2 });
        await t.ctx.jobs.drops.runOnce();
        const user = t.network.addUser('ada');

        await check('GET /api/v1/shoes: the catalogue and its facets', async () => {
            const res = await t.get('/api/v1/shoes');
            equal(res.status, 200);
            const b = res.json();
            equal(b.shoes.length, 4);
            equal(b.total, 4);
            equal(b.facets.models, 4);
            equal(b.facets.offers, 4);
            assert(b.facets.brands.some((x) => x.value === 'Nike'), 'brand facet');
            assert(b.shoes.every((s) => s.offer_count === 1), 'one offer each');
        });

        await check('GET /api/v1/shoes?brand&size&sort: the filters', async () => {
            const nike = (await t.get('/api/v1/shoes?brand=Nike')).json();
            equal(nike.shoes.length, 1);
            equal(nike.shoes[0].slug, 'nike-air-max-90');
            const sized = (await t.get('/api/v1/shoes?size=10.5')).json();
            equal(sized.shoes.length, 1);
            equal(sized.shoes[0].slug, 'adidas-samba-og');
            const sorted = (await t.get('/api/v1/shoes?sort=price')).json();
            equal(sorted.shoes[0].slug, 'nike-air-max-90');
        });

        await check('GET /api/v1/shoes/:slug: offers, history, curve and facts', async () => {
            const res = await t.get('/api/v1/shoes/nike-air-max-90');
            equal(res.status, 200);
            const b = res.json();
            equal(b.shoe.brand, 'Nike');
            equal(b.offers.length, 1);
            equal(b.offers[0].all_in, 89.95);
            equal(b.history.length, 1);
            equal(b.history[0].day, '2026-10-31');
            equal(b.curve.points.length, 0, 'no size named on this offer');
            equal(b.facts.length, 0);
        });

        await check('GET /api/v1/shoes/:slug/price: the Watch feed', async () => {
            const res = await t.get('/api/v1/shoes/nike-air-max-90/price');
            equal(res.status, 200);
            const b = res.json();
            equal(b.price, 89.95);
            equal(b.offers, 1);
            assert(b.checked_at, 'the check time');
            equal((await t.get('/api/v1/shoes/no-such-shoe/price')).status, 404);
            equal((await t.get('/api/v1/shoes/NOT_A_SLUG')).status, 404);
        });

        await check('GET /api/v1/drops: the official releases', async () => {
            const res = await t.get('/api/v1/drops');
            equal(res.status, 200);
            const b = res.json();
            equal(b.drops.length, 3);
            assert(b.drops.every((d) => d.source_url), 'every drop cites its source');
            const one = await t.get(`/api/v1/drops/${encodeURIComponent(b.drops[0].id)}`);
            equal(one.status, 200);
            equal(one.json().model, b.drops[0].model);
            equal((await t.get('/api/v1/drops/not-a-drop')).status, 404);
            equal((await t.get('/api/v1/drops?from=not-a-date')).status, 400);
        });

        await check('POST /api/v1/me/watches: a session is required', async () => {
            const res = await t.get('/api/v1/me/watches', { json: { slug: 'nike-air-max-90', threshold: 90 }, method: 'POST' });
            equal(res.status, 401);
            equal(res.json().code, 'token.required');
        });

        await check('POST /api/v1/me/watches: a price watch through OpenVibe.Watch', async () => {
            const res = await t.get('/api/v1/me/watches', { as: user, json: { slug: 'nike-air-max-90', size: '10.5', condition: 'new', threshold: 90 } });
            equal(res.status, 201);
            const b = res.json();
            equal(b.watch.kind, 'price');
            equal(b.watch.status, 'active');
            assert(b.watch.remote_id, 'a remote Watch id');
            assert(b.remote, 'the remote watch');
            const sent = t.upstreams.state.watchRequests[0];
            equal(sent.body.source.kind, 'api');
            assert(sent.body.source.url.includes('/api/v1/shoes/nike-air-max-90/price'), 'the feed URL');
            equal(sent.body.condition.op, 'lt');
            equal(sent.body.condition.value, 90);
            equal(sent.headers['x-ov-subject'], user.subject);
            const list = (await t.get('/api/v1/me/watches', { as: user })).json();
            equal(list.watches.length, 1);
        });

        await check('POST /shoe/:slug/watch: the page form creates the same price watch', async () => {
            const before = t.upstreams.state.watchRequests.length;
            const res = await t.get('/shoe/nike-air-max-90/watch', { as: user, form: { threshold: '75', size: '10.5', condition: 'new' } });
            equal(res.status, 302);
            assert(res.headers.get('location').startsWith('/watches?notice='), 'to the watches with a note');
            equal(t.upstreams.state.watchRequests.length, before + 1);
            const sent = t.upstreams.state.watchRequests[before];
            equal(sent.body.condition.value, 75);
            equal(sent.body.source.kind, 'api');
        });

        await check('POST /api/v1/me/track: a pasted link becomes a Watch', async () => {
            const res = await t.get('/api/v1/me/track', { as: user, json: { url: 'https://www.ebay.com/itm/123' } });
            equal(res.status, 201);
            const b = res.json();
            equal(b.watch.kind, 'link');
            equal(b.watch.source_url, 'https://www.ebay.com/itm/123');
            const sent = t.upstreams.state.watchRequests[t.upstreams.state.watchRequests.length - 1];
            equal(sent.body.source.kind, 'http');
            equal(sent.body.condition.op, 'changed');
            equal(sent.body.extraction.kind, 'text');
            equal((await t.get('/api/v1/me/track', { as: user, json: { url: '' } })).status, 400);
            equal((await t.get('/api/v1/me/track', { as: user, json: { url: 'ftp://example.com/x' } })).status, 400);
        });

        await check('a signed-in write from another site is refused', async () => {
            const res = await t.get('/api/v1/me/watches', { as: user, origin: 'https://evil.example', json: { slug: 'nike-air-max-90', threshold: 90 } });
            equal(res.status, 403);
            equal(res.json().code, 'shoes.cross_site');
        });

        await check('GET /api/health: the machine endpoint', async () => {
            const res = await t.get('/api/health');
            equal(res.status, 200);
            equal(res.json().service, 'openvibe-shoes');
            equal(res.json().name, 'OpenVibe.Shoes');
        });

        await check('GET /api/v1/status: the jobs, counts and what is configured', async () => {
            const b = (await t.get('/api/v1/status')).json();
            equal(b.counts.models, 4);
            equal(b.sources.watch, 'configured');
            equal(b.sources.ebay, 'configured');
            assert(b.jobs.some((j) => j.job === 'offers'), 'the offers job is listed');
            assert(b.jobs.some((j) => j.job === 'drops'), 'the drops job is listed');
        });

        await check('GET /api/openapi.json: a valid OpenAPI 3.1 document with every route', async () => {
            const res = await t.get('/api/openapi.json');
            equal(res.status, 200);
            const b = res.json();
            equal(b.openapi, '3.1.0');
            assert(b.paths['/api/v1/shoes'], 'shoes');
            assert(b.paths['/api/v1/shoes/{slug}'], 'one shoe');
            assert(b.paths['/api/v1/shoes/{slug}/price'], 'price');
            assert(b.paths['/api/v1/drops'], 'drops');
            assert(b.paths['/api/v1/me/watches'], 'watches');
            assert(b.paths['/api/v1/me/track'], 'track');
            equal((await t.get('/api/v1/openapi.json')).status, 200);
        });

        await check('an unknown API route is problem+json', async () => {
            const res = await t.get('/api/v1/nope');
            equal(res.status, 404);
            assert(res.headers.get('content-type').includes('application/problem+json'), 'problem+json');
            equal(res.json().code, 'route.not_found');
        });
    } finally {
        await t.close();
    }
    done();
})().catch((err) => { console.error(err); process.exit(1); });
