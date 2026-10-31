'use strict';

/**
 * The drops a brand or a store publishes on its own release page. The parser is pure: it takes the page's HTML
 * and returns the releases it can prove, each with the time it was read. It never invents a date: a release with
 * no date in the page is not returned at all.
 *
 * The page this reads is a Nike SNKRS launch calendar (the brand's own public release page). Its data arrives as
 * a JSON payload inside the page; the rules below read the fields Shoes shows: the release moment, the model, the
 * colourway, the price and the size grid. A second source can be a plain RSS feed of a brand's or a store's own
 * releases.
 */
const parse = require('./parse');

const BRAND_RULES = [
    { brand: 'Jordan', test: /^(air\s+)?jordan\b/i },
    { brand: 'Nike', test: /^(nike|air|kobe|lebron|dunk)/i },
];

/** The brand of a release on a brand's own calendar. */
function brandFor(title, fallback = 'Nike') {
    const t = String(title || '').trim();
    for (const rule of BRAND_RULES) if (rule.test.test(t)) return rule.brand;
    return fallback;
}

/** Undo the escaping the page puts its JSON payload through. */
function decode(text) {
    // The page puts its payload in a JavaScript string literal: unescape one level (structural quotes become
    // JSON quotes, inner quotes stay escaped), then turn the page's escaped slashes/ampersands into characters.
    const unescape = (value) => String(value || '').replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (m, c) => {
        if (c[0] === 'u' || c[0] === 'x') {
            const code = parseInt(c.slice(1), 16);
            return Number.isFinite(code) ? String.fromCharCode(code) : c;
        }
        return ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0' })[c] ?? c;
    });
    return unescape(text).replace(/\\u002F/g, '/').replace(/\\u0026/g, '&');
}

/** The size grid a release page published. */
function sizesIn(window) {
    const out = [];
    const re = /"nike_size":"([^"]+)"/g;
    let m;
    while ((m = re.exec(window)) !== null) {
        const size = parse.cleanSize(m[1]);
        if (size && !out.includes(size)) out.push(size);
    }
    return out;
}

/** One field of the payload, as its own value. */
function field(window, name) {
    const m = window.match(new RegExp('"' + name + '":("(?:[^"\\\\]|\\\\.)*"|[0-9.]+|true|false|null)'));
    if (!m) return null;
    const raw = m[1];
    if (raw.startsWith('"')) {
        try { return JSON.parse(raw); } catch { return raw.slice(1, -1); }
    }
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    if (raw === 'null') return null;
    return Number(raw);
}

/**
 * The releases a launch calendar page publishes. Each one: { brand, model, colourway, releaseAt, price, sizes,
 * sourceKey }. A release without a date or without a model name is skipped: the page does not prove it.
 */
function parseLaunchCalendar(html, { sourceName = 'official release calendar', sourceUrl = '', fetchedAt = null } = {}) {
    const text = decode(html);
    const marks = [];
    const re = /"commerceStartDate":"([^"]+)"/g;
    let m;
    while ((m = re.exec(text)) !== null) marks.push({ at: m.index, date: m[1] });
    const out = [];
    for (let i = 0; i < marks.length; i++) {
        const start = marks[i].at;
        const end = i + 1 < marks.length ? marks[i + 1].at : text.length;
        const window = text.slice(start, end);
        const releaseAt = new Date(marks[i].date);
        if (Number.isNaN(releaseAt.getTime())) continue;
        const title = parse.cleanName(field(window, 'title'), 120);
        if (!title) continue;
        const brand = brandFor(title);
        const colourway = parse.colourwayOf(title);
        const model = parse.modelOf(title, brand);
        if (!model) continue;
        const full = field(window, 'fullPrice');
        const price = parse.amountOf(full != null ? full : field(window, 'msrp'));
        const sizes = sizesIn(window);
        const styleColor = field(window, 'styleColor') || '';
        const sourceKey = [title, styleColor, marks[i].date].join('|');
        out.push({
            brand, model, colourway,
            releaseAt: releaseAt.toISOString(),
            price,
            currency: 'USD',
            sizes,
            sourceKey,
            sourceName,
            sourceUrl,
            fetchedAt: fetchedAt || new Date().toISOString(),
        });
    }
    return out;
}

/** A plain RSS feed: { title, link, pubDate } per item. Used by the extra feeds a host may configure. */
function parseRss(xml, { sourceName = 'official release feed', sourceUrl = '', fetchedAt = null } = {}) {
    const out = [];
    const items = String(xml || '').split(/<item\b/i).slice(1);
    for (const item of items) {
        const pick = (tag) => {
            const m = item.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>', 'i'));
            return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').trim() : null;
        };
        const title = pick('title');
        const link = pick('link');
        const date = pick('pubDate') || pick('dc:date');
        if (!title || !date) continue;
        const when = new Date(date);
        if (Number.isNaN(when.getTime())) continue;
        const brand = parse.brandOf(title) || 'Unknown';
        const model = parse.modelOf(title, brand);
        if (!model) continue;
        out.push({
            brand, model,
            colourway: parse.colourwayOf(title),
            releaseAt: when.toISOString(),
            price: null,
            currency: 'USD',
            sizes: [],
            sourceKey: link || title,
            sourceName,
            sourceUrl: link || sourceUrl,
            fetchedAt: fetchedAt || new Date().toISOString(),
        });
    }
    return out;
}

module.exports = { parseLaunchCalendar, parseRss, brandFor, decode, sizesIn, field };
