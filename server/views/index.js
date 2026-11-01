'use strict';

/**
 * The Shoes room's pages (plan 2026-10-28 §5.6). Server-rendered and whole without JavaScript: every action is a
 * plain form or link. The room's front door is sc.room (hero, proof, rails, scenes, explore, developers, questions,
 * the rest of OpenVibe); every number on it is read from Shoes' own catalogue or from the source itself.
 *
 *   home({ facets, dropping, dropsToday, popular, curveModel, curve, sceneDrop, jobs, brands })
 *   shoesIndex({ models, facets, query, page, total })
 *   shoe({ model, offers, history, curve, facts, signedIn })
 *   drops({ drops, signedIn, notice })
 *   watches({ watches, signedIn })
 *   developers({ baseUrl })
 *   signIn({ title, next })
 *   notFound()
 * Ids and classes are stable and start with `sh-`.
 */
const kit = require('openvibe-shared/kit');
const sc = require('openvibe-shared/showcase');
const rooms = require('openvibe-shared/rooms');

const { esc, icon, card, rail } = kit;
const ROOM = rooms.get('shoes');
const SITE = 'OpenVibe.Shoes';
const money = (n, cur = 'USD') => {
    if (n == null || n === '') return '—';
    const v = Number(n);
    if (!Number.isFinite(v)) return '—';
    const s = v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return cur === 'USD' ? `$${s}` : `${s} ${esc(cur)}`;
};
const pct = (n) => {
    if (n == null || !Number.isFinite(Number(n))) return '—';
    return `${Number(n) > 0 ? '+' : ''}${Number(n).toFixed(1)}%`.replace(/^-/, '−');
};
const dayShort = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : ''; };
const dayLong = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '—'; };
const clock = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? new Date(t).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) : ''; };
const checked = (iso, now = Date.now()) => {
    const t = Date.parse(iso || '');
    if (!Number.isFinite(t)) return 'never checked';
    const mins = Math.max(0, Math.round((now - t) / 60_000));
    if (mins < 2) return 'checked just now';
    if (mins < 90) return `checked ${mins} min ago`;
    const h = Math.round(mins / 60);
    if (h < 48) return `checked ${h} h ago`;
    return `checked ${dayShort(iso)} at ${clock(iso)} UTC`;
};
const stale = (offer) => (offer.stale ? '<span class="sh-stale">stale</span>' : '<span class="sh-fresh">fresh</span>');
const link = (href, text, cls = '') => `<a${cls ? ` class="${esc(cls)}"` : ''} href="${esc(href)}">${esc(text)}</a>`;
const sourceLine = (name, url) => (url ? `<a href="${esc(url)}" rel="noopener">${esc(name)}</a>` : esc(name));

/** A card for a model: its price from, how many offers, when it was checked. */
function modelCard(m) {
    const price = m.price_min != null ? `from ${money(m.price_min)}` : 'price not known yet';
    return card({
        href: `/shoe/${encodeURIComponent(m.slug)}`,
        title: `${m.brand} ${m.model}`,
        type: 'shoe',
        corner: m.price_min != null ? money(m.price_min) : '',
        badge: m.drop_amount ? `−${money(m.drop_amount)}` : '',
        who: m.brand,
        count: [m.offer_count, m.offer_count === 1 ? 'offer' : 'offers'],
        when: m.checked_at,
        peek: `${price}${m.stale_count ? ` · ${m.stale_count} stale` : ''}`,
    });
}

/** One row per model, colourway and release moment: a source's variant rows (a style code each) become one release. */
function groupDrops(list = []) {
    const groups = new Map();
    for (const d of list) {
        const key = [d.brand, d.model, d.colourway || '', String(d.release_at).slice(0, 16)].join('|');
        if (!groups.has(key)) {
            groups.set(key, { ...d, sizes: [...(d.sizes || [])], variants: 1 });
            continue;
        }
        const g = groups.get(key);
        g.variants++;
        g.sizes = [...new Set([...g.sizes, ...(d.sizes || [])])].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
        if (d.price != null && (g.price == null || d.price < g.price)) g.price = d.price;
    }
    return [...groups.values()].sort((a, b) => Date.parse(a.release_at) - Date.parse(b.release_at));
}

/** A card for a release. */
function dropCard(d) {
    return card({
        href: `/drops#drop-${encodeURIComponent(d.id)}`,
        title: `${d.brand} ${d.model}${d.colourway ? ` · ${d.colourway}` : ''}`,
        type: 'event',
        corner: d.price != null ? money(d.price, d.currency) : '',
        badge: dayShort(d.release_at),
        who: d.source_name,
        peek: `${dayLong(d.release_at)}${d.sizes.length ? ` · ${d.sizes.length} sizes` : ''}`,
    });
}

/** The small line chart of a model's own snapshots. No made-up points: one snapshot draws one dot. */
function historyChart(points) {
    if (!points.length) return '<p class="sh-muted">No snapshot yet. The first check writes one point; the line grows as Shoes checks again.</p>';
    const w = 640, h = 180, pad = 24;
    const prices = points.map((p) => p.price).filter((p) => p != null);
    const lo = Math.min(...prices), hi = Math.max(...prices);
    const span = hi - lo || 1;
    const x = (i) => pad + (points.length === 1 ? (w - pad * 2) / 2 : (i * (w - pad * 2)) / (points.length - 1));
    const y = (p) => h - pad - ((p - lo) / span) * (h - pad * 2);
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.price).toFixed(1)}`).join(' ');
    const dots = points.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.price).toFixed(1)}" r="3"><title>${esc(`${p.day}: ${money(p.price)}`)}</title></circle>`).join('');
    return `<figure class="sh-chart"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Lowest all-in price by day, ${esc(points[0].day)} to ${esc(points[points.length - 1].day)}">`
        + `<line class="sh-chart-axis" x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}"></line>`
        + `<line class="sh-chart-axis" x1="${pad}" y1="${pad}" x2="${pad}" y2="${h - pad}"></line>`
        + `<path class="sh-chart-line" d="${line}" fill="none"></path>${dots}</svg>`
        + `<figcaption><span>Lowest all-in price by day</span><b>${money(points[points.length - 1].price)}</b><small>${esc(points[0].day)} → ${esc(points[points.length - 1].day)} · ${points.length} day${points.length === 1 ? '' : 's'} of Shoes' own snapshots</small></figcaption></figure>`;
}

/** The size-price curve as bars (real points only). */
function curveBars(curve) {
    if (!curve || !curve.points.length) return '<p class="sh-muted">Sizes are not stated by the sources yet, so there is no size-price curve. It appears when a store names the size.</p>';
    const max = Math.max(...curve.points.map((p) => p.min_price || 0), 1);
    return `<div class="sh-curve" role="list" aria-label="Lowest all-in price by size">${curve.points.slice(0, 40).map((p) => `<div class="sh-curve-point" role="listitem">`
        + `<span class="sh-curve-size">${esc(p.size)}</span><span class="sh-curve-bar" style="--h:${Math.max(4, Math.round(((p.min_price || 0) / max) * 100))}%"></span>`
        + `<b>${money(p.min_price)}</b><small>${p.vs_median_percent == null ? '' : `${pct(p.vs_median_percent)} vs median`}</small></div>`).join('')}</div>`;
}

/** A size-price table, when sizes are known. */
function curveTable(curve) {
    if (!curve || !curve.points.length) return '<p class="sh-muted">Not known yet: the offers we read name no size. A size-price curve is shown only from offers that state one.</p>';
    return `<div class="sh-table-wrap"><table class="sh-table"><caption>Lowest all-in price per size, against the model's median size</caption><thead><tr><th scope="col">Size</th><th scope="col">Lowest all-in</th><th scope="col">vs median (${money(curve.median)})</th><th scope="col">Offers</th><th scope="col">Stores</th><th scope="col">Checked</th></tr></thead><tbody>`
        + curve.points.map((p) => `<tr><td>${esc(p.size)}</td><td>${money(p.min_price)}</td><td>${pct(p.vs_median_percent)}</td><td>${p.offers}</td><td>${p.stores}</td><td>${esc(checked(p.checked_at))}</td></tr>`).join('')
        + '</tbody></table></div>';
}

function offersTable(offers) {
    if (!offers.length) return '<p class="sh-muted">No live offer yet. The next check may bring one.</p>';
    return `<div class="sh-table-wrap"><table class="sh-table sh-offers"><caption>Every current offer, cheapest all-in first</caption><thead><tr><th scope="col">Store</th><th scope="col">All-in</th><th scope="col">Price</th><th scope="col">Shipping</th><th scope="col">Size</th><th scope="col">Condition</th><th scope="col">Colourway</th><th scope="col">Checked</th><th scope="col">Freshness</th></tr></thead><tbody>`
        + offers.map((o) => `<tr><td><a href="${esc(o.url)}" rel="noopener nofollow">${esc(o.store_name || o.store)}</a><br><small>${esc(o.title)}</small></td>`
            + `<td><b>${money(o.all_in, o.currency)}</b>${o.drop_from_list ? `<br><small class="sh-good">−${money(o.drop_from_list, o.currency)} from list</small>` : ''}</td>`
            + `<td>${money(o.price, o.currency)}</td><td>${o.shipping_known ? money(o.shipping, o.currency) : '<span class="sh-muted">not stated</span>'}</td>`
            + `<td>${o.size ? esc(o.size) : '<span class="sh-muted">not stated</span>'}</td><td>${o.condition ? esc(o.condition) : '<span class="sh-muted">not stated</span>'}</td>`
            + `<td>${o.colourway ? esc(o.colourway) : '<span class="sh-muted">not stated</span>'}</td><td>${esc(checked(o.checked_at))}</td><td>${stale(o)}</td></tr>`).join('')
        + '</tbody></table></div>';
}

function factsSection(facts) {
    const kinds = [['specs', 'Specs'], ['fit', 'Fit notes'], ['release', 'Release'], ['care', 'Care and repair']];
    return `<section class="sh-facts" aria-labelledby="sh-facts-h"><h2 id="sh-facts-h">Specs, fit, release and care</h2><p class="sh-muted">Only from cited open sources. When a source has not said it, the page says “not known yet”; Shoes never invents a spec.</p>`
        + kinds.map(([kind, label]) => {
            const rows = facts.filter((f) => f.kind === kind);
            return `<div class="sh-fact"><h3>${label}</h3>${rows.length ? `<dl>${rows.map((f) => `<dt>${esc(f.label)}</dt><dd>${esc(f.value)} <small>· ${sourceLine(f.source_name, f.source_url)}, read ${esc(dayShort(f.fetched_at))}</small></dd>`).join('')}</dl>` : '<p class="sh-muted">Not known yet.</p>'}</div>`;
        }).join('') + '</section>';
}

function watchForm({ model, sizes, signedIn, next }) {
    if (!signedIn) return `<div class="sh-watch"><h2>Tell me when this drops below $X</h2><p>A price watch needs a person. ${link(`/auth/login?next=${encodeURIComponent(next)}`, 'Sign in with OpenVibe')} and the watch goes to OpenVibe.Watch.</p></div>`;
    return `<form class="sh-watch" method="post" action="/shoe/${encodeURIComponent(model.slug)}/watch"><h2>Tell me when this drops below $X at my size</h2>`
        + `<p>Watch the all-in price. Shoes hands the watch to OpenVibe.Watch, which carries the alert to your notifications.</p>`
        + `<div class="sh-form-row"><label>Lowest all-in price <input type="number" name="threshold" min="1" max="100000" step="0.01" required placeholder="90"></label>`
        + `<label>Size <select name="size"><option value="">Any size</option>${sizes.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}</select></label>`
        + `<label>Condition <select name="condition"><option value="">Any</option><option value="new">New</option><option value="used">Used</option><option value="deadstock">Deadstock</option></select></label>`
        + `<button class="sh-btn" type="submit">${icon('bell')} Watch this price</button></div></form>`;
}

function searchForm({ q = '', facets = {}, action = '/shoes', values = {} }) {
    const brands = (facets.brands || []).slice(0, 40);
    const sizes = facets.sizes || [];
    return `<form class="sh-search" role="search" method="get" action="${action}">`
        + `<label class="sh-search-q">Search <input type="search" name="q" value="${esc(q)}" placeholder="A brand, a model, a colourway" autocomplete="off"></label>`
        + `<label>Brand <select name="brand"><option value="">Any brand</option>${brands.map((b) => `<option value="${esc(b.value)}"${values.brand === b.value ? ' selected' : ''}>${esc(b.value)} (${b.count})</option>`).join('')}</select></label>`
        + (sizes.length ? `<label>Size <select name="size"><option value="">Any size</option>${sizes.slice(0, 80).map((s) => `<option value="${esc(s.value)}"${values.size === s.value ? ' selected' : ''}>${esc(s.value)} (${s.count})</option>`).join('')}</select></label>` : '')
        + `<label>Condition <select name="condition"><option value="">Any</option><option value="new"${values.condition === 'new' ? ' selected' : ''}>New</option><option value="used"${values.condition === 'used' ? ' selected' : ''}>Used</option><option value="deadstock"${values.condition === 'deadstock' ? ' selected' : ''}>Deadstock</option></select></label>`
        + ((facets.stores || []).length ? `<label>Store <select name="store"><option value="">Any store</option>${(facets.stores || []).slice(0, 40).map((s) => `<option value="${esc(s.value)}"${values.store === s.value ? ' selected' : ''}>${esc(s.value)} (${s.count})</option>`).join('')}</select></label>` : '')
        + `<label>Sort <select name="sort"><option value="recent"${values.sort === 'recent' ? ' selected' : ''}>Recently checked</option><option value="drop"${values.sort === 'drop' ? ' selected' : ''}>Biggest drop</option><option value="price"${values.sort === 'price' ? ' selected' : ''}>Lowest all-in</option><option value="popular"${values.sort === 'popular' ? ' selected' : ''}>Most offers</option><option value="name"${values.sort === 'name' ? ' selected' : ''}>Name</option></select></label>`
        + `<button class="sh-btn" type="submit">${icon('search')} Search</button></form>`;
}

// ── Home ────────────────────────────────────────────────────
/**
 * The room's motif (rooms.js: "a shoe drawn as one line, price tags from several stores sliding in"): a sneaker in a
 * single stroke that draws itself, then three stores' tags arrive and the lowest one lights up. Drawn, not a photo.
 */
function shoeMotif() {
    const tag = (store, price, n, best) => `<span class="sh-mt sh-mt-${n}${best ? ' is-best' : ''}"><small>${store}</small><b>${price}</b></span>`;
    return `<div class="sh-motif" aria-hidden="true">
<svg class="sh-shoe" viewBox="0 0 320 170"><path pathLength="100" d="M30 140 C 26 120, 28 100, 36 90 C 46 82, 64 84, 84 92 C 96 96, 104 88, 110 74 C 114 64, 122 58, 132 60 L 140 63 C 162 78, 200 96, 240 104 C 272 110, 298 116, 304 130 C 306 138, 302 142, 294 142 L 36 142 C 32 142, 30 141, 30 140 Z M 26 142 L 26 151 C 26 156, 30 158, 36 158 L 296 158 C 304 158, 310 152, 308 142 M 150 76 L 160 67 M 168 84 L 178 75 M 186 92 L 196 83 M 70 124 C 120 120, 180 113, 244 120 M 36 96 L 28 98"/></svg>
${tag('Store A', '$129', 1, false)}${tag('Store B', '$112', 2, false)}${tag('Store C', '$98', 3, true)}
</div>`;
}

function home({ facets = {}, dropping = [], dropsToday = [], popular = [], curveModel = null, curve = null, sceneDrop = null, jobs = [], now = Date.now() } = {}) {
    const brands = (facets.brands || []).slice(0, 5);
    const priceDrops = dropsToday.filter((m) => m.drop_amount).slice(0, 8);
    const popularRails = popular.slice(0, 8);
    const groupedDropping = groupDrops(dropping);
    const dropRail = groupedDropping.slice(0, 8);
    const lastChecked = facets.checked_at ? checked(facets.checked_at, now) : null;
    const jobsLine = jobs.filter((j) => j.finished_at).slice(0, 3).map((j) => `${j.source_name}: ${j.ok ? 'read' : 'failed'} ${dayShort(j.started_at)}`).join(' · ');

    const scenes = [
        curve && curve.points.length && curveModel ? {
            title: 'What a size costs, in one curve',
            text: `${curveModel.brand} ${curveModel.model} in ${curve.points.length} sizes: ${pct(curve.points[0].vs_median_percent)} against the median size, from real offers that named a size. Sizes are read only when a store states one.`,
            html: curveBars(curve),
            action: { href: `/shoe/${encodeURIComponent(curveModel.slug)}`, label: `See ${curveModel.model}` },
        } : null,
        sceneDrop ? {
            title: 'A drop reminder, on Today',
            text: `Remind me on ${sceneDrop.brand} ${sceneDrop.model}: the release goes on your OpenVibe.Today agenda before it happens, with the official release page as its source. Raffle entries are never automated.`,
            html: `<div class="sh-scene-drop"><span class="sh-kicker">Today · reminder</span><b>${esc(sceneDrop.brand)} ${esc(sceneDrop.model)}${sceneDrop.colourway ? ` · ${esc(sceneDrop.colourway)}` : ''}</b>`
                + `<span>${esc(dayLong(sceneDrop.release_at))} at ${esc(clock(sceneDrop.release_at))} UTC</span><small>${sourceLine(sceneDrop.source_name, sceneDrop.source_url)}</small><span class="sh-scene-tag">on your agenda</span></div>`,
            action: { href: '/drops', label: 'Open the drops calendar' },
        } : null,
        {
            title: 'Paste a link, keep the price',
            text: 'A store, eBay or a Facebook Marketplace listing: paste the link and Shoes makes it a Watch. Marketplace has no public listings API and its terms forbid scraping, so Shoes never reads it itself; OpenVibe.Watch applies its own fetch rules.',
            html: `<form class="sh-scene-track" method="post" action="/track"><label for="sh-track-url">A listing link</label><div><input id="sh-track-url" type="url" name="url" placeholder="https://www.ebay.com/itm/…" required maxlength="2000"><button class="sh-btn" type="submit">${icon('link')} Track it</button></div><small>No Marketplace scraping, ever. The watch holds the link and what Watch may fetch by its own rules.</small></form>`,
            action: { href: '/track', label: 'Track a link' },
        },
    ].filter(Boolean);

    // Real first (the owner, 10-31: empty sections made the rooms look unfinished): no drops today, no section.
    const priceDropSection = priceDrops.length
        ? rail({ id: 'sh-price-drops', title: 'The biggest price drops today', more: { href: '/shoes?sort=drop', label: 'Every drop' }, size: 's', items: priceDrops.map(modelCard) })
        : '';
    const body = sc.room({
        room: 'shoes',
        hero: {
            title: ROOM.line,
            lede: 'One page per shoe, every store\'s offer in one all-in price, the price history from Shoes\' own daily snapshots, and a watch that tells you when your size drops below your price.',
            search: { action: '/shoes', name: 'q', placeholder: 'Search a shoe, a brand or a model', label: 'Search shoes', button: 'Search', hints: ['Air Max 90', 'Samba', 'Pegasus', 'New Balance 990'] },
            chips: brands.map((b) => ({ label: b.value, href: `/shoes?brand=${encodeURIComponent(b.value)}` })),
            motif: shoeMotif(),
        },
        proof: [
            { value: facets.models, label: facets.models === 1 ? 'model tracked' : 'models tracked' },
            { value: facets.offers, label: 'offers, all-in' },
            { value: (facets.stores || []).length, label: 'stores read' },
            { value: facets.drops, label: 'upcoming drops' },
        ].filter((p) => p.value),
        rails: [
            dropRail.length ? { id: 'sh-dropping', title: 'Dropping this week', more: { href: '/drops', label: 'The calendar' }, size: 's', items: dropRail.map(dropCard) } : null,
            popularRails.length ? { id: 'sh-popular', title: 'Popular models', more: { href: '/shoes?sort=popular', label: 'See all' }, size: 's', items: popularRails.map(modelCard) } : null,
        ].filter(Boolean),
        scenes,
        explore: {
            title: 'More on Shoes',
            items: [
                { title: 'Every shoe', text: 'Search by brand, model, size and condition; every price is all-in', href: '/shoes', icon: 'ov:search' },
                { title: 'The drops calendar', text: 'Official release dates, each cited to the brand\'s or store\'s own page', href: '/drops', icon: 'ov:calendar' },
                { title: 'Your watches', text: 'The price watches and pasted links that OpenVibe.Watch carries', href: '/watches', icon: 'ov:bell' },
                { title: 'The API', text: 'Shoes, one shoe with its history and curve, drops, watches and open tracking', href: '/developers', icon: 'ov:code' },
            ],
        },
        dev: {
            title: 'For developers',
            lede: 'Every model, offer, snapshot, drop and watch is open JSON. No key for the public reads; the offers are always all-in and dated.',
            samples: [
                { label: 'Search shoes', lang: 'bash', code: `curl "https://open.shoes/api/v1/shoes?q=air+max&size=10.5&sort=price"` },
                { label: 'One shoe, with history and curve', lang: 'bash', code: `curl https://open.shoes/api/v1/shoes/nike-air-max-90` },
                { label: 'The drops calendar', lang: 'bash', code: `curl https://open.shoes/api/v1/drops` },
            ],
            links: [{ label: 'The API', href: '/developers' }, { label: 'OpenAPI', href: '/api/openapi.json' }, { label: 'llms.txt', href: '/llms.txt' }],
        },
        faq: {
            items: [
                ['Where do the prices come from?', 'From OpenVibe.Deals\' public offers (the stores\' own pages, read by the network\'s sources) and, when a host sets a key pair, the official eBay Browse API. Each offer keeps its store, its currency, the time it was checked and a stale flag. Nothing is sponsored, and there are no affiliate links.'],
                ['What is "all-in"?', 'The price plus the shipping when the store states shipping. When the store states no shipping, the page says the shipping is not stated; it never invents one. Every offer is per exact variant, size and condition where the source gives them.'],
                ['Why is a spec "not known yet"?', 'Specs, fit notes, release facts and care notes are published only from cited open sources. Shoes never invents them, so a model with no cited source says "not known yet".'],
                ['Do you scrape Facebook Marketplace?', 'No. Marketplace has no public listings API and its terms forbid scraping. A Marketplace link is tracked by pasting it: the watch holds the link, and OpenVibe.Watch applies its own fetch rules.'],
                ['Do you enter raffles for me?', 'Never. The drops calendar shows the official release page and puts a reminder on your Today agenda. Stores\' terms forbid automated entries, so Shoes does not build them.'],
                [lastChecked ? `When was the catalogue last read? ${lastChecked}.` : 'When was the catalogue last read?', jobsLine || 'The jobs read OpenVibe.Deals every 30 minutes and the official release pages every 6 hours. The exact last read is on every model page and in /api/v1/status.'],
            ],
        },
        network: {
            service: 'shoes',
            title: 'Part of OpenVibe',
            lede: 'Shoes is one room of the network. The offers come from Deals, the alerts ride Watch, and the reminders land on Today.',
            items: [
                { to: 'deals', what: 'The network\'s offer aggregator: stores, prices and observations', href: 'https://openvibe.deals' },
                { to: 'watch', what: 'Watches pages, feeds and APIs, and carries the alert', href: 'https://openvibe.watch' },
                { to: 'today', what: 'Your agenda: every drop reminder in one day', href: 'https://openvibe.today' },
            ],
        },
    });
    // The price-drop section is a real rail when there are drops and an honest note when there are none; it sits
    // directly under the hero, before the "dropping this week" and "popular models" rails.
    const railAt = body.indexOf('<section class="ovk-rail');
    const sceneAt = body.indexOf('<section class="sc-room-scenes"');
    const at = railAt >= 0 ? railAt : sceneAt;
    // The home sits in the page's width like every other page (it ran edge to edge, 10-31).
    const page = at < 0 ? `${body}${priceDropSection}` : `${body.slice(0, at)}${priceDropSection}${body.slice(at)}`;
    return `<div class="sh-wrap sh-home">${page}</div>`;
}

// ── Search ──────────────────────────────────────────────────
function shoesIndex({ models = [], facets = {}, query = {}, page = 1, total = 0, now = Date.now() } = {}) {
    const perPage = 24;
    const pages = Math.max(1, Math.ceil(total / perPage));
    const qs = (n) => {
        const p = new URLSearchParams();
        for (const k of ['q', 'brand', 'size', 'condition', 'sort']) if (query[k]) p.set(k, query[k]);
        if (n > 1) p.set('page', String(n));
        return p.toString();
    };
    const body = `<div class="sh-wrap sh-page">
<header class="sh-page-h"><p class="sh-kicker">Every shoe</p><h1>Search the catalogue</h1><p class="sh-lede">${total} model${total === 1 ? '' : 's'}${query.q ? ` for “${esc(query.q)}”` : ''}, each with every store's all-in price, the time it was checked and a stale flag.${facets.checked_at ? ` The catalogue was last read ${esc(checked(facets.checked_at, now))}.` : ''}</p></header>
${searchForm({ q: query.q || '', facets, values: query })}
${models.length ? `<ul class="sh-grid">${models.map((m) => `<li>${modelCard(m)}</li>`).join('')}</ul>` : `<div class="sh-empty"><h2>No shoe matches yet</h2><p>Try a brand, a model or a shorter word. The catalogue is filled by the Deals job; a model appears the first time a source names it.</p><p><a class="sh-btn" href="/shoes">Clear the filters</a></p></div>`}
${pages > 1 ? `<nav class="sh-page-nav" aria-label="Pages"><a${page <= 1 ? ' class="is-off"' : ''} href="/shoes?${esc(qs(page - 1))}">← Previous</a><span>Page ${page} of ${pages}</span><a${page >= pages ? ' class="is-off"' : ''} href="/shoes?${esc(qs(page + 1))}">Next →</a></nav>` : ''}
<p class="sh-fine">A model with no price says so; a price that has not been checked in ${esc(facets.stale_hours || 48)} hours is marked stale. No affiliate links, ever.</p></div>`;
    return body;
}

// ── One shoe ────────────────────────────────────────────────
function shoe({ model, offers = [], history = [], curve = { points: [], median: null }, facts = [], drops: releases = [], signedIn = false, now = Date.now() } = {}) {
    if (!model) return notFound();
    const prices = offers.map((o) => o.all_in).filter((p) => p != null);
    const low = prices.length ? Math.min(...prices) : null;
    const high = prices.length ? Math.max(...prices) : null;
    const sizes = [...new Set(offers.map((o) => o.size).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    const colours = [...new Set([...offers.map((o) => o.colourway), ...releases.map((d) => d.colourway)].filter(Boolean))];
    const stores = [...new Set(offers.map((o) => o.store))];
    const staleCount = offers.filter((o) => o.stale).length;
    const lastChecked = offers.map((o) => o.checked_at).filter(Boolean).sort().pop() || null;
    const body = `<div class="sh-wrap sh-page">
<nav class="crumbs" aria-label="Breadcrumbs"><a href="/">Home</a> / <a href="/shoes">Shoes</a> / ${esc(model.brand)} ${esc(model.model)}</nav>
<header class="sh-shoe-h"><p class="sh-kicker">${esc(model.brand)}</p><h1>${esc(model.model)}</h1>
<p class="sh-lede">${low == null ? 'No live price yet.' : `From <b>${money(low)}</b>${high != null && high !== low ? ` to ${money(high)}` : ''} all-in at ${stores.length} store${stores.length === 1 ? '' : 's'}.`} ${lastChecked ? esc(checked(lastChecked, now)) : ''}${staleCount ? ` · <span class="sh-stale">${staleCount} stale</span>` : ''}</p>
<p>${sizes.length ? `${sizes.length} size${sizes.length === 1 ? '' : 's'} priced: ${sizes.slice(0, 12).map(esc).join(', ')}` : 'Sizes not stated by the sources yet.'}</p></header>
${watchForm({ model, sizes, signedIn, next: `/shoe/${model.slug}` })}
<section class="sh-sec" aria-labelledby="sh-prices-h"><h2 id="sh-prices-h">Current prices by store</h2><p class="sh-fine">Every offer is the exact listing the store published, with its shipping when stated. A price older than ${esc(48)} hours is stale; the page never hides it.</p>${offersTable(offers)}</section>
<section class="sh-sec" aria-labelledby="sh-history-h"><h2 id="sh-history-h">Price history</h2><p class="sh-fine">One snapshot per offer per day, taken from Shoes' own checks. The line is the lowest all-in price of each day.</p>${historyChart(history)}</section>
<section class="sh-sec" aria-labelledby="sh-curve-h"><h2 id="sh-curve-h">Size-price curve</h2>${curveTable(curve)}</section>
<section class="sh-sec" aria-labelledby="sh-colours-h"><h2 id="sh-colours-h">Colourways</h2>${colours.length ? `<ul class="sh-chips">${colours.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : '<p class="sh-muted">Not known yet: no offer names a colourway.</p>'}</section>
${releases.length ? `<section class="sh-sec" aria-labelledby="sh-releases-h"><h2 id="sh-releases-h">Release dates</h2><p class="sh-fine">From the brand's or the store's own release page, cited. Shoes never enters a raffle.</p><ul class="sh-list">${releases.map((d) => `<li><b>${esc(dayLong(d.release_at))}</b> · ${esc(d.colourway || 'colourway not stated')}${d.price != null ? ` · ${money(d.price, d.currency)}` : ''}${d.sizes.length ? ` · sizes ${d.sizes.slice(0, 12).map(esc).join(', ')}` : ''} · ${sourceLine(d.source_name, d.source_url)}${signedIn ? ` · <a href="/drops#drop-${encodeURIComponent(d.id)}">Remind me</a>` : ''}</li>`).join('')}</ul></section>` : ''}
${factsSection(facts)}
<p class="sh-fine">The release facts and care notes above are the source's words, cited with the page and the date Shoes read it. The stores' own pages are the only place to buy; Shoes never takes an order.</p></div>`;
    return body;
}

// ── Drops ───────────────────────────────────────────────────
function drops({ drops: list = [], signedIn = false, notice = null, now = Date.now() } = {}) {
    const upcoming = groupDrops(list.filter((d) => Date.parse(d.release_at) >= now - 3600_000));
    const byDay = new Map();
    for (const d of upcoming) {
        const key = String(d.release_at).slice(0, 10);
        if (!byDay.has(key)) byDay.set(key, []);
        byDay.get(key).push(d);
    }
    const next7 = upcoming.filter((d) => Date.parse(d.release_at) <= now + 7 * 86400_000);
    const body = `<div class="sh-wrap sh-page">
<header class="sh-page-h"><p class="sh-kicker">The drops calendar</p><h1>Dropping this week and after</h1><p class="sh-lede">Official release dates only, each read from the brand's or the store's own public release page, with the page and the time it was read. ${next7.length} release${next7.length === 1 ? '' : 's'} in the next seven days.</p></header>
${notice ? `<div class="sh-notice" role="status">${esc(notice)}</div>` : ''}
<p class="sh-fine"><b>Never automated entries.</b> Shoes shows the official page and can put a reminder on your Today agenda. It does not enter raffles or draws; stores' terms forbid bots. Reservations only where a store offers them officially.</p>
${upcoming.length ? [...byDay.entries()].map(([day, rows]) => `<section class="sh-drop-day" aria-labelledby="sh-day-${esc(day)}"><h2 id="sh-day-${esc(day)}">${esc(dayLong(rows[0].release_at))}</h2><ul class="sh-drops">${rows.map((d) => `<li class="sh-drop" id="drop-${esc(d.id)}"><div><b>${esc(d.brand)} ${esc(d.model)}</b>${d.colourway ? ` <span class="sh-colour">${esc(d.colourway)}</span>` : ''}<span class="sh-drop-meta">${esc(clock(d.release_at))} UTC · ${d.price != null ? money(d.price, d.currency) : 'price not stated'}${d.sizes.length ? ` · ${d.sizes.length} sizes` : ''}</span><span class="sh-drop-src">${sourceLine(d.source_name, d.source_url)} · read ${esc(dayShort(d.fetched_at))}</span></div>${signedIn ? `<form method="post" action="/drops/${encodeURIComponent(d.id)}/remind"><button class="sh-btn sh-btn-quiet" type="submit">${icon('bell')} Remind me</button></form>` : `<a class="sh-btn sh-btn-quiet" href="/auth/login?next=${encodeURIComponent('/drops')}">${icon('bell')} Sign in to be reminded</a>`}</li>`).join('')}</ul></section>`).join('') : '<div class="sh-empty"><h2>No release is listed right now</h2><p>The release pages answered but published no dated release in the window. The calendar fills on the next read.</p></div>'}
</div>`;
    return body;
}

// ── Watches ─────────────────────────────────────────────────
function watches({ watches: list = [], signedIn = false, notice = null } = {}) {
    if (!signedIn) {
        return `<div class="sh-wrap sh-page"><header class="sh-page-h"><p class="sh-kicker">Your watches</p><h1>Sign in to see your watches</h1><p class="sh-lede">A watch belongs to a person. Sign in with OpenVibe and your price watches and pasted links are here.</p><p><a class="sh-btn" href="/auth/login?next=${encodeURIComponent('/watches')}">Sign in with OpenVibe</a></p></header></div>`;
    }
    const body = `<div class="sh-wrap sh-page"><header class="sh-page-h"><p class="sh-kicker">Your watches</p><h1>Watches</h1><p class="sh-lede">Every watch is carried by OpenVibe.Watch. A price watch tells you when the all-in price for your size drops below your number; a pasted link keeps the listing and lets Watch apply its own fetch rules.</p></header>
${notice ? `<div class="sh-notice" role="status">${esc(notice)}</div>` : ''}
${list.length ? `<div class="sh-table-wrap"><table class="sh-table"><caption>Your watches, newest first</caption><thead><tr><th scope="col">Kind</th><th scope="col">What</th><th scope="col">Size</th><th scope="col">Below</th><th scope="col">Status</th><th scope="col">Created</th></tr></thead><tbody>${list.map((w) => `<tr><td>${esc(w.kind)}</td><td>${w.slug ? link(`/shoe/${encodeURIComponent(w.slug)}`, w.slug) : w.source_url ? `<a href="${esc(w.source_url)}" rel="noopener nofollow">${esc(w.source_url)}</a>` : '—'}${w.note ? `<br><small>${esc(w.note)}</small>` : ''}</td><td>${w.size ? esc(w.size) : 'any'}</td><td>${w.threshold != null ? money(w.threshold, w.currency) : '—'}</td><td>${esc(w.status)}${w.remote_id ? `<br><small>Watch ${esc(w.remote_id)}</small>` : ''}</td><td>${esc(dayShort(w.created_at))}</td></tr>`).join('')}</tbody></table></div>` : '<div class="sh-empty"><h2>No watch yet</h2><p>Open a shoe and set the price for your size, or paste a listing link on the home page.</p><p><a class="sh-btn" href="/shoes">Find a shoe</a></p></div>'}
</div>`;
    return body;
}

// ── Developers ──────────────────────────────────────────────
function developers({ baseUrl = 'https://open.shoes' } = {}) {
    const api = String(baseUrl).replace(/\/+$/, '');
    const rows = [
        ['GET', '/api/v1/shoes?q&brand&size&condition&store&sort&page', 'Search the catalogue. `sort`: recent, drop, price, price_desc, popular, name. The answer carries the facets.'],
        ['GET', '/api/v1/shoes/:slug', 'One model: its offers, its daily price history, the size-price curve and the cited facts.'],
        ['GET', '/api/v1/shoes/:slug/price?size=&condition=', 'The lowest all-in price for a model (and size), for a Watch to poll.'],
        ['GET', '/api/v1/drops?from&to', 'The official release dates, soonest first, each with its source page and read time.'],
        ['GET', '/api/v1/status', 'The last read of each source: when, how many rows, whether it answered.'],
        ['POST', '/api/v1/me/watches', 'Session only: { slug, size?, condition?, threshold, currency? } → a price watch in OpenVibe.Watch.'],
        ['GET', '/api/v1/me/watches', 'Session only: the person\'s watches.'],
        ['POST', '/api/v1/me/track', 'Session only: { url } → a Watch for a pasted listing, through Watch\'s own fetch rules.'],
        ['GET', '/api/openapi.json', 'This API as an OpenAPI 3.1 document.'],
    ];
    const body = `<div class="sh-wrap sh-page">
<header class="sh-page-h"><p class="sh-kicker">Developers</p><h1>The Shoes API</h1><p class="sh-lede">Every model, offer, snapshot and drop is open JSON. The public reads take no key; a write is a signed-in person's own. There are no affiliate links and no Marketplace scraping.</p></header>
<section class="sh-sec" aria-labelledby="sh-api-h"><h2 id="sh-api-h">Routes</h2><dl class="sh-eps">${rows.map(([m, r, d]) => `<div><dt><code><b class="sh-m sh-m-${m.toLowerCase()}">${m}</b> ${esc(r)}</code></dt><dd>${esc(d)}</dd></div>`).join('')}</dl>
<p><a class="sh-btn" href="/api/openapi.json">OpenAPI 3.1</a> <a class="sh-btn sh-btn-quiet" href="/api/v1/shoes?q=air">Try a search</a></p></section>
<section class="sh-sec" aria-labelledby="sh-src-h"><h2 id="sh-src-h">Where the data comes from</h2><ul class="sh-list"><li><b>OpenVibe.Deals</b> is the network's offer aggregator: Shoes reads its public newest-offer pages and keeps the footwear, then reads each product's public record for its brand.</li><li><b>eBay</b> is read through the official Browse API, and only when the host sets a developer key pair.</li><li><b>Release pages</b> are the brand's or the store's own public release calendar (Nike SNKRS by default), read by a pure parser. A release with no date is not imported.</li><li><b>No scraping</b> of Facebook Marketplace; a Marketplace link is tracked by the person pasting it and Watch applying its own rules.</li></ul></section>
<section class="sh-sec" aria-labelledby="sh-ex-h"><h2 id="sh-ex-h">Examples</h2><pre class="sh-code"><code>curl "${api}/api/v1/shoes?q=air+max&amp;size=10.5&amp;sort=price"</code></pre>
<pre class="sh-code"><code>curl "${api}/api/v1/shoes/nike-air-max-90"</code></pre>
<pre class="sh-code"><code>curl "${api}/api/v1/drops"</code></pre></section>
<p class="sh-fine">Errors are <code>application/problem+json</code> with a <code>code</code>. The public reads are rate-limited per address; a signed-in write also needs this site's origin.</p></div>`;
    return body;
}

function track({ signedIn = false, notice = null, url = '' } = {}) {
    return `<div class="sh-wrap sh-page"><header class="sh-page-h"><p class="sh-kicker">Paste a link</p><h1>Track a listing</h1><p class="sh-lede">A store, eBay or a Facebook Marketplace listing: paste the link and it becomes a Watch. OpenVibe.Watch applies its own fetch rules; Shoes never scrapes Marketplace, and never reads a page itself.</p></header>
${notice ? `<div class="sh-notice" role="status">${esc(notice)}</div>` : ''}
${signedIn ? `<form class="sh-track-form" method="post" action="/track"><label for="sh-track-url">The listing link</label><input id="sh-track-url" type="url" name="url" value="${esc(url)}" placeholder="https://www.ebay.com/itm/…" required maxlength="2000"><button class="sh-btn" type="submit">${icon('link')} Track it</button></form>` : `<p><a class="sh-btn" href="/auth/login?next=${encodeURIComponent('/track')}">Sign in with OpenVibe</a> and paste the link.</p>`}
<section class="sh-sec"><h2>What Shoes will and will not do</h2><ul class="sh-list"><li><b>Will</b> keep the link as a Watch with OpenVibe.Watch, which fetches it under its own rules and tells you when it changes.</li><li><b>Will not</b> scrape Facebook Marketplace, or any site whose terms forbid it.</li><li><b>Will not</b> buy, bid, reserve or enter anything for you.</li></ul></section></div>`;
}

function signIn({ title = 'Sign in', next = '/' } = {}) {
    return `<div class="sh-wrap sh-page"><header class="sh-page-h"><p class="sh-kicker">OpenVibe account</p><h1>${esc(title)}</h1><p class="sh-lede">This page belongs to a person. Sign in with OpenVibe; you come back to where you were.</p><p><a class="sh-btn" href="/auth/login?next=${encodeURIComponent(next)}">Sign in with OpenVibe</a></p></header></div>`;
}

function notFound() {
    return `<div class="sh-wrap sh-page"><header class="sh-page-h"><p class="sh-kicker">404</p><h1>No such page</h1><p class="sh-lede">That shoe, drop or page is not here. The catalogue is at <a href="/shoes">/shoes</a>, the drops at <a href="/drops">/drops</a>.</p><p><a class="sh-btn" href="/">Home</a></p></header></div>`;
}

module.exports = { home, shoesIndex, shoe, drops, watches, track, developers, signIn, notFound, modelCard, dropCard, groupDrops, money, historyChart, curveBars, offersTable };
