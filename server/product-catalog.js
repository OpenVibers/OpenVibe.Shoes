'use strict';

const KINDS = ['shoe', 'laces', 'socks', 'care', 'insoles', 'kids'];
const CATEGORIES = [
    { kind: 'shoe', title: 'Shoes', href: '/shoes', description: 'Compare all-in prices by model and size.' },
    { kind: 'laces', title: 'Laces', href: '/laces', description: 'Find a starting length and explore lacing methods.' },
    { kind: 'socks', title: 'Socks', href: '/socks', description: 'Use each sock brand’s own shoe-size chart.' },
    { kind: 'care', title: 'Shoe care', href: '/care', description: 'Care notes by upper material, with manufacturer sources.' },
    { kind: 'insoles', title: 'Insoles', href: '/products?kind=insoles', description: 'Compatibility and prices will appear when verified sources are available.' },
    { kind: 'kids', title: 'Kids & baby', href: '/kids', description: 'Measure first, then compare manufacturer size charts.' },
];

const METHODS = {
    'criss-cross': 'Criss Cross',
    'bow-tie': 'Bow Tie / Army',
};

function laceLength({ eyeletPairs, method = 'criss-cross', horizontalCm = 3.5, verticalCm = 2.5, endsCm = 25 } = {}) {
    const p = Number(eyeletPairs), h = Number(horizontalCm), v = Number(verticalCm), l = Number(endsCm);
    if (!Number.isInteger(p) || p < 2 || p > 16 || !Number.isFinite(h) || h < 0.5 || h > 12 || !Number.isFinite(v) || v < 0.5 || v > 12 || !Number.isFinite(l) || l < 5 || l > 80) return null;
    let cm;
    if (method === 'criss-cross') cm = 2 * (h + (p - 1) * Math.hypot(h, v) + l);
    else if (method === 'bow-tie') cm = 2 * (h + v * Math.floor(p / 2) + Math.hypot(h, v) * Math.floor((p - 1) / 2) + l);
    else return null;
    return { method, method_name: METHODS[method], eyelet_pairs: p, cm: Math.ceil(cm / 5) * 5, inches: Math.ceil((cm / 2.54) / 2) * 2, assumptions: { horizontal_cm: h, vertical_cm: v, ends_cm: l }, source: { name: "Ian's Shoelace Site", url: 'https://www.fieggen.com/shoelace/lengthformulas.htm' } };
}

const SOCK_CHARTS = {
    men: [ [3, 5, 'S'], [5.5, 7.5, 'M'], [8, 9.5, 'L'], [10, 12, 'XL'] ],
    women: [ [4.5, 7, 'S'], [7.5, 9.5, 'M'], [10, 11.5, 'L'], [12, 14, 'XL'] ],
    kids: [ [9, 11.5, 'S'], [12, 14.5, 'M'], [3, 6, 'L'] ],
};

function sizeConvert({ system, size, brand = 'darn-tough' } = {}) {
    const value = Number(size);
    if (!Number.isFinite(value) || !system) return null;
    if (brand === 'darn-tough' && ['men', 'women', 'kids'].includes(system)) {
        let range;
        if (system === 'kids') {
            const label = value >= 9 && value <= 11.5 ? 'S' : ([12, 13, 1, 1.5, 2, 2.5].includes(value) ? 'M' : value >= 3 && value <= 6 ? 'L' : null);
            range = label ? [0, 0, label] : null;
        } else range = SOCK_CHARTS[system].find(([min, max]) => value >= min && value <= max);
        return { brand, system, input_size: String(size), conversions: range ? [{ system: 'sock', size: range[2] }] : [], source: { name: 'Darn Tough sock size chart', url: 'https://darntough.com/pages/size-chart' } };
    }
    return null;
}

function asProduct(model, facts = []) {
    return {
        id: model.slug, kind: 'shoe', title: `${model.brand} ${model.model}`, brand: model.brand, model: model.model,
        url: `/shoe/${encodeURIComponent(model.slug)}`, image: null, sizes: [], materials: [], uses: [],
        source: { name: 'OpenVibe.Deals', url: 'https://openvibe.deals' }, checked_at: model.first_seen || new Date(0).toISOString(),
        facts: facts.map((fact) => ({ name: fact.label, value: fact.value, source: { name: fact.source_name, url: fact.source_url } })),
    };
}

module.exports = { KINDS, CATEGORIES, laceLength, sizeConvert, asProduct };
