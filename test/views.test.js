'use strict';

/**
 * The page's small pure pieces: the release variants become one row, money is never a made-up zero, and a price
 * history with one point is still drawn as one point (no fabricated curve).
 */
const { check, done, assert, equal } = require('./helpers/check');
const views = require('../server/views');

(async () => {
    await check('groupDrops: one row per model, colourway and release moment', () => {
        const base = { brand: 'Jordan', model: '6 Retro', colourway: 'White Infrared', release_at: '2026-11-07T15:00:00.000Z', source_name: 'Nike SNKRS', source_url: 'https://www.nike.com/launch' };
        const out = views.groupDrops([
            { ...base, id: 'a', price: 215, sizes: ['9'] },
            { ...base, id: 'b', price: 155, sizes: ['10', '9'] },
            { ...base, id: 'c', colourway: 'Green Screen', price: 235, sizes: [] },
        ]);
        equal(out.length, 2);
        equal(out[0].variants, 2);
        equal(out[0].price, 155, 'the lowest price of the variants');
        equal(out[0].sizes, ['9', '10']);
        equal(out[1].colourway, 'Green Screen');
    });

    await check('money: a number, or a dash, never a zero', () => {
        equal(views.money(89.95), '$89.95');
        equal(views.money(1299), '$1,299.00');
        equal(views.money(null), '—');
        equal(views.money('not a number'), '—');
    });

    await check('historyChart: one real point is a dot, no curve invented', () => {
        const one = views.historyChart([{ day: '2026-10-31', price: 89.95 }]);
        assert(one.includes('<svg'), 'the chart');
        assert(one.includes('2026-10-31 → 2026-10-31'), 'one day');
        assert(!one.includes('No snapshot yet'), 'a point is a point');
        assert(views.historyChart([]).includes('No snapshot yet'), 'nothing yet says so');
    });

    await check('curveBars: an empty curve says not known yet', () => {
        assert(views.curveBars({ points: [], median: null }).includes('not stated'), 'the honest note');
        const bars = views.curveBars({ points: [{ size: '9', min_price: 90, vs_median_percent: -5 }], median: 95 });
        assert(bars.includes('sh-curve') && bars.includes('9'), 'a real bar');
        assert(bars.includes('−5.0%'), 'the comparison');
    });

    done();
})();
