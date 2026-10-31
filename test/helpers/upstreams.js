'use strict';

/**
 * In-process stand-ins for the public sources and the sibling services Shoes uses:
 *
 *   OpenVibe.Deals   GET /api/v1/offers?sort=new&page=1 (the fixture below; page 2 is empty)
 *                    GET /api/v1/products/:slug (brand + name)
 *   OpenVibe.Watch   POST /api/v1/watches (records the body; answers { watch })
 *   OpenVibe.Today   POST /api/v1/events (records the body; answers { event })
 *   a release page   GET /launch (the Nike SNKRS JSON payload) and GET /feed (plain RSS)
 *   eBay             POST /identity/v1/oauth2/token and GET /buy/browse/v1/item_summary/search
 *
 * The fixtures are chosen so the classifier, the size parser and the all-in price all have something real to do.
 */
const http = require('http');

const DAY = '2026-10-31T20:00:00.000Z';

const DEALS = [
    {
        id: 'dof_test_airmax', slug: 'air-max-90-white',
        title: 'Nike Air Max 90 Running Shoe - White', link: 'https://www.zappos.com/p/nike-air-max-90/product/1/color/2',
        store: { domain: 'zappos.com', name: 'Zappos' }, product: { slug: 'air-max-90', name: 'Air Max 90' },
        latest_observation: { price: '89.95', list_price: '130.00', shipping: '0.00', condition: 'new', currency: 'USD', observed_at: DAY },
    },
    {
        id: 'dof_test_jordan', slug: 'air-jordan-1-mid',
        title: 'Air Jordan 1 Mid Sneaker', link: 'https://www.footlocker.com/product/air-jordan-1-mid',
        store: { domain: 'footlocker.com', name: 'Foot Locker' }, product: { slug: 'air-jordan-1-mid', name: 'Air Jordan 1 Mid' },
        latest_observation: { price: '120.00', list_price: null, shipping: '5.99', condition: 'new', currency: 'USD', observed_at: DAY },
    },
    {
        id: 'dof_test_samba', slug: 'adidas-samba-og-size-10-5',
        title: 'Adidas Samba OG Shoes Size 10.5', link: 'https://www.adidas.com/us/samba-og',
        store: { domain: 'adidas.com', name: 'adidas' }, product: { slug: 'samba-og', name: 'Samba OG' },
        latest_observation: { price: '100.00', list_price: null, shipping: null, condition: 'new', currency: 'USD', observed_at: DAY },
    },
    {
        id: 'dof_test_joggers', slug: 'rival-fleece-joggers',
        title: 'Under Armour Rival Fleece Joggers', link: 'https://www.zappos.com/p/under-armour-joggers',
        store: { domain: 'zappos.com', name: 'Zappos' }, product: { slug: 'rival-fleece-joggers', name: 'Rival Fleece Joggers' },
        latest_observation: { price: '40.00', list_price: null, shipping: null, condition: null, currency: 'USD', observed_at: DAY },
    },
    {
        id: 'dof_test_990', slug: 'new-balance-990v6',
        title: 'New Balance 990v6 Running Shoe', link: 'https://www.newbalance.com/pd/990v6',
        store: { domain: 'newbalance.com', name: 'New Balance' }, product: { slug: '990v6', name: '990v6' },
        latest_observation: { price: '149.99', list_price: '199.99', shipping: '0.00', condition: 'new', currency: 'USD', observed_at: DAY },
    },
];

const PRODUCTS = {
    'air-max-90': { slug: 'air-max-90', name: 'Air Max 90', brand: 'Nike' },
    'air-jordan-1-mid': { slug: 'air-jordan-1-mid', name: 'Air Jordan 1 Mid', brand: 'Jordan' },
    'samba-og': { slug: 'samba-og', name: 'Samba OG', brand: 'Adidas' },
    'rival-fleece-joggers': { slug: 'rival-fleece-joggers', name: 'Rival Fleece Joggers', brand: 'Under Armour' },
    '990v6': { slug: '990v6', name: '990v6', brand: 'New Balance' },
};

const LAUNCH_HTML = (() => {
    const payload = JSON.stringify({
        products: {
            data: {
                items: {
                    a: { commerceStartDate: '2026-11-04T15:00:00.000Z', title: 'Air Max 90 "Medium Olive"', subtitle: "Men's Shoes", fullPrice: 130, styleColor: 'IV4504-201', skus: [{ nike_size: '10.5' }, { nike_size: '9' }] },
                    b: { commerceStartDate: '2026-11-07T15:00:00.000Z', title: 'Air Jordan 6 Retro "White and Black"', subtitle: "Men's Shoes", fullPrice: 215, styleColor: 'CT8529-105', skus: [{ nike_size: '9.5' }] },
                },
            },
        },
    });
    // The page carries the JSON in a JavaScript string literal, exactly as Nike's launch page does.
    return `<!doctype html><html><body><script>window.__INITIAL_STATE__ = ${JSON.stringify(payload)};</script></body></html>`;
})();

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Example releases</title>
<item><title>Puma Suede Classic Sneaker</title><link>https://example.com/releases/puma-suede</link><pubDate>Wed, 11 Nov 2026 10:00:00 GMT</pubDate></item>
<item><title>No date here</title><link>https://example.com/releases/none</link></item>
</channel></rss>`;

const EBAY_ITEMS = [
    {
        itemId: 'v1|123|0', title: 'Nike Pegasus 41 Running Shoes Size 10.5', itemWebUrl: 'https://www.ebay.com/itm/123',
        price: { value: '79.99', currency: 'USD' }, shippingOptions: [{ shippingCost: { value: '4.99', currency: 'USD' } }],
        condition: 'New with box', seller: { username: 'runner' },
    },
    {
        itemId: 'v1|124|0', title: 'ASICS Gel-Kayano 31', itemWebUrl: 'https://www.ebay.com/itm/124',
        price: { value: '120.00', currency: 'USD' }, shippingOptions: [], condition: 'Pre-owned', seller: { username: 'shoeguy' },
    },
];

function listen(handler) {
    return new Promise((resolve) => {
        const sockets = new Set();
        const server = http.createServer((req, res) => {
            const chunks = [];
            req.on('data', (c) => chunks.push(c));
            req.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf8');
                const json = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
                Promise.resolve(handler(req, raw, json, res)).catch((err) => json(500, { error: String(err && err.message) }));
            });
        });
        server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
        server.listen(0, '127.0.0.1', () => resolve({
            server, url: `http://127.0.0.1:${server.address().port}`,
            close: () => new Promise((r) => { for (const s of sockets) s.destroy(); server.close(r); }),
        }));
    });
}

async function startUpstreams() {
    const state = { requests: [], watchRequests: [], todayRequests: [], offers: DEALS.map((o) => JSON.parse(JSON.stringify(o))), ebayItems: EBAY_ITEMS.map((i) => JSON.parse(JSON.stringify(i))) };

    const srv = await listen(async (req, raw, json, res) => {
        const url = new URL(req.url, 'http://x');
        const p = url.pathname;
        state.requests.push({ method: req.method, path: p, query: Object.fromEntries(url.searchParams), body: raw });

        if (p === '/api/v1/offers') {
            const page = Number(url.searchParams.get('page') || 1);
            return json(200, { sort: 'new', page, total: state.offers.length, offers: page === 1 ? state.offers : [] });
        }
        const product = p.match(/^\/api\/v1\/products\/([^/]+)$/);
        if (product) {
            const found = PRODUCTS[decodeURIComponent(product[1])];
            return found ? json(200, { product: found, offers: [] }) : json(404, { error: 'product.not_found' });
        }
        if (p === '/api/v1/watches' && req.method === 'POST') {
            let body = {};
            try { body = JSON.parse(raw || '{}'); } catch { body = {}; }
            state.watchRequests.push({ body, headers: { ...req.headers } });
            return json(201, { watch: { id: `wch_${String(state.watchRequests.length).padStart(26, '0')}`, ...body } });
        }
        if (p === '/api/v1/watches' && req.method === 'GET') return json(200, { watches: [] });
        if (p === '/api/v1/events' && req.method === 'POST') {
            let body = {};
            try { body = JSON.parse(raw || '{}'); } catch { body = {}; }
            state.todayRequests.push({ body, headers: { ...req.headers } });
            return json(201, { event: { id: `evt_${String(state.todayRequests.length).padStart(26, '0')}`, ...body } });
        }
        if (p === '/launch') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(LAUNCH_HTML);
        }
        if (p === '/feed') {
            res.writeHead(200, { 'Content-Type': 'application/rss+xml' });
            return res.end(RSS);
        }
        if (p === '/identity/v1/oauth2/token') return json(200, { access_token: 'ebay-test-token', token_type: 'Bearer', expires_in: 3600 });
        if (p === '/buy/browse/v1/item_summary/search') return json(200, { itemSummaries: state.ebayItems });
        return json(404, { error: 'not found' });
    });

    return {
        url: srv.url, state, close: srv.close,
        requestsFor(path) { return state.requests.filter((r) => r.path === path); },
        lastFor(path) { return state.requests.filter((r) => r.path === path).pop() || null; },
    };
}

module.exports = { startUpstreams, DEALS, PRODUCTS, LAUNCH_HTML, RSS, EBAY_ITEMS };
