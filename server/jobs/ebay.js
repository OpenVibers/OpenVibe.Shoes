'use strict';

/**
 * The eBay job: when the host sets an eBay developer key pair, Shoes reads the official Browse API's shoe item
 * summaries (never a scrape) and writes them into the same catalogue as any other offer. Without the key pair it
 * is off and says so plainly; it is never an error.
 *
 * Off under SHOES_DRILL; tests and scripts call runOnce().
 */
const parse = require('../domain/parse');

function createEbayJob({ config, catalogue, upstreams, log = console }) {
    let timer = null;
    let running = false;

    async function runOnce() {
        if (!upstreams.ebayConfigured()) {
            return { configured: false, offers: 0, note: 'eBay is off (SHOES_EBAY_CLIENT_ID and SHOES_EBAY_CLIENT_SECRET are not set).' };
        }
        const runId = await catalogue.startJobRun({
            job: 'ebay',
            sourceName: 'eBay Browse API',
            sourceUrl: `${config.sources.ebay.apiUrl}/buy/browse/v1/item_summary/search`,
        });
        const counts = { items: 0, offers: 0, skipped: 0 };
        try {
            const out = await upstreams.ebayShoes();
            counts.items = out.items.length;
            for (const item of out.items) {
                if (!parse.isShoe(item.title)) { counts.skipped++; continue; }
                const row = await catalogue.upsertOffer({
                    ...item,
                    modelName: item.title,
                    colourway: parse.colourwayOf(item.title),
                    raw: { itemId: item.sourceId, condition: item.condition || null },
                });
                if (row) counts.offers++;
                else counts.skipped++;
            }
            await catalogue.finishJobRun(runId, { ok: true, counts });
            log.log(`[OpenVibe.Shoes] ebay: ${counts.offers} offers from ${counts.items} items`);
            return { configured: true, ...counts };
        } catch (err) {
            await catalogue.finishJobRun(runId, { ok: false, counts, error: err.message });
            throw err;
        }
    }

    function start() {
        if (config.drill || timer || !upstreams.ebayConfigured()) return;
        const tick = () => {
            if (running) return;
            running = true;
            runOnce().catch((err) => log.warn('[OpenVibe.Shoes] ebay job failed:', err.message)).finally(() => { running = false; });
        };
        timer = setInterval(tick, config.jobs.ebayIntervalMs);
        timer.unref();
        setTimeout(tick, 20_000).unref();
    }

    function stop() {
        if (timer) clearInterval(timer);
        timer = null;
    }

    return { name: 'ebay', runOnce, start, stop };
}

module.exports = { createEbayJob };
