'use strict';
/**
 * Shoe models in OpenVibe.Search (server/search-index.js): a sweep puts every model in the outbox as one
 * shoes.index_document.upserted, exactly the contract (contracts 0.273.0), with its /shoe/<slug> page (which answers),
 * its brand, store count and lowest price; a second sweep sends nothing; a model that left the catalogue becomes a
 * tombstone, once.
 */
const assert = require('assert');
const contracts = require('openvibe-contracts');
const { boot, check, done } = require('./helpers/boot');
const { describe } = require('../server/search-index');

(async () => {
    const t = await boot();
    const { s, searchIndex } = t.ctx;
    const outbox = async () => (await s.db.many('SELECT envelope FROM event_outbox ORDER BY id')).map((r) => r.envelope);
    const valid = (env) => {
        assert.ok(contracts.validate('events.event-envelope@1', env).valid, 'envelope');
        const p = contracts.validate(env.event_type, env.payload);
        assert.ok(p.valid, `${env.event_type}: ${JSON.stringify(p.errors)}`);
        assert.strictEqual(env.source, 'shoes');
        return env;
    };

    await t.ctx.jobs.offers.runOnce({ pages: 2 });
    const models = await s.db.many('SELECT slug FROM shoe_models ORDER BY slug');

    await check('a sweep sends every model once, as the contract says, and the page it names answers', async () => {
        assert.ok(models.length >= 2, `the offers job made models (${models.length})`);
        const res = await searchIndex.sweep();
        assert.deepStrictEqual(res.shoe, { seen: models.length, sent: models.length, removed: 0, failed: 0 });
        const envs = (await outbox()).map(valid);
        const doc = envs.find((e) => e.payload.id === models[0].slug).payload;
        assert.strictEqual(doc.canonical_url, `${t.config.baseUrl}/shoe/${models[0].slug}`);
        assert.strictEqual(doc.type, 'shoe');
        assert.ok(doc.title && doc.facets.brand, 'a name and a brand');
        assert.match(doc.summary, /store/);
        assert.strictEqual((await t.get(`/shoe/${models[0].slug}`)).status, 200);
        assert.strictEqual((await searchIndex.sweep()).shoe.sent, 0, 'a second sweep sends nothing');
    });

    await check('a model with no live offer is noindex; with offers, the lowest dollar price and the store count', async () => {
        const none = describe({ name: 'Plain Runner', brand: 'Acme', model: 'Plain Runner', store_count: 0, price_min: null });
        assert.strictEqual(none.noindex, true);
        assert.match(none.summary, /No store lists it right now/);
        const some = describe({ name: 'Air Max 90', brand: 'Nike', model: 'Air Max 90', store_count: 3, price_min: '98.40' });
        assert.strictEqual(some.noindex, false);
        assert.match(some.summary, /From \$98 at 3 stores today/);
        assert.deepStrictEqual(some.facets, { brand: 'Nike', stores: 3, lowest_price: 98 });
    });

    await check('a model that left the catalogue becomes a tombstone, once', async () => {
        const gone = models[models.length - 1].slug;
        await s.db.many('DELETE FROM shoe_models WHERE slug = $1 RETURNING slug', [gone]);
        assert.strictEqual((await searchIndex.sweep()).shoe.removed, 1);
        const env = valid((await outbox()).pop());
        assert.strictEqual(env.event_type, 'shoes.index_document.deleted');
        assert.deepStrictEqual([env.payload.type, env.payload.id], ['shoe', gone]);
        assert.strictEqual((await searchIndex.sweep()).shoe.removed, 0);
    });

    done();
})();
