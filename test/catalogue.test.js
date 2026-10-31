'use strict';

/**
 * The catalogue (server/catalogue.js) on a real migrated PGlite database: one model per brand + model, one snapshot
 * per offer per day, all-in prices, the list-price and day-over-day drop, the size curve, drops, cited facts, a
 * person's watches and the job runs.
 */
const { check, done, assert, equal } = require('./helpers/check');
const { testDb } = require('./helpers/db');
const { createStore } = require('../server/db');
const { createCatalogue } = require('../server/catalogue');

(async () => {
    const test = await testDb();
    let clock = Date.parse('2026-10-31T22:00:00Z');
    const s = createStore(test.db, { now: () => clock });
    const c = createCatalogue(s, { staleHours: 48 });
    const user = 'usr_01J00000000000000000000AA';

    try {
        await check('upsertOffer creates a model from the product and the source brand', async () => {
            const a = await c.upsertOffer({
                source: 'deals', sourceId: 'deal-1', title: 'Nike Air Max 90 Running Shoe - White',
                modelName: 'Air Max 90', brand: 'Nike', url: 'https://www.zappos.com/p/1', store: 'zappos.com', storeName: 'Zappos',
                price: '100.00', listPrice: '130.00', shipping: '5.99', condition: 'New', size: '10.5', colourway: 'White',
                checkedAt: '2026-10-31T20:00:00Z', raw: { id: 'deal-1' },
            });
            assert(a, 'offer written');
            const model = await c.modelBySlug('nike-air-max-90');
            assert(model, 'model slug is nike-air-max-90');
            equal(model.brand, 'Nike');
            equal(model.model, 'Air Max 90');
            const offers = await c.offersOf(model.id);
            equal(offers.length, 1);
            equal(offers[0].all_in, 105.99);
            equal(offers[0].drop_from_list, 24.01);
            equal(offers[0].size, '10.5');
            equal(offers[0].colourway, 'White');
            equal(offers[0].stale, false);
        });

        await check('a second offer on the same model joins it; a duplicate source id updates', async () => {
            const b = await c.upsertOffer({
                source: 'deals', sourceId: 'deal-2', title: 'Nike Air Max 90 Running Shoe',
                modelName: 'Air Max 90', brand: 'Nike', url: 'https://www.footlocker.com/p/2', store: 'footlocker.com',
                price: '95.00', shipping: null, condition: 'new', size: '9', checkedAt: '2026-10-31T20:30:00Z',
            });
            assert(b, 'second offer');
            const model = await c.modelBySlug('nike-air-max-90');
            equal((await c.offersOf(model.id)).length, 2);
            await c.upsertOffer({
                source: 'deals', sourceId: 'deal-2', title: 'Nike Air Max 90 Running Shoe',
                modelName: 'Air Max 90', brand: 'Nike', url: 'https://www.footlocker.com/p/2', store: 'footlocker.com',
                price: '90.00', shipping: null, condition: 'new', size: '9', checkedAt: '2026-10-31T21:30:00Z',
            });
            const offers = await c.offersOf(model.id);
            equal(offers.length, 2, 'still two offers');
            equal(offers.find((o) => o.source === 'deals' && o.price === 90).all_in, 90);
        });

        await check('history: one snapshot per offer per day, the first check wins', async () => {
            const model = await c.modelBySlug('nike-air-max-90');
            const history = await c.history(model.id);
            equal(history.length, 1);
            equal(history[0].day, '2026-10-31');
            equal(history[0].offers, 2);
            equal(history[0].price, 95, 'the lowest offer of the day');
        });

        await check('a next-day check adds a point and a day-over-day drop', async () => {
            const model = await c.modelBySlug('nike-air-max-90');
            await c.upsertOffer({
                source: 'deals', sourceId: 'deal-2', title: 'Nike Air Max 90 Running Shoe',
                modelName: 'Air Max 90', brand: 'Nike', url: 'https://www.footlocker.com/p/2', store: 'footlocker.com',
                price: '70.00', shipping: null, condition: 'new', size: '9', checkedAt: '2026-11-01T09:00:00Z',
            });
            const history = await c.history(model.id);
            equal(history.length, 2);
            const listed = await c.listShoes({ brand: 'Nike', sort: 'drop' });
            assert(listed[0].drop_amount >= 24, 'the list-price drop is still the biggest');
            equal(listed[0].offer_count, 2);
            equal(listed[0].store_count, 2);
        });

        await check('curve: the lowest all-in per size, against the median', async () => {
            const model = await c.modelBySlug('nike-air-max-90');
            const curve = await c.curve(model.id);
            equal(curve.points.length, 2);
            equal(curve.points[0].size, '9');
            equal(curve.points[1].size, '10.5');
            assert(curve.median != null, 'a median size price');
            assert(curve.points.every((p) => p.vs_median_percent != null), 'every point says how it compares');
        });

        await check('listShoes: paging, filters and facets', async () => {
            const shoes = await c.listShoes({ limit: 1, offset: 0 });
            equal(shoes.length, 1);
            const total = await c.countShoes({ brand: 'Nike' });
            equal(total, 1);
            equal((await c.countShoes({ size: '10.5' })), 1);
            equal((await c.countShoes({ condition: 'used' })), 0);
            const facets = await c.facets();
            equal(facets.models, 1);
            equal(facets.offers, 2);
            assert(facets.brands.some((b) => b.value === 'Nike'), 'brand facet');
            assert(facets.sizes.some((s) => s.value === '10.5'), 'size facet');
        });

        await check('priceFor: the lowest all-in for a size', async () => {
            const model = await c.modelBySlug('nike-air-max-90');
            const any = await c.priceFor(model.id);
            equal(any.price, 70);
            const ten = await c.priceFor(model.id, { size: '10.5' });
            equal(ten.price, 105.99);
            const missing = await c.priceFor(model.id, { size: '4' });
            equal(missing.price, null);
        });

        await check('drops: upsert, list, one by id, stable slug', async () => {
            const d1 = await c.upsertDrop({
                brand: 'Nike', model: 'Air Max 90', colourway: 'Medium Olive', releaseAt: '2026-11-04T15:00:00Z',
                price: 130, sizes: ['9', '10.5'], sourceName: 'Nike SNKRS', sourceUrl: 'https://www.nike.com/launch',
                sourceKey: 'air-max-90|2026-11-04', fetchedAt: '2026-10-31T20:00:00Z',
            });
            assert(d1, 'drop written');
            const again = await c.upsertDrop({
                brand: 'Nike', model: 'Air Max 90', colourway: 'Medium Olive', releaseAt: '2026-11-04T15:00:00Z',
                price: 130, sizes: ['9', '10.5'], sourceName: 'Nike SNKRS', sourceUrl: 'https://www.nike.com/launch',
                sourceKey: 'air-max-90|2026-11-04', fetchedAt: '2026-10-31T21:00:00Z',
            });
            equal(again.id, d1.id, 'the source key updates the same drop');
            const list = await c.listDrops({ from: '2026-11-01T00:00:00Z' });
            equal(list.length, 1);
            equal(list[0].sizes, ['9', '10.5']);
            equal((await c.dropById(d1.id)).model, 'Air Max 90');
            equal(await c.upsertDrop({ brand: 'Nike', model: 'No URL', releaseAt: '2026-11-04T15:00:00Z', sourceName: 'x', sourceKey: 'k' }), null);
        });

        await check('facts: only cited, only the four kinds', async () => {
            const model = await c.modelBySlug('nike-air-max-90');
            const fact = await c.addFact({ modelId: model.id, kind: 'specs', label: 'Weight', value: '12.1 oz', sourceName: 'Nike', sourceUrl: 'https://www.nike.com/air-max-90', fetchedAt: '2026-10-31T20:00:00Z' });
            assert(fact, 'fact written');
            equal(await c.addFact({ modelId: model.id, kind: 'guess', label: 'x', value: 'y', sourceName: 'z', sourceUrl: 'https://example.com' }), null);
            equal(await c.addFact({ modelId: model.id, kind: 'fit', label: 'x', value: 'y', sourceName: 'z', sourceUrl: 'not a url' }), null);
            const facts = await c.factsOf(model.id);
            equal(facts.length, 1);
            equal(facts[0].source_url, 'https://www.nike.com/air-max-90');
        });

        await check('watches: a person’s own, newest first', async () => {
            clock += 1000;
            await c.createWatch({ subject: user, kind: 'price', modelId: (await c.modelBySlug('nike-air-max-90')).id, slug: 'nike-air-max-90', size: '10.5', threshold: 90, remoteId: 'wch_1', status: 'active' });
            clock += 1000;
            await c.createWatch({ subject: user, kind: 'link', sourceUrl: 'https://www.ebay.com/itm/1', status: 'not_connected', note: 'no token' });
            const list = await c.listWatches(user);
            equal(list.length, 2);
            equal(list[0].kind, 'link');
            equal(list[1].threshold, 90);
            equal((await c.listWatches('usr_01J00000000000000000000BB')).length, 0);
        });

        await check('job runs: start, finish and the last run per job', async () => {
            const id = await c.startJobRun({ job: 'offers', sourceName: 'OpenVibe.Deals', sourceUrl: 'https://openvibe.deals/api/v1/offers' });
            await c.finishJobRun(id, { ok: true, counts: { offers: 2 } });
            const last = await c.lastJobRuns();
            equal(last.length, 1);
            equal(last[0].job, 'offers');
            equal(last[0].ok, true);
            equal(last[0].counts.offers, 2);
        });

        await check('stale is computed from the check time, not frozen at import', async () => {
            const model = await c.modelBySlug('nike-air-max-90');
            await s.db.exec("UPDATE shoe_offers SET stale = false, checked_at = '2026-10-25T12:00:00Z' WHERE model_id = $1", [model.id]);
            const offers = await c.offersOf(model.id);
            assert(offers.length && offers.every((o) => o.stale), 'every old offer reads stale');
            const listed = await c.listShoes({ brand: 'Nike' });
            equal(listed[0].stale_count, 2);
            equal((await c.facets()).stale_offers, 2);
        });

        await check('counts: the rows the seed report prints', async () => {
            const counts = await c.counts();
            equal(counts.models, 1);
            equal(counts.offers, 2);
            equal(counts.snapshots, 3);
            equal(counts.drops, 1);
            equal(counts.watches, 2);
            equal(counts.facts, 1);
        });
    } finally {
        await test.close();
    }
    done();
})().catch((err) => { console.error(err); process.exit(1); });
