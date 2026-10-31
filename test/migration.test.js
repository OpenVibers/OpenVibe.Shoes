'use strict';

/** The migration: every table the service writes and the constraints that keep an invented row out. */
const { check, done, assert, equal } = require('./helpers/check');
const { testDb } = require('./helpers/db');

(async () => {
    const test = await testDb();
    const db = test.db;
    try {
        const tables = (await db.many("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema() ORDER BY table_name")).map((r) => r.name);
        for (const t of ['shoe_models', 'shoe_offers', 'shoe_snapshots', 'shoe_drops', 'shoe_watches', 'shoe_facts', 'shoe_job_runs', 'account_data_events', 'telemetry_samples']) {
            assert(tables.includes(t), `missing table ${t}`);
        }

        await check('a model, an offer and a snapshot accept the ids and amounts the code writes', async () => {
            await db.exec(`INSERT INTO shoe_models (id, slug, brand, model, name, first_seen_at) VALUES ('shm_01J000000000000000000000AA', 'nike-air-max-90', 'Nike', 'Air Max 90', 'Air Max 90', now())`);
            await db.exec(`INSERT INTO shoe_offers (id, model_id, source, source_id, store_domain, title, url, price_amount, shipping_amount, checked_at, size, condition)
                VALUES ('sho_01J000000000000000000000AA', 'shm_01J000000000000000000000AA', 'deals', 'd1', 'zappos.com', 'Nike Air Max 90', 'https://www.zappos.com/p/1', 89.95, 0, now(), '10.5', 'new')`);
            await db.exec(`INSERT INTO shoe_snapshots (id, offer_id, model_id, price_amount, checked_at, day) VALUES ('shs_01J000000000000000000000AA', 'sho_01J000000000000000000000AA', 'shm_01J000000000000000000000AA', 89.95, now(), current_date)`);
            equal(Number(await db.value('SELECT COUNT(*)::int FROM shoe_offers')), 1);
        });

        await check('one snapshot per offer per day is a constraint, not a convention', async () => {
            let failed = false;
            try {
                await db.exec(`INSERT INTO shoe_snapshots (id, offer_id, model_id, price_amount, checked_at, day) VALUES ('shs_01J000000000000000000000AB', 'sho_01J000000000000000000000AA', 'shm_01J000000000000000000000AA', 88.00, now(), current_date)`);
            } catch { failed = true; }
            assert(failed, 'the unique (offer_id, day) refused a second point');
        });

        await check('the id shapes, conditions and URLs are checked by the database', async () => {
            let failed = 0;
            for (const sql of [
                `INSERT INTO shoe_models (id, slug, brand, model, name, first_seen_at) VALUES ('bad', 'x', 'Nike', 'X', 'X', now())`,
                `INSERT INTO shoe_offers (id, model_id, source, source_id, store_domain, title, url, checked_at) VALUES ('sho_01J000000000000000000000AC', 'shm_01J000000000000000000000AA', 'deals', 'd2', 'x.com', 'X', 'not a url', now())`,
                `INSERT INTO shoe_offers (id, model_id, source, source_id, store_domain, title, url, condition, checked_at) VALUES ('sho_01J000000000000000000000AD', 'shm_01J000000000000000000000AA', 'deals', 'd3', 'x.com', 'X', 'https://x.com/1', 'refurbished', now())`,
                `INSERT INTO shoe_watches (id, subject, kind, status) VALUES ('shw_01J000000000000000000000AA', 'usr_01J000000000000000000000AA', 'guess', 'active')`,
                `INSERT INTO shoe_facts (id, model_id, kind, label, value, source_name, source_url, fetched_at) VALUES ('shf_01J000000000000000000000AA', 'shm_01J000000000000000000000AA', 'guess', 'x', 'y', 'z', 'https://example.com', now())`,
            ]) {
                try { await db.exec(sql); } catch { failed++; }
            }
            equal(failed, 5);
        });

        await check('the same source id cannot make two offers', async () => {
            let failed = false;
            try {
                await db.exec(`INSERT INTO shoe_offers (id, model_id, source, source_id, store_domain, title, url, checked_at) VALUES ('sho_01J000000000000000000000AE', 'shm_01J000000000000000000000AA', 'deals', 'd1', 'x.com', 'X', 'https://x.com/1', now())`);
            } catch { failed = true; }
            assert(failed, 'the unique (source, source_id) refused it');
        });
    } finally {
        await test.close();
    }
    done();
})().catch((err) => { console.error(err); process.exit(1); });
