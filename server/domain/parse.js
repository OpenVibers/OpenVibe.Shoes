'use strict';

/**
 * The rules that turn a source's words into Shoes' own fields. Pure: no clock, no database, no network. Every
 * rule here is a promise the site makes, so each one is unit tested (test/parse.test.js):
 *
 *   isShoe        whether a listing is footwear at all (a keyword, or a model Shoes knows)
 *   brandOf       which brand a title names (the source's own brand first, then a known list)
 *   modelOf       the model name inside a title, with the brand and the "running shoe" words taken off
 *   colourwayOf   a colourway the title quotes or the source names; null when it names none
 *   slugFor       /shoe/<brand>-<model>
 *   sizeOf        the size a title names ("Size 10.5", "US 9"); null when it names none
 *   conditionOf   new | used | deadstock | null (not stated)
 *   amountOf      a price as a number; null when it is not a price
 *   allIn        price + shipping when the store states shipping, else the price alone
 *
 * Nothing here guesses: a field the source did not give stays null and the page says "not known yet".
 */

/** The brands Shoes recognises in a title. Longest first, so "New Balance" wins over "Balance". */
const BRANDS = Object.freeze([
    'Adidas Originals', 'Air Jordan', 'Under Armour', 'New Balance', 'Dr. Martens', 'The North Face',
    'Nike', 'Jordan', 'Adidas', 'Puma', 'Reebok', 'ASICS', 'Asics', 'Converse', 'Vans', 'Crocs', 'Skechers',
    'Clarks', 'Merrell', 'Timberland', 'Steve Madden', 'Saucony', 'Brooks', 'Hoka', 'On', 'Fila', 'Mizuno',
    'Diadora', 'K-Swiss', 'Lotto', 'Champion', 'Guess', 'Diesel', 'Lacoste', 'Osiris', 'Etnies', 'Keen',
    'Wolverine', 'Reef', 'Olukai', 'UGG', 'Teva', 'Birkenstock', 'Bogs', 'Columbia', 'Hi-Tec', 'Keds',
    'Nautica', 'Rip Curl', 'Quiksilver', 'DC', 'Yeezy', 'Salomon', 'Arc', 'Terry', 'Zara', 'Geox',
    'Sperry', 'Cole Haan', 'ECCO', 'Dansko', 'Danner', 'Mephisto', 'Rieker', 'Josef Seibel', 'Naturalizer',
    'LifeStride', 'SoftWalk', 'Alegria', 'Xero Shoes', 'Altra', 'Topo Athletic', 'Inov-8', 'La Sportiva',
]);

const BRAND_ALIASES = Object.freeze({
    'air jordan': 'Jordan',
    'jordan brand': 'Jordan',
    'nike sb': 'Nike',
    'nike sportswear': 'Nike',
    'adidas originals': 'Adidas Originals',
    'new balance': 'New Balance',
    'asics': 'ASICS',
    'the north face': 'The North Face',
    'dr martens': 'Dr. Martens',
    'dr. martens': 'Dr. Martens',
    'under armour': 'Under Armour',
    'xero shoes': 'Xero Shoes',
});

/** The words that make a listing footwear. A title must name one of these, or a model below, to enter the catalogue. */
const FOOTWEAR = new RegExp(`\\b(?:${[
    'shoe', 'shoes', 'sneaker', 'sneakers', 'trainer', 'trainers', 'boot', 'boots', 'sandal', 'sandals',
    'slide', 'slides', 'clog', 'clogs', 'loafer', 'loafers', 'heel', 'heels', 'pump', 'pumps', 'oxford',
    'oxfords', 'mule', 'mules', 'flip[- ]?flop', 'flip[- ]?flops', 'footwear', 'cleat', 'cleats', 'slipper',
    'slippers', 'espadrille', 'espadrilles', 'slingback', 'slingbacks', 'wedge', 'wedges', 'mary jane',
].join('|')})\\b`, 'i');

/** A model word that only a shoe has. "Air Force 1" is a shoe even when the title drops the word. */
const SHOE_MODELS = new RegExp([
    'air max', 'air force', 'air jordan', 'jordan \\d', 'dunk', 'yeezy', 'ultraboost', 'ultra boost',
    'pegasus', 'gel[- ]kayano', 'gel[- ]nimbus', 'gel[- ]cumulus', 'samba', 'gazelle', 'stan smith',
    'superstar', 'chuck taylor', 'old skool', 'sk8', 'air monarch', 'air trainer', 'metcon', 'free run',
    'zoom fly', 'vaporfly', 'alphafly', '990', '991', '992', '993', '574', '327', '9060', '550',
    'cloudfoam', 'nmd', 'forum low', 'campus', 'sl 72', 'japan s', 'gazelle indoor', 'new balance 1906',
    'on cloud', 'cloudmonster', 'cloudrunner', 'hoka bondi', 'hoka clifton', 'salomon xt', 'salomon speedcross',
    'blundstone', 'chelsea boot', 'timberland 6', 'doc martens 1460', 'birkenstock boston', 'birkenstock arizona',
].join('|'), 'i');

/** Leading words a title uses for the person it is for, not for the model. */
const PERSON_WORDS = /^(?:(?:men'?s|women'?s|kids'?|kid'?s|boys'?|girls'?|unisex|toddler|infant|baby|big kid|little kid|youth)\s+)+/i;

/** Trailing words a title uses for the kind of thing it is, not for the model. */
const TYPE_WORDS = /(?:\s*[-–—,:]\s*|\s+)(?:men'?s|women'?s|kids'?|toddler|wide|medium|regular|standard|running shoe|running shoes|sneaker|sneakers|shoe|shoes|trainer|trainers|boot|boots|sandal|sandals|slide|slides|loafer|loafers|slipper|slippers|clog|clogs)\s*$/i;

const SIZE_RE = [
    /\bsize\s*[:.]?\s*(\d{1,2}(?:\.\d)?)\b/i,
    /\bus\s*(\d{1,2}(?:\.\d)?)\b/i,
    /\b(\d{1,2}(?:\.\d)?)\s*(?:us|mens|mens'|womens|womens')\b/i,
    /\b(\d{1,2}(?:\.\d)?)\s*(?:men|women|kids?)\b/i,
];

/** A clean name: spaces collapsed, no trailing punctuation, at most `max` characters. */
function cleanName(value, max = 120) {
    const s = String(value == null ? '' : value).replace(/\s+/g, ' ').trim().replace(/[\s.,;:]+$/, '');
    return s.slice(0, max);
}

/** The slug of a model: /shoe/<brand>-<model>. Lower case, words joined by a dash. */
function slugFor(brand, model) {
    const parts = [brand, model]
        .map((x) => String(x == null ? '' : x).toLowerCase())
        .join(' ')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    return parts.slice(0, 80).replace(/-$/, '');
}

/** The brand a title names: the source's own brand first (when it is a brand we know), else the title's. */
function brandOf(title, brandHint) {
    const hint = cleanName(brandHint, 80);
    if (hint) {
        const alias = BRAND_ALIASES[hint.toLowerCase()];
        if (alias) return alias;
        const known = BRANDS.find((b) => b.toLowerCase() === hint.toLowerCase());
        return known || hint;
    }
    const t = String(title == null ? '' : title);
    const low = t.toLowerCase();
    for (const b of BRANDS) {
        const key = b.toLowerCase();
        if (low.startsWith(key + ' ') || low.startsWith(key + '-') || low.startsWith(key + ',')) return BRAND_ALIASES[key] || b;
    }
    for (const b of BRANDS) {
        const key = b.toLowerCase();
        if (low.includes(' ' + key + ' ')) return BRAND_ALIASES[key] || b;
    }
    return null;
}

/** Whether a listing is footwear: a footwear word, or a model only a shoe has. */
function isShoe(...titles) {
    const t = titles.filter(Boolean).join(' ');
    return FOOTWEAR.test(t) || SHOE_MODELS.test(t);
}

/** A colourway named by the source, or quoted in the title ("Air Max 90 \"Medium Olive\""). */
function colourwayOf(title, hint) {
    const h = cleanName(hint, 80);
    if (h) return h;
    const quoted = String(title == null ? '' : title).match(/["“”]([^"“”]{2,60})["“”]/);
    if (quoted) return cleanName(quoted[1], 60) || null;
    return null;
}

/**
 * The model name inside a title: the person words, the brand and the kind words taken off, a quoted colourway
 * removed. "Women's Nike Air Max 90 Running Shoe" → "Air Max 90".
 */
function modelOf(title, brand) {
    let t = cleanName(title, 200);
    t = t.replace(PERSON_WORDS, '');
    // A quoted colourway is the colourway, not the model.
    t = t.replace(/\s*["“”][^"“”]{2,60}["“”]/g, '').trim();
    const b = cleanName(brand, 80);
    if (b && b.toLowerCase() === 'jordan') t = t.replace(/^air\s+/i, '').trim();
    if (b) {
        const key = b.toLowerCase();
        const idx = t.toLowerCase().indexOf(key);
        if (idx >= 0) {
            // Remove the brand once, wherever it sits after the person words ("Air Jordan 14 Retro" → "14 Retro").
            t = `${t.slice(0, idx)} ${t.slice(idx + key.length)}`.replace(/\s+/g, ' ').trim();
        }
    }
    t = t.replace(/\s+[-–—]\s+.*$/, '').trim();
    // A kind word in the middle is still the kind, not the model: "Samba OG Shoes Size 10.5".
    t = t.replace(/\s+(?:running shoes?|sneakers?|shoes?|trainers?|boots?|sandals?|slides?|loafers?|slippers?|clogs?)\s+(?=size\b|us\b)/i, ' ').trim();
    for (let i = 0; i < 3; i++) t = t.replace(TYPE_WORDS, '').trim();
    return cleanName(t, 120);
}

/** The size a title names, as its own string ("10.5"); null when the title names none. */
function sizeOf(title) {
    const t = String(title == null ? '' : title);
    for (const re of SIZE_RE) {
        const m = t.match(re);
        if (m) return cleanSize(m[1]);
    }
    return null;
}

/** A size as the source wrote it, normalised: "10.5", "10.5C", "5Y". */
function cleanSize(value) {
    const s = String(value == null ? '' : value).trim().toUpperCase();
    const m = s.match(/^(\d{1,2}(?:\.\d)?)([A-Z]*)$/);
    if (!m) return s ? s.slice(0, 12) : null;
    return m[1] + m[2];
}

/** new | used | deadstock | null (the source did not say). */
function conditionOf(value) {
    const s = String(value == null ? '' : value).trim().toLowerCase();
    if (!s) return null;
    if (/^(new|brand new|bnwt|new with tags|new with box|new in box)/.test(s)) return 'new';
    if (/^(used|pre-?owned|preowned|second hand)/.test(s)) return 'used';
    if (/^(deadstock|ds|dead stock)/.test(s)) return 'deadstock';
    return null;
}

/** A price as a number, or null when it is not one. "$1,299.00" → 1299. */
function amountOf(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const m = String(value).replace(/[^0-9.]/g, '');
    if (!m) return null;
    const n = Number.parseFloat(m);
    return Number.isFinite(n) ? n : null;
}

/**
 * The all-in price: the price plus the shipping when the store states it. The flag says whether the shipping
 * was known, so a page never claims a shipping it did not see.
 */
function allIn(price, shipping) {
    const p = amountOf(price);
    const sh = amountOf(shipping);
    if (p == null) return { amount: null, shippingKnown: false, shipping: null };
    if (sh == null) return { amount: p, shippingKnown: false, shipping: null };
    return { amount: Math.round((p + sh) * 100) / 100, shippingKnown: true, shipping: sh };
}

/** The day a check belongs to (UTC), the key of the price history. */
function dayOf(when) {
    const d = when instanceof Date ? when : new Date(when);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
}

/** A price is stale when it was checked longer ago than the hours allowed. */
function isStale(checkedAt, nowMs, staleHours) {
    const t = checkedAt instanceof Date ? checkedAt.getTime() : Date.parse(checkedAt);
    if (!Number.isFinite(t)) return false;
    const hours = Number(staleHours) > 0 ? Number(staleHours) : 48;
    return nowMs - t > hours * 3600_000;
}

module.exports = {
    BRANDS, BRAND_ALIASES, SIZE_RE, FOOTWEAR, SHOE_MODELS,
    cleanName, slugFor, brandOf, modelOf, colourwayOf, isShoe, sizeOf, cleanSize, conditionOf, amountOf, allIn, dayOf, isStale,
};
