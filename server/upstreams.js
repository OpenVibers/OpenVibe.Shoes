'use strict';

/**
 * Everything Shoes reads from the network and from the public web.
 *
 *   OpenVibe.Deals   the network's own offer aggregator (its public API): the offers, the stores and the
 *                    products. No key: these are the same reads any person can make.
 *   eBay             the official Browse API (OAuth2 client credentials) when a key pair is set; off otherwise.
 *   a release page   a brand's or a store's own public release calendar (an official page, read as a page).
 *   OpenVibe.Watch   the watch service: a watch for a person (the person's own Network token as a Bearer).
 *   OpenVibe.Today   the drops calendar's reminders (the person's own Network token as a Bearer).
 *
 * A missing key is never an error: the part that needs it is off, with a plain note.
 */
const egress = require('openvibe-shared/egress');
const drops = require('./domain/drops');
const parse = require('./domain/parse');

class UpstreamError extends Error {
    constructor(message, { status = 502, code = 'shoes.upstream_failed' } = {}) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

function createUpstreams({ config, fetchImpl = globalThis.fetch, log = console, urlCheck = (u) => egress.assertPublicUrl(u) } = {}) {
    const timeoutMs = config.sources.timeoutMs;

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    async function request(url, { method = 'GET', headers = {}, body = null, json = false, timeout = timeoutMs } = {}) {
        for (let attempt = 0; ; attempt++) {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), timeout);
            try {
                const res = await fetchImpl(url, {
                    method,
                    headers: { 'user-agent': 'OpenVibe.Shoes/0.1 (+https://open.shoes)', accept: 'application/json, text/html;q=0.9', ...headers },
                    body,
                    signal: ctrl.signal,
                });
                const text = await res.text();
                if (res.status === 429 && attempt < 2) {
                    const retry = Number(res.headers.get('retry-after'));
                    await sleep(Math.min(10_000, Math.max(500, (Number.isFinite(retry) && retry > 0 ? retry : 1) * 1000)));
                    continue;
                }
                if (!res.ok) throw new UpstreamError(`${method} ${url} answered ${res.status}`, { status: res.status === 429 ? 429 : 502, code: res.status === 429 ? 'shoes.rate_limited' : 'shoes.upstream_failed' });
                if (json) { try { return JSON.parse(text); } catch { throw new UpstreamError(`${url} did not answer JSON`, { status: 502 }); } }
                return text;
            } catch (err) {
                if (err instanceof UpstreamError) throw err;
                throw new UpstreamError(`${method} ${url} failed: ${err && err.message ? err.message : 'network error'}`, { status: 502 });
            } finally {
                clearTimeout(timer);
            }
        }
    }

    // ── OpenVibe.Deals ──────────────────────────────────────
    const dealsBase = () => config.sources.dealsUrl.replace(/\/+$/, '');

    /** The newest offers on OpenVibe.Deals (its public API), one page at a time. */
    async function dealsOffers(page = 1) {
        const body = await request(`${dealsBase()}/api/v1/offers?sort=new&page=${encodeURIComponent(page)}`, { json: true });
        return Array.isArray(body && body.offers) ? body.offers : [];
    }

    /** The offers of one store on OpenVibe.Deals. */
    async function dealsStoreOffers(domain) {
        const body = await request(`${dealsBase()}/api/v1/stores/${encodeURIComponent(domain)}`, { json: true });
        return Array.isArray(body && body.offers) ? body.offers : [];
    }

    /** One product on OpenVibe.Deals (its own page, with the brand). */
    async function dealsProduct(slug) {
        try {
            const body = await request(`${dealsBase()}/api/v1/products/${encodeURIComponent(slug)}`, { json: true });
            return body && body.product ? body.product : null;
        } catch (err) {
            log.warn('[OpenVibe.Shoes] deals product failed:', err.message);
            return null;
        }
    }

    // ── eBay Browse API (official) ──────────────────────────
    let ebayToken = null;
    let ebayTokenAt = 0;

    function ebayConfigured() {
        return Boolean(config.sources.ebay.clientId && config.sources.ebay.clientSecret);
    }

    async function ebayAccessToken() {
        if (!ebayConfigured()) return null;
        if (ebayToken && Date.now() - ebayTokenAt < 50 * 60_000) return ebayToken;
        const basic = Buffer.from(`${config.sources.ebay.clientId}:${config.sources.ebay.clientSecret}`).toString('base64');
        const body = await request(`${config.sources.ebay.apiUrl}/identity/v1/oauth2/token`, {
            method: 'POST',
            headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
            body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',
            json: true,
        });
        if (!body || !body.access_token) throw new UpstreamError('eBay did not issue a token');
        ebayToken = body.access_token;
        ebayTokenAt = Date.now();
        return ebayToken;
    }

    /**
     * The official Browse API's item summaries for shoes. Each item keeps eBay's own id, URL, price, shipping,
     * condition and seller; a size is read from the title only when the title names one.
     */
    async function ebayShoes({ q = 'shoes', limit = config.sources.ebay.limit } = {}) {
        if (!ebayConfigured()) return { configured: false, items: [] };
        const token = await ebayAccessToken();
        const params = new URLSearchParams({
            q: String(q).slice(0, 100),
            category_ids: String(config.sources.ebay.categoryId),
            limit: String(Math.max(1, Math.min(200, limit))),
            sort: 'newlyListed',
        });
        const body = await request(`${config.sources.ebay.apiUrl}/buy/browse/v1/item_summary/search?${params.toString()}`, {
            headers: { authorization: `Bearer ${token}`, 'x-ebay-c-marketplace-id': config.sources.ebay.marketplace },
            json: true,
        });
        const items = Array.isArray(body && body.itemSummaries) ? body.itemSummaries : [];
        return {
            configured: true,
            items: items.map((it) => {
                const price = it.price && parse.amountOf(it.price.value);
                const ship = it.shippingOptions && it.shippingOptions[0] && it.shippingOptions[0].shippingCost
                    ? parse.amountOf(it.shippingOptions[0].shippingCost.value) : null;
                let store = 'ebay.com';
                try { store = new URL(it.itemWebUrl).hostname.replace(/^www\./, ''); } catch { /* keep ebay.com */ }
                return {
                    source: 'ebay',
                    sourceId: String(it.itemId || ''),
                    title: String(it.title || ''),
                    url: String(it.itemWebUrl || ''),
                    store,
                    storeName: (it.seller && it.seller.username) ? `eBay seller ${it.seller.username}` : 'eBay',
                    price,
                    shipping: ship,
                    condition: parse.conditionOf(it.condition),
                    size: parse.sizeOf(it.title),
                    currency: (it.price && it.price.currency) || 'USD',
                    checkedAt: new Date().toISOString(),
                    raw: it,
                };
            }).filter((x) => x.sourceId && x.url && x.price != null),
        };
    }

    // ── Official release pages ──────────────────────────────
    /** The releases on a brand's or a store's own release calendar. */
    async function releaseCalendar({ url = config.sources.dropsUrl, name = config.sources.dropsSourceName, type = 'launch' } = {}) {
        const html = await request(url, { headers: { accept: 'text/html' } });
        const fetchedAt = new Date().toISOString();
        if (type === 'rss') return drops.parseRss(html, { sourceName: name, sourceUrl: url, fetchedAt });
        return drops.parseLaunchCalendar(html, { sourceName: name, sourceUrl: url, fetchedAt });
    }

    // ── OpenVibe.Watch ──────────────────────────────────────
    /**
     * Create a watch for a person in OpenVibe.Watch. A person's own Network token is the Bearer: Watch scopes the
     * watch to that token's subject, exactly as Today does for a reminder. Without a token the watch is not created
     * there and the caller says so plainly.
     */
    async function createWatch(body, { token } = {}) {
        if (!token) return { ok: false, code: 'shoes.watch_no_token', detail: 'This session has no Network token, so the watch was not created.' };
        const url = `${config.watch.internalUrl.replace(/\/+$/, '')}/api/v1/watches`;
        try {
            const res = await request(url, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    authorization: `Bearer ${token}`,
                },
                body: JSON.stringify(body),
                json: true,
            });
            const watch = res && res.watch ? res.watch : res;
            return { ok: true, watch };
        } catch (err) {
            return { ok: false, code: err.code || 'shoes.watch_failed', detail: err.message };
        }
    }

    // ── OpenVibe.Today ──────────────────────────────────────
    /** Put a drop on a person's Today agenda. The person's own Network token is the Bearer. */
    async function createTodayEvent(body, { token } = {}) {
        if (!token) return { ok: false, code: 'shoes.today_no_token', detail: 'This session has no Network token, so the reminder was not added.' };
        const url = `${config.today.internalUrl.replace(/\/+$/, '')}/api/v1/events`;
        try {
            const res = await request(url, {
                method: 'POST',
                headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
                body: JSON.stringify(body),
                json: true,
            });
            const event = res && res.event ? res.event : res;
            return { ok: true, event };
        } catch (err) {
            return { ok: false, code: err.code || 'shoes.today_failed', detail: err.message };
        }
    }

    /**
     * The rules for a URL a person pasted: it must be an http(s) address on the public internet (the same rule
     * every OpenVibe service uses for a user-chosen address, openvibe-shared/egress). Facebook Marketplace has no
     * public listings API and its terms forbid reading it directly, so a Marketplace link is accepted as a watch
     * and Watch's own fetch rules decide what it may see.
     */
    async function checkPastedUrl(value) {
        const raw = String(value == null ? '' : value).trim();
        if (!raw) return { ok: false, code: 'shoes.url_required', detail: 'Paste the link to the listing.' };
        if (raw.length > 2000) return { ok: false, code: 'shoes.url_too_long', detail: 'That link is too long.' };
        let url;
        try { url = new URL(raw); } catch { return { ok: false, code: 'shoes.url_invalid', detail: 'That is not a link Shoes can read.' }; }
        if (url.protocol !== 'https:' && url.protocol !== 'http:') {
            return { ok: false, code: 'shoes.url_invalid', detail: 'Only http and https links can be watched.' };
        }
        try {
            await urlCheck(url.toString());
        } catch (err) {
            return { ok: false, code: 'shoes.url_not_public', detail: 'That address is not on the public internet, so it cannot be watched.' };
        }
        return { ok: true, url: url.toString(), host: url.hostname };
    }

    return {
        request, dealsOffers, sleep, dealsStoreOffers, dealsProduct, ebayShoes, ebayConfigured, releaseCalendar,
        createWatch, createTodayEvent, checkPastedUrl, UpstreamError,
    };
}

module.exports = { createUpstreams, UpstreamError };
