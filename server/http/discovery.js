'use strict';

/**
 * Crawl artifacts for open.shoes: robots.txt, sitemap.xml, llms.txt and llms-full.txt. The model pages, the
 * catalogue and the drops are for search engines and AI crawlers; sign-in, the API, account pages and the internal
 * route are not. A sitemap lists every model Shoes knows (up to 100 in the artifact; the API pages the rest).
 */
const fs = require('fs');
const path = require('path');
const seo = require('openvibe-shared/seo');
const cache = require('openvibe-shared/cache-policy');
const { asyncRouter } = require('./router');

const SITE_NAME = 'OpenVibe.Shoes';
const HOST = 'open.shoes';
const DESCRIPTION = 'OpenVibe.Shoes is every shoe, every market, the right price: one page per model with every store\'s all-in price, a price history from Shoes\' own daily snapshots, the size-price curve and a watch for your size.';
const DISALLOW = ['/auth/', '/api/', '/internal', '/metrics', '/watches', '/track'];

function siteUpdated() {
    try { return String(JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'STATUS.json'), 'utf8')).updated || '').slice(0, 10) || null; } catch { return null; }
}

function homeJsonLd(config) {
    const site = String(config.baseUrl || `https://${HOST}`).replace(/\/+$/, '');
    return [
        seo.jsonLd.website({ name: SITE_NAME, url: site, description: DESCRIPTION, searchUrl: `${site}/shoes?q={q}` }),
        seo.jsonLd.softwareApp({ name: SITE_NAME, url: site, description: DESCRIPTION, category: 'ShoppingApplication', keywords: 'shoes, sneakers, all-in price, price history, size price, drops calendar, price watch, open data' }),
        seo.jsonLd.webPage({ name: SITE_NAME, url: `${site}/`, description: DESCRIPTION, siteUrl: site }),
    ];
}

function productJsonLd(config, model, offers, low) {
    const site = String(config.baseUrl || `https://${HOST}`).replace(/\/+$/, '');
    const url = `${site}/shoe/${model.slug}`;
    const prices = offers.map((o) => o.all_in).filter((p) => p != null);
    const out = seo.jsonLd.product({
        name: `${model.brand} ${model.model}`,
        url,
        description: `${model.brand} ${model.model}: every store's all-in price, the price history and the size-price curve.`,
        brand: model.brand,
        offers: prices.length ? {
            '@type': 'AggregateOffer',
            priceCurrency: 'USD',
            lowPrice: Math.min(...prices),
            highPrice: Math.max(...prices),
            offerCount: offers.length,
            availability: 'https://schema.org/InStock',
            url,
        } : undefined,
    });
    out['@context'] = 'https://schema.org';
    return out;
}

function publicPages(models = []) {
    const pages = [
        { path: '/', changefreq: 'hourly', priority: 1.0, title: 'OpenVibe.Shoes home', text: 'Every shoe, every market, the right price: all-in prices, the price history and the size-price curve.' },
        { path: '/shoes', changefreq: 'hourly', priority: 0.9, title: 'Every shoe', text: 'Search every model by brand, size and condition; every offer is all-in with its store and the time it was checked.' },
        { path: '/drops', changefreq: 'daily', priority: 0.8, title: 'The drops calendar', text: 'Official shoe release dates, each cited to the brand\'s or store\'s own release page, with a reminder on OpenVibe.Today.' },
        { path: '/developers', changefreq: 'weekly', priority: 0.6, title: 'The Shoes API', text: 'The open JSON API for shoes, offers, history, curves, drops and watches, and the OpenAPI document.' },
    ];
    for (const m of models) {
        pages.push({
            path: `/shoe/${m.slug}`, changefreq: 'daily', priority: 0.8,
            title: `${m.brand} ${m.model}`, text: `${m.brand} ${m.model}: ${m.offer_count} offer${m.offer_count === 1 ? '' : 's'}${m.price_min != null ? `, from $${Number(m.price_min).toFixed(2)} all-in` : ''}.`,
        });
    }
    return pages;
}

function createDiscoveryRoutes(ctx) {
    const { config, catalogue } = ctx;
    const r = asyncRouter();
    const base = () => String(config.baseUrl || `https://${HOST}`).replace(/\/+$/, '');

    r.get('/robots.txt', (_req, res) => {
        res.type('text/plain').set('Cache-Control', cache.htmlHeaders({ maxAge: 3600 }));
        res.send(seo.robotsTxt({ sitemaps: [`${base()}/sitemap.xml`], disallow: DISALLOW }));
    });

    r.get('/sitemap.xml', async (_req, res) => {
        const models = await catalogue.listShoes({ sort: 'recent', limit: 100 });
        const urls = publicPages(models).map((p) => ({ loc: `${base()}${p.path}`, lastmod: siteUpdated() || undefined, changefreq: p.changefreq, priority: p.priority }));
        res.type('application/xml').set('Cache-Control', cache.htmlHeaders({ maxAge: 600 }));
        res.send(seo.sitemapXml(urls));
    });

    r.get('/llms.txt', (_req, res) => {
        const pages = publicPages([]);
        res.type('text/plain').set('Cache-Control', cache.htmlHeaders({ maxAge: 600 }));
        res.send(seo.llmsTxt({
            name: SITE_NAME,
            summary: DESCRIPTION,
            details: 'Public model pages, a public JSON API and an OpenAPI document. No sign-in is needed for the public reads; a price watch and a pasted listing link need a person.',
            sections: [
                { title: 'Pages', links: pages.map((p) => ({ title: p.title, url: `${base()}${p.path}`, note: p.text })) },
                { title: 'API', links: [
                    { title: 'Search shoes', url: `${base()}/api/v1/shoes?q=air+max` },
                    { title: 'One shoe', url: `${base()}/api/v1/shoes/nike-air-max-90` },
                    { title: 'Drops', url: `${base()}/api/v1/drops` },
                    { title: 'OpenAPI', url: `${base()}/api/openapi.json` },
                ] },
            ],
        }));
    });

    r.get('/llms-full.txt', async (_req, res) => {
        const models = await catalogue.listShoes({ sort: 'recent', limit: 30 });
        const pages = publicPages(models);
        res.type('text/plain').set('Cache-Control', cache.htmlHeaders({ maxAge: 600 }));
        res.send(seo.llmsFull({
            site: SITE_NAME,
            summary: DESCRIPTION,
            base: base(),
            sections: [{ title: 'Pages', pages: pages.map((p) => ({ title: p.title, url: `${base()}${p.path}`, text: p.text })) }],
        }));
    });

    return r;
}

module.exports = { createDiscoveryRoutes, homeJsonLd, productJsonLd, publicPages, SITE_NAME, HOST, DESCRIPTION };
