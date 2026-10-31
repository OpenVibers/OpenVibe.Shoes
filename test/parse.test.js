'use strict';

/**
 * The pure rules (server/domain/parse.js). These are the promises the pages make: a size is shown only when a
 * source names one, a shoe is footwear, the brand and model are not guessed, and an all-in price never invents
 * shipping.
 */
const { check, done, assert, equal } = require('./helpers/check');
const parse = require('../server/domain/parse');

(async () => {
    await check('isShoe: footwear words and shoe-only models', () => {
        assert(parse.isShoe('Nike Air Max 90 Running Shoe - White'), 'running shoe');
        assert(parse.isShoe('Air Jordan 1 Mid Sneaker'), 'sneaker');
        assert(parse.isShoe('Nike Air Force 1 \'07'), 'a model only a shoe has, no footwear word');
        assert(parse.isShoe('Birkenstock Boston Clog'), 'clog');
        assert(!parse.isShoe('Under Armour Rival Fleece Joggers'), 'joggers are not shoes');
        assert(!parse.isShoe('Nike Dri-FIT T-Shirt'), 'a shirt with a shoe brand is not a shoe');
        assert(!parse.isShoe('The North Face Hoodie'), 'a hoodie is not a shoe');
    });

    await check('brandOf: the source brand first, the title second', () => {
        equal(parse.brandOf('Air Max 90', 'Nike'), 'Nike');
        equal(parse.brandOf('air jordan 1 mid', null), 'Jordan', 'Air Jordan is the Jordan brand');
        equal(parse.brandOf('New Balance 990v6', null), 'New Balance');
        equal(parse.brandOf('ASICS Gel-Kayano 31', null), 'ASICS');
        equal(parse.brandOf('Samba OG', 'adidas'), 'Adidas', 'a known brand is canonical, not a second spelling');
        equal(parse.brandOf('Pickleball', 'SKECHERS'), 'Skechers');
        equal(parse.brandOf('A shoe with no brand', null), null);
    });

    await check('modelOf: person words, the brand, the kind and a quoted colourway taken off', () => {
        equal(parse.modelOf("Women's Nike Air Max 90 Running Shoe", 'Nike'), 'Air Max 90');
        equal(parse.modelOf('Air Jordan 14 Retro "Forest Green"', 'Jordan'), '14 Retro');
        equal(parse.modelOf('Adidas Samba OG Shoes Size 10.5', 'Adidas'), 'Samba OG Size 10.5');
        equal(parse.modelOf('Air Max 90 - Men\'s', 'Nike'), 'Air Max 90');
        equal(parse.modelOf('990v6', 'New Balance'), '990v6');
    });

    await check('colourwayOf: quoted in the title, or the source hint', () => {
        equal(parse.colourwayOf('Air Max 90 "Medium Olive"'), 'Medium Olive');
        equal(parse.colourwayOf('Air Max 90', 'White/Black'), 'White/Black');
        equal(parse.colourwayOf('Air Max 90'), null);
    });

    await check('sizeOf and cleanSize: only a size the source names', () => {
        equal(parse.sizeOf('Nike Air Max 90 Size 10.5'), '10.5');
        equal(parse.sizeOf('Adidas Samba US 9'), '9');
        equal(parse.sizeOf('Nike Air Max 90'), null);
        equal(parse.sizeOf('Nike Air Max 90 - 10.5'), null, 'a bare number is not a size');
        equal(parse.cleanSize('10.5'), '10.5');
        equal(parse.cleanSize('10.5c'), '10.5C');
        equal(parse.cleanSize('5y'), '5Y');
    });

    await check('conditionOf: new, used, deadstock or not stated', () => {
        equal(parse.conditionOf('New with box'), 'new');
        equal(parse.conditionOf('pre-owned'), 'used');
        equal(parse.conditionOf('Deadstock'), 'deadstock');
        equal(parse.conditionOf(''), null);
        equal(parse.conditionOf('refurbished'), null, 'never guess a condition');
    });

    await check('amountOf and allIn: shipping only when stated', () => {
        equal(parse.amountOf('$1,299.00'), 1299);
        equal(parse.amountOf('89.95'), 89.95);
        equal(parse.amountOf(''), null);
        equal(parse.allIn(100, 5.99), { amount: 105.99, shippingKnown: true, shipping: 5.99 });
        equal(parse.allIn(100, null), { amount: 100, shippingKnown: false, shipping: null });
        equal(parse.allIn(null, 5), { amount: null, shippingKnown: false, shipping: null });
    });

    await check('slugFor: the page path, bounded', () => {
        equal(parse.slugFor('Nike', 'Air Max 90'), 'nike-air-max-90');
        equal(parse.slugFor('New Balance', '990v6'), 'new-balance-990v6');
        assert(parse.slugFor('A'.repeat(80), 'B'.repeat(80)).length <= 80, 'slug bounded');
        assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(parse.slugFor('Dr. Martens', '1460 Boot')), 'slug shape');
    });

    await check('dayOf and isStale: UTC day and the stale window', () => {
        equal(parse.dayOf('2026-10-31T23:59:59Z'), '2026-10-31');
        equal(parse.dayOf('not a date'), null);
        const now = Date.parse('2026-10-31T12:00:00Z');
        assert(parse.isStale('2026-10-29T11:00:00Z', now, 48), '49 hours is stale');
        assert(!parse.isStale('2026-10-30T12:00:00Z', now, 48), '24 hours is fresh');
        assert(!parse.isStale('not a date', now, 48), 'an unknown time is not stale');
    });

    done();
})();
