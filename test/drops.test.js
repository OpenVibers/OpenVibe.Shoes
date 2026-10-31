'use strict';

/**
 * The release-page parser (server/domain/drops.js). It never invents a date: a release with no date or no model is
 * not returned, a launch payload's colourway is the quoted colour, and the size grid is the page's own.
 */
const { check, done, assert, equal } = require('./helpers/check');
const drops = require('../server/domain/drops');
const { LAUNCH_HTML, RSS } = require('./helpers/upstreams');

(async () => {
    await check('parseLaunchCalendar: dated releases with model, colourway, price and sizes', () => {
        const out = drops.parseLaunchCalendar(LAUNCH_HTML, { sourceName: 'Nike SNKRS', sourceUrl: 'https://www.nike.com/launch', fetchedAt: '2026-10-31T22:00:00Z' });
        equal(out.length, 2);
        equal(out[0].brand, 'Nike');
        equal(out[0].model, 'Air Max 90');
        equal(out[0].colourway, 'Medium Olive');
        equal(out[0].price, 130);
        equal(out[0].releaseAt, '2026-11-04T15:00:00.000Z');
        equal(out[0].sizes, ['10.5', '9']);
        equal(out[0].sourceName, 'Nike SNKRS');
        equal(out[0].fetchedAt, '2026-10-31T22:00:00Z');
        equal(out[1].brand, 'Jordan');
        equal(out[1].model, '6 Retro');
    });

    await check('parseLaunchCalendar: no commerceStartDate, no release', () => {
        equal(drops.parseLaunchCalendar('<html>nothing here</html>', { sourceName: 'x', sourceUrl: 'https://example.com' }), []);
        equal(drops.parseLaunchCalendar('{"commerceStartDate":"not a date","title":"Air Max 90"}', { sourceName: 'x', sourceUrl: 'https://example.com' }), []);
        equal(drops.parseLaunchCalendar('{"commerceStartDate":"2026-11-04T15:00:00Z"}', { sourceName: 'x', sourceUrl: 'https://example.com' }), []);
    });

    await check('parseRss: dated items only, with their link as the source', () => {
        const out = drops.parseRss(RSS, { sourceName: 'Example releases', sourceUrl: 'https://example.com/feed' });
        equal(out.length, 1);
        equal(out[0].brand, 'Puma');
        equal(out[0].model, 'Suede Classic');
        equal(out[0].sourceUrl, 'https://example.com/releases/puma-suede');
        equal(out[0].releaseAt, '2026-11-11T10:00:00.000Z');
    });

    await check('field: reads a quoted, numeric, boolean or null field', () => {
        equal(drops.field('{"a":"x\\"y","b":12.5,"c":true,"d":null}', 'a'), 'x"y');
        equal(drops.field('{"b":12.5}', 'b'), 12.5);
        equal(drops.field('{"c":true}', 'c'), true);
        equal(drops.field('{"d":null}', 'd'), null);
        equal(drops.field('{}', 'e'), null);
    });

    done();
})();
