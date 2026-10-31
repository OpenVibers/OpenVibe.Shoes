'use strict';

/**
 * The jobs (server/jobs/*) against in-process public sources: the offers job keeps only footwear, gets the brand
 * from the product, writes one snapshot per offer per day and never duplicates on a second run; the drops job
 * keeps only dated releases; the eBay job uses the official Browse API and is off without keys.
 */
const { check, done, assert, equal } = require('./helpers/check');
const configLib = require('../server/config');
const { testDb } = require('./helpers/db');
const { createStore } = require('../server/db');
const { createCatalogue } = require('../server/catalogue');
const { createUpstreams } = require('../server/upstreams');
const { createOffersJob } = require('../server/jobs/offers');
const { createDropsJob } = require('../server/jobs/drops');
const { createEbayJob } = require('../server/jobs/ebay');
const { startUpstreams } = require('./helpers/upstreams');

(async () => {
    const upstream = await startUpstreams();
    const test = await testDb();
    const config = configLib.load({
        NODE_ENV: 'test', BASE_URL: 'https://open.shoes',
        SHOES_DEALS_URL: upstream.url, SHOES_OFFERS_PAGES: '2', SHOES_PRODUCT_LOOKUPS: '20',
        SHOES_DROPS_URL: `${upstream.url}/launch`, SHOES_DROPS_SOURCE_NAME: 'Nike SNKRS launch calendar',
        SHOES_DROP_FEEDS: JSON.stringify([{ url: `${upstream.url}/feed`, name: 'Example releases', type: 'rss' }]),
        SHOES_EBAY_CLIENT_ID: 'ebay-id', SHOES_EBAY_CLIENT_SECRET: 'ebay-secret', SHOES_EBAY_API_URL: upstream.url,
        SHOES_EBAY_LIMIT: '10', SHOES_UPSTREAM_TIMEOUT_MS: '4000',
    });
    const s = createStore(test.db, { now: () => Date.parse('2026-10-31T22:00:00Z') });
    const catalogue = createCatalogue(s, { staleHours: 48 });
    const upstreams = createUpstreams({ config, log: { warn() {}, log() {} } });
    const offersJob = createOffersJob({ config, catalogue, upstreams, log: { log() {}, warn() {} } });
    const dropsJob = createDropsJob({ config, catalogue, upstreams, log: { log() {}, warn() {} } });
    const ebayJob = createEbayJob({ config, catalogue, upstreams, log: { log() {}, warn() {} } });

    try {
        await check('offers: only footwear, brand from the product, one model each', async () => {
            const out = await offersJob.runOnce({ pages: 2 });
            equal(out.seen, 5);
            equal(out.candidates, 4, 'the joggers are not footwear');
            equal(out.offers, 4);
            const counts = await catalogue.counts();
            equal(counts.models, 4);
            equal(counts.offers, 4);
            equal(counts.snapshots, 4);
            const airmax = await catalogue.modelBySlug('nike-air-max-90');
            assert(airmax, 'Nike Air Max 90 is a model');
            const jordan = await catalogue.modelBySlug('jordan-1-mid');
            assert(jordan, 'Air Jordan 1 Mid is the model jordan-1-mid');
            equal(jordan.brand, 'Jordan');
            equal(jordan.model, '1 Mid');
            const samba = await catalogue.modelBySlug('adidas-samba-og');
            assert(samba, 'Samba OG model');
            const offers = await catalogue.offersOf(airmax.id);
            equal(offers.length, 1);
            equal(offers[0].all_in, 89.95);
            equal(offers[0].drop_from_list, 40.05);
        });

        await check('offers: a second run does not duplicate an offer or snapshots', async () => {
            const out = await offersJob.runOnce({ pages: 2 });
            equal(out.offers, 4);
            const counts = await catalogue.counts();
            equal(counts.offers, 4);
            equal(counts.snapshots, 4);
        });

        await check('drops: the launch calendar and the RSS feed, only dated releases', async () => {
            const out = await dropsJob.runOnce();
            equal(out.sources, 2);
            equal(out.releases, 3, 'two launch releases and one RSS item');
            equal(out.drops, 3);
            const drops = await catalogue.listDrops({ from: '2026-11-01T00:00:00Z' });
            equal(drops.length, 3);
            assert(drops.some((d) => d.brand === 'Puma' && d.model === 'Suede Classic'), 'the RSS item');
            assert(drops.every((d) => d.source_url.startsWith('http')), 'every drop cites its page');
        });

        await check('ebay: the official Browse API, with the seller and its shipping', async () => {
            assert(upstreams.ebayConfigured(), 'configured');
            const out = await ebayJob.runOnce();
            assert(out.configured, 'ran');
            equal(out.items, 2);
            equal(out.offers, 2);
            const pegasus = (await catalogue.listShoes({ q: 'Pegasus' }))[0];
            assert(pegasus, 'the eBay Pegasus is in the catalogue');
            const offer = (await catalogue.offersOf(pegasus.id)).find((o) => o.source === 'ebay');
            assert(offer, 'the eBay offer exists');
            equal(offer.size, '10.5');
            equal(offer.all_in, 84.98);
        });

        await check('ebay: off without a key pair, a plain note not an error', async () => {
            const cfg = configLib.load({ NODE_ENV: 'test', BASE_URL: 'https://open.shoes', SHOES_EBAY_CLIENT_ID: '', SHOES_EBAY_CLIENT_SECRET: '' });
            const off = createEbayJob({ config: cfg, catalogue, upstreams: createUpstreams({ config: cfg, log: { warn() {} } }), log: { log() {}, warn() {} } });
            const out = await off.runOnce();
            equal(out.configured, false);
            equal(out.offers, 0);
            assert(/off/.test(out.note), 'the note says it is off');
        });

        await check('the job record says when each source was read', async () => {
            const last = await catalogue.lastJobRuns();
            const names = last.map((j) => j.job).sort();
            equal(names, ['drops', 'ebay', 'offers']);
            assert(last.every((j) => j.finished_at && j.ok), 'every job finished ok');
            assert(last.find((j) => j.job === 'offers').counts.offers === 4, 'the offers count is recorded');
        });
    } finally {
        await test.close();
        await upstream.close();
    }
    done();
})().catch((err) => { console.error(err); process.exit(1); });
