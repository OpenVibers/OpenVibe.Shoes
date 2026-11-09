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

function createOffersJob({ config, catalogue, products, upstreams, log = console }) {
    let timer = null;
    let running = false;

    function shoeCandidate(offer) {
        const productName = offer && offer.product && offer.product.name ? offer.product.name : '';
        return parse.isShoe(offer && offer.title, productName);
    }

    function productKind(offer) {
        const text = `${offer && offer.title || ''} ${offer && offer.product && offer.product.name || ''}`.toLowerCase();
        if (/\b(shoelaces?|laces)\b/.test(text)) return 'laces';
        if (/\b(socks?|compression socks?)\b/.test(text)) return 'socks';
        if (/\b(insoles?|orthotic inserts?)\b/.test(text)) return 'insoles';
        if (/\b(shoe care|shoe cleaner|sneaker cleaner|shoe brush|cleaning kit|shoe protector|waterproofing spray)\b/.test(text)) return 'care';
        if (shoeCandidate(offer)) return /\b(baby|toddler|kids?|children['’]?s)\b/.test(text) ? 'kids' : 'shoe';
        return null;
    }

    async function runOnce({ pages = config.sources.offersPages, maxProductLookups = config.sources.productLookups } = {}) {
        const runId = await catalogue.startJobRun({
            job: 'offers',
            sourceName: 'OpenVibe.Deals',
            sourceUrl: `${config.sources.dealsUrl}/api/v1/offers`,
        });
        const counts = { pages: 0, seen: 0, candidates: 0, product_lookups: 0, offers: 0, products: 0, accessory_offers: 0, skipped: 0 };
        const productsSeen = new Map();
        try {
            const total = Math.max(1, Math.min(200, Number(pages) || 1));
            for (let page = 1; page <= total; page++) {
                const offers = await upstreams.dealsOffers(page);
                if (!offers.length) break;
                counts.pages++;
                counts.seen += offers.length;
                for (const offer of offers) {
                    const kind = productKind(offer);
                    if (!kind) continue;
                    counts.candidates++;
                    const observation = offer.latest_observation || {};
                    const product = offer.product || {};
                    let sourceProduct = null;
                    if (product.slug && counts.product_lookups < maxProductLookups) {
                        if (productsSeen.has(product.slug)) sourceProduct = productsSeen.get(product.slug);
                        else {
                            const p = await upstreams.dealsProduct(product.slug);
                            counts.product_lookups++;
                            sourceProduct = p || null;
                            productsSeen.set(product.slug, sourceProduct);
                        }
                    }
                    const brand = sourceProduct && sourceProduct.brand ? sourceProduct.brand : null;
                    const modelName = sourceProduct && sourceProduct.name || product.name || offer.title;
                    const checkedAt = observation.observed_at || observation.recorded_at || new Date().toISOString();
                    if (kind !== 'shoe') {
                        if (!products || !product.slug || !sourceProduct || !offer.link && !offer.url) { counts.skipped++; continue; }
                        const slug = String(product.slug).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 150);
                        const catalogProduct = await products.upsert({
                            kind, slug, title: modelName, brand, model: modelName, url: `https://openvibe.deals/products/${encodeURIComponent(product.slug)}`,
                            sizes: [parse.sizeOf(offer.title)].filter(Boolean), sourceName: 'OpenVibe.Deals',
                            sourceUrl: `https://openvibe.deals/api/v1/products/${encodeURIComponent(product.slug)}`, checkedAt, facts: [],
                        });
                        const item = await products.upsertOffer({
                            productSlug: catalogProduct.id, source: 'deals', sourceId: offer.id, storeDomain: offer.store && offer.store.domain,
                            storeName: offer.store && offer.store.name, title: offer.title, url: offer.link || offer.url,
                            price: observation.price, shipping: observation.shipping, currency: observation.currency || 'USD',
                            size: parse.sizeOf(offer.title), condition: observation.condition, checkedAt, raw: { id: offer.id, product: product.slug },
                        });
                        if (catalogProduct) counts.products++;
                        if (item) counts.accessory_offers++;
                        else counts.skipped++;
                        if (config.sources.requestGapMs) await upstreams.sleep(config.sources.requestGapMs / 2);
                        continue;
                    }
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
            log.log(`[Open.Shoes] offers: ${counts.offers} shoe offers and ${counts.accessory_offers} product offers from ${counts.candidates} candidates over ${counts.pages} pages`);
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
            runOnce().catch((err) => log.warn('[Open.Shoes] offers job failed:', err.message)).finally(() => { running = false; });
        };
        timer = setInterval(tick, config.jobs.offersIntervalMs);
        timer.unref();
        setTimeout(tick, 8_000).unref();
    }

    function stop() {
        if (timer) clearInterval(timer);
        timer = null;
    }

    return { name: 'offers', runOnce, start, stop, shoeCandidate, productKind };
}

module.exports = { createOffersJob };
