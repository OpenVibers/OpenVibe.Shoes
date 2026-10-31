'use strict';

/**
 * Every page: the room's front door (hero, proof, rails, scenes, explore, dev, FAQ, network), the search, one
 * shoe, the drops with a real "remind me" onto Today, a pasted link, the signed-in watches, the developers page,
 * the discovery artifacts and the 404.
 */
const { boot, check, done } = require('./helpers/boot');
const { assert, equal } = require('./helpers/check');

(async () => {
    const t = await boot();
    try {
        await t.ctx.jobs.offers.runOnce({ pages: 2 });
        await t.ctx.jobs.drops.runOnce();
        const user = t.network.addUser('ada');

        await check('GET /: sc.room with every section from real data', async () => {
            const res = await t.get('/');
            equal(res.status, 200);
            assert(res.headers.get('content-type').includes('text/html'), 'html');
            const h = res.text;
            assert(h.includes('class="ov-room sc-room"'), 'the room wrapper');
            assert(h.includes('data-room="shoes"'), 'the room id');
            assert(h.includes('Every shoe, every market, the right price'), 'the room line');
            assert(h.includes('The biggest price drops today'), 'the drops rail');
            assert(h.includes('Dropping this week'), 'the release rail');
            assert(h.includes('Popular models'), 'the popular rail');
            assert(h.includes('The biggest price drops today') && h.includes('ovk-card'), 'kit cards');
            assert(h.includes('A size-price curve') || h.includes('What a size costs'), 'the size scene');
            assert(h.includes('A drop reminder, on Today'), 'the Today scene');
            assert(h.includes('Paste a link, keep the price'), 'the link scene');
            assert(h.includes('For developers'), 'the dev section');
            assert(h.includes('Questions') || h.includes('sc-faq'), 'the FAQ');
            assert(h.includes('Part of OpenVibe'), 'the network section');
            assert(!h.includes('undefined'), 'no undefined in the page');
            assert(h.includes('OpenVibe.Shoes') && h.includes('open.shoes'), 'the name and the domain');
        });

        await check('GET /shoes: search, facets and a real card', async () => {
            const res = await t.get('/shoes?brand=Nike');
            equal(res.status, 200);
            assert(res.text.includes('Nike Air Max 90'), 'the model');
            assert(res.text.includes('$89.95'), 'the all-in price');
            assert(res.text.includes('Brand'), 'the brand facet');
            assert(res.text.includes('1 model'), 'the count');
        });

        await check('GET /shoe/:slug: offers, history, curve, facts and the watch form', async () => {
            const res = await t.get('/shoe/nike-air-max-90');
            equal(res.status, 200);
            const h = res.text;
            assert(h.includes('Nike Air Max 90'), 'the title');
            assert(h.includes('$89.95'), 'the all-in price');
            assert(h.includes('Current prices by store'), 'the offers');
            assert(h.includes('zappos.com'), 'the store');
            assert(h.includes('Price history'), 'the history');
            assert(h.includes('2026-10-31'), 'the snapshot day');
            assert(h.includes('Size-price curve'), 'the curve section');
            assert(h.includes('Not known yet'), 'the honest unknown');
            assert(h.includes('Release dates'), 'the cited releases section');
            assert(h.includes('Medium Olive'), 'the official release colourway');
            assert(h.includes('A price watch needs a person'), 'signed out prompt');
            assert(h.includes('90.00') || h.includes('from list'), 'the list-price drop');
        });

        await check('GET /shoe/:slug signed in: the price-watch form', async () => {
            const res = await t.get('/shoe/nike-air-max-90', { as: user });
            equal(res.status, 200);
            assert(res.text.includes('Tell me when this drops below $X at my size'), 'the form');
            assert(res.text.includes('name="threshold"'), 'the price input');
        });

        await check('GET /drops: the official calendar and the reminder', async () => {
            const res = await t.get('/drops');
            equal(res.status, 200);
            const h = res.text;
            assert(h.includes('Dropping this week and after'), 'the heading');
            assert(h.includes('Air Max 90'), 'a release');
            assert(h.includes('Nike SNKRS launch calendar'), 'the source');
            assert(h.includes('Never automated entries'), 'the raffle rule');
            assert(h.includes('Sign in to be reminded'), 'signed out prompt');
        });

        await check('POST /drops/:id/remind: the drop goes on the person’s Today agenda', async () => {
            const drops = (await t.get('/api/v1/drops')).json().drops;
            const future = drops.find((d) => Date.parse(d.release_at) > Date.now());
            assert(future, 'a future release');
            const res = await t.get(`/drops/${encodeURIComponent(future.id)}/remind`, { as: user, method: 'POST' });
            equal(res.status, 302);
            assert(res.headers.get('location').startsWith('/drops?notice='), 'back to the calendar');
            equal(t.upstreams.state.todayRequests.length, 1);
            const sent = t.upstreams.state.todayRequests[0];
            equal(sent.body.kind, 'event');
            assert(sent.body.title.startsWith('Drop: '), 'the event title');
            equal(sent.body.starts_at, future.release_at);
            assert(sent.headers.authorization.startsWith('Bearer '), 'the person token');
        });

        await check('GET /track and POST /track: a pasted link becomes a watch', async () => {
            const page = await t.get('/track', { as: user });
            equal(page.status, 200);
            assert(page.text.includes('name="url"'), 'the form');
            const res = await t.get('/track', { as: user, form: { url: 'https://www.ebay.com/itm/999' } });
            equal(res.status, 302);
            assert(res.headers.get('location').startsWith('/watches?notice='), 'to the watches');
            const watches = (await t.get('/api/v1/me/watches', { as: user })).json().watches;
            assert(watches.some((w) => w.kind === 'link' && w.source_url === 'https://www.ebay.com/itm/999'), 'the link watch');
        });

        await check('GET /watches signed in: the watches, with the Watch note', async () => {
            const res = await t.get('/watches?notice=hello', { as: user });
            equal(res.status, 200);
            assert(res.text.includes('Watches'), 'the heading');
            assert(res.text.includes('hello'), 'the notice');
            assert(res.text.includes('https://www.ebay.com/itm/999'), 'the pasted link');
            const out = await t.get('/watches');
            assert(out.text.includes('Sign in to see your watches'), 'signed out');
        });

        await check('GET /developers: the routes, sources and examples', async () => {
            const res = await t.get('/developers');
            equal(res.status, 200);
            const h = res.text;
            assert(h.includes('The Shoes API'), 'the heading');
            assert(h.includes('/api/v1/shoes'), 'the routes');
            assert(h.includes('/api/openapi.json'), 'OpenAPI');
            assert(h.includes('No scraping'), 'the source rule');
            assert(h.includes('OpenVibe.Watch'), 'the watch service');
        });

        await check('discovery: robots.txt, sitemap.xml, llms.txt, llms-full.txt', async () => {
            const robots = await t.get('/robots.txt');
            equal(robots.status, 200);
            assert(robots.text.includes('Sitemap: https://open.shoes/sitemap.xml'), 'the sitemap');
            assert(robots.text.includes('/watches'), 'the private page is disallowed');
            const sitemap = await t.get('/sitemap.xml');
            equal(sitemap.status, 200);
            assert(sitemap.text.includes('/shoe/nike-air-max-90'), 'the model page');
            const llms = await t.get('/llms.txt');
            equal(llms.status, 200);
            assert(llms.text.includes('OpenVibe.Shoes'), 'the llms index');
            const full = await t.get('/llms-full.txt');
            equal(full.status, 200);
            assert(full.text.includes('Nike Air Max 90'), 'the full pages');
        });

        await check('a missing page is 404 through the layout', async () => {
            const res = await t.get('/no-such-page');
            equal(res.status, 404);
            assert(res.text.includes('No such page'), 'the not-found page');
            equal((await t.get('/shoe/no-such-shoe')).status, 404);
        });
    } finally {
        await t.close();
    }
    done();
})().catch((err) => { console.error(err); process.exit(1); });
