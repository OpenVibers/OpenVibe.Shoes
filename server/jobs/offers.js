'use strict';

/**
 * The offers job: OpenVibe.Deals already aggregates stores' offers, so Shoes reads its public API (the same
 * newest-offer pages any person can read), keeps the footwear, and writes each one into Shoes' own catalogue with
 * its price, shipping, condition, size when the source names one, the time the source checked it and a stale flag.
 *
 * The brand and the clean model name come from the offer's product on Deals (its public product API). The
 * classifier (server/domain/parse.js) decides what is footwear; a title that names no shoe is never imported.
 *
 * Off under SHOES_DRILL; tests and scripts call runOnce().
 */
const parse = require('../domain/parse');

function createOffersJob({ config, catalogue, upstreams, log = console }) {
    let timer = null;
    let running = false;

    function shoeCandidate(offer) {
        const productName = offer && offer.product && offer.product.name ? offer.product.name : '';
        return parse.isShoe(offer && offer.title, productName);
    }

    async function runOnce({ pages = config.sources.offersPages, maxProductLookups = config.sources.productLookups } = {}) {
        const runId = await catalogue.startJobRun({
            job: 'offers',
            sourceName: 'OpenVibe.Deals',
            sourceUrl: `${config.sources.dealsUrl}/api/v1/offers`,
        });
        const counts = { pages: 0, seen: 0, candidates: 0, product_lookups: 0, offers: 0, skipped: 0 };
        const brands = new Map();
        try {
            const total = Math.max(1, Math.min(200, Number(pages) || 1));
            for (let page = 1; page <= total; page++) {
                const offers = await upstreams.dealsOffers(page);
                if (!offers.length) break;
                counts.pages++;
                counts.seen += offers.length;
                for (const offer of offers) {
                    if (!shoeCandidate(offer)) continue;
                    counts.candidates++;
                    const observation = offer.latest_observation || {};
                    const product = offer.product || {};
                    let brand = null;
                    if (product.slug && counts.product_lookups < maxProductLookups) {
                        if (brands.has(product.slug)) brand = brands.get(product.slug);
                        else {
                            const p = await upstreams.dealsProduct(product.slug);
                            counts.product_lookups++;
                            brand = p && p.brand ? p.brand : null;
                            brands.set(product.slug, brand);
                        }
                    }
                    const modelName = product.name || offer.title;
                    const checkedAt = observation.observed_at || observation.recorded_at || new Date().toISOString();
                    const row = await catalogue.upsertOffer({
                        source: 'deals',
                        sourceId: offer.id,
                        title: offer.title,
                        modelName,
                        brand,
                        url: offer.link || offer.url,
                        store: offer.store && offer.store.domain,
                        storeName: offer.store && offer.store.name,
                        price: observation.price,
                        listPrice: observation.list_price,
                        currency: observation.currency || 'USD',
                        shipping: observation.shipping,
                        condition: observation.condition,
                        size: parse.sizeOf(offer.title),
                        colourway: parse.colourwayOf(offer.title),
                        checkedAt,
                        raw: {
                            id: offer.id, slug: offer.slug, product: product.slug || null,
                            observed_at: observation.observed_at || null,
                        },
                    });
                    if (row) counts.offers++;
                    else counts.skipped++;
                    if (config.sources.requestGapMs) await upstreams.sleep(config.sources.requestGapMs / 2);
                }
                if (page < total && config.sources.requestGapMs) await upstreams.sleep(config.sources.requestGapMs);
            }
            await catalogue.finishJobRun(runId, { ok: true, counts });
            log.log(`[OpenVibe.Shoes] offers: ${counts.offers} offers from ${counts.candidates} shoe candidates over ${counts.pages} pages`);
            return counts;
        } catch (err) {
            await catalogue.finishJobRun(runId, { ok: false, counts, error: err.message });
            throw err;
        }
    }

    function start() {
        if (config.drill || timer) return;
        const tick = () => {
            if (running) return;
            running = true;
            runOnce().catch((err) => log.warn('[OpenVibe.Shoes] offers job failed:', err.message)).finally(() => { running = false; });
        };
        timer = setInterval(tick, config.jobs.offersIntervalMs);
        timer.unref();
        setTimeout(tick, 8_000).unref();
    }

    function stop() {
        if (timer) clearInterval(timer);
        timer = null;
    }

    return { name: 'offers', runOnce, start, stop, shoeCandidate };
}

module.exports = { createOffersJob };
