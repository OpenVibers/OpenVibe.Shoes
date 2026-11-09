'use strict';

const { check, done, equal, assert } = require('./helpers/check');
const { laceLength, sizeConvert, asProduct, KINDS } = require('../server/product-catalog');

(async () => {
    await check('lacing estimates use the cited formula and disclose assumptions', () => {
        const cross = laceLength({ eyeletPairs: 6 });
        equal(cross.cm, 105);
        equal(cross.inches, 40);
        equal(cross.source.name, "Ian's Shoelace Site");
        assert(cross.assumptions.horizontal_cm > 0);
        equal(laceLength({ eyeletPairs: 6, method: 'bow-tie' }).cm, 90);
        equal(laceLength({ eyeletPairs: 99 }), null);
    });
    await check('brand size conversion is sourced and rejects unknown charts', () => {
        equal(sizeConvert({ system: 'women', size: '8' }).conversions[0].size, 'M');
        equal(sizeConvert({ system: 'kids', size: '1' }).conversions[0].size, 'M');
        equal(sizeConvert({ system: 'men', size: 15 }).conversions.length, 0);
        equal(sizeConvert({ system: 'men', size: 10, brand: 'other' }), null);
    });
    await check('product kinds and shoe wire shape match the shared contract', () => {
        equal(KINDS, ['shoe', 'laces', 'socks', 'care', 'insoles', 'kids']);
        const p = asProduct({ slug: 'test-shoe', brand: 'Test', model: 'Runner', first_seen: '2026-11-01T00:00:00Z' });
        equal(p.id, 'test-shoe');
        equal(p.kind, 'shoe');
        equal(p.facts, []);
    });
    done();
})().catch((e) => { console.error(e); process.exit(1); });
