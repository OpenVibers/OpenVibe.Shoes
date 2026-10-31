#!/usr/bin/env node
'use strict';

/**
 * One first run of every source, locally, and a printed report of what was written.
 *
 *   node scripts/seed.js              # offers + drops + ebay (if configured)
 *   SHOES_OFFERS_PAGES=80 node scripts/seed.js
 *
 * It reads the live public sources (OpenVibe.Deals, the official release page, eBay only with keys). It writes
 * the same database the service uses: PostgreSQL when DATABASE_URL is set, else the development PGlite directory.
 * Nothing is invented: a source that does not answer is reported and the other jobs still run.
 */
const configLib = require('../server/config');
const { openStore } = require('../server/db');
const { createCatalogue } = require('../server/catalogue');
const { createUpstreams } = require('../server/upstreams');
const { createOffersJob } = require('../server/jobs/offers');
const { createDropsJob } = require('../server/jobs/drops');
const { createEbayJob } = require('../server/jobs/ebay');

async function main() {
    const config = configLib.load();
    const log = console;
    const s = await openStore(config, { log });
    const catalogue = createCatalogue(s, { staleHours: config.sources.staleHours });
    const upstreams = createUpstreams({ config, log });
    const offers = createOffersJob({ config, catalogue, upstreams, log });
    const drops = createDropsJob({ config, catalogue, upstreams, log });
    const ebay = createEbayJob({ config, catalogue, upstreams, log });
    const report = { started_at: new Date().toISOString(), sources: {}, counts: {} };

    try {
        const steps = [
            ['offers', () => offers.runOnce({ pages: config.sources.offersPages, maxProductLookups: config.sources.productLookups })],
            ['drops', () => drops.runOnce()],
            ['ebay', () => ebay.runOnce()],
        ];
        for (const [name, run] of steps) {
            const at = Date.now();
            try {
                const out = await run();
                report.sources[name] = { ok: true, ms: Date.now() - at, ...out };
                console.log(`[seed] ${name}: ok in ${Date.now() - at} ms`, out);
            } catch (err) {
                report.sources[name] = { ok: false, ms: Date.now() - at, error: err && err.message ? err.message : String(err) };
                console.warn(`[seed] ${name}: failed — ${err && err.message ? err.message : err}`);
            }
        }
        report.counts = await catalogue.counts();
        report.jobs = await catalogue.lastJobRuns();
        report.finished_at = new Date().toISOString();
        console.log('\n[seed] counts:', report.counts);
        console.log('[seed] jobs:', report.jobs.map((j) => `${j.job}:${j.ok ? 'ok' : 'failed'}`).join(' '));
        console.log(`[seed] ${JSON.stringify(report)}`);
    } finally {
        await s.close();
    }
    return report;
}

if (require.main === module) {
    main().then((report) => {
        const any = Object.values(report.sources).some((x) => x.ok);
        process.exit(any ? 0 : 1);
    }, (err) => { console.error('[seed] fatal:', err); process.exit(1); });
}

module.exports = { main };
