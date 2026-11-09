'use strict';

/**
 * Open.Shoes — Express app factory; server/index.js listens, tests build their own instance with a temp
 * database and a mock Network.
 *
 *   /, /shoes, /shoe/:slug, /drops, /track, /watches, /developers   the pages (http/pages.js)
 *   /api/v1/*                                                       the API (http/api.js)
 *   /api/openapi.json                                               the OpenAPI document
 *   /auth/*                                                         Network SSO with PKCE (auth/sso.js)
 *   /api/health, /api/ready, /release.json, /metrics                (loopback only)
 *   /internal/events                                                account export/deletion (loopback only)
 *
 * The offers, drops and eBay jobs are made here but started by server/index.js (and never under SHOES_DRILL);
 * tests drive their runOnce().
 */
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const contracts = require('openvibe-contracts');
const cache = require('openvibe-shared/cache-policy');

const configLib = require('./config');
const { openStore } = require('./db');
const { createKeyStore } = require('./auth/keys');
const { createSso } = require('./auth/sso');
const { createPrincipal } = require('./http/principal');
const { createApi } = require('./http/api');
const { createPageRoutes } = require('./http/pages');
const { createSharing } = require('./sharing');
const { openapi } = require('./http/openapi');
const { createServiceReadiness } = require('./observability');
const { assetVersion, setRelease } = require('./render/layout');
const { createCatalogue } = require('./catalogue');
const { createProductStore } = require('./product-store');
const { createUpstreams } = require('./upstreams');
const { createJobs } = require('./jobs');
const { createSearchIndex } = require('./search-index');

const accountDataLib = require('./identity/account-data');
const { createNetworkSender } = require('openvibe-sdk/account-data');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const VERSION = require('../package.json').version;
const { createHttpTelemetry } = require('openvibe-sdk/service');
const { createPgTelemetrySink } = require('openvibe-sdk/telemetry');

/**
 * opts: config, store, now (clock), fetchImpl (Network and the public upstreams), log, valkey, accountSend (a
 * stand-in for Network's internal routes; tests only), telemetrySink.
 */
async function createApp(opts = {}) {
    const config = opts.config || configLib.load();
    const log = opts.log || console;
    const fetchImpl = opts.fetchImpl || globalThis.fetch;
    const s = opts.store || await openStore(config, { now: opts.now, log });

    const keys = createKeyStore({ config, fetchImpl, log });
    const sso = createSso({ config, keys, fetchImpl, now: s.now, log });
    const principal = createPrincipal({ config, keys });
    // The one sharing system (design 2026-11-06): a watch is its owner's until the Share sheet says otherwise.
    const sharing = opts.sharing || createSharing({ db: s.db, config, fetchImpl, log });
    const catalogue = createCatalogue(s, { staleHours: config.sources.staleHours, sharing });
    const products = createProductStore(s);
    const upstreams = createUpstreams({ config, fetchImpl, log, urlCheck: opts.urlCheck });
    const jobs = createJobs({ config, catalogue, products, upstreams, log });
    // The model pages in OpenVibe.Search (started by server/index.js, never under SHOES_DRILL).
    const searchIndex = createSearchIndex({ config, s, log });

    // Account export and deletion (ADR-033). The sender posts to Network's internal routes with this service's own
    // client-credentials token; a test injects a stand-in through opts.accountSend.
    const accountData = accountDataLib.create({ db: s.db, log });
    const accountSend = opts.accountSend || (config.oauth.clientSecret
        ? createNetworkSender({ networkInternalUrl: config.networkInternalUrl, clientId: config.oauth.clientId, clientSecret: config.oauth.clientSecret, fetch: fetchImpl })
        : async () => { throw new Error('OV_OAUTH_CLIENT_SECRET is not set: Shoes cannot answer account events'); });

    const ctx = { config, s, keys, sso, principal, catalogue, products, upstreams, jobs, searchIndex, sharing, accountData, accountSend, log };

    const app = express();
    // /.well-known/agent.json (openvibe-shared/agent-layer, SEO-2): what this site serves, for agents.
    require('openvibe-shared/agent-layer').mount(app, { descriptor: require('./agent-descriptor') });
    app.disable('x-powered-by');
    app.set('trust proxy', config.trustProxy);
    const release = require('openvibe-shared/release').createRelease({ service: 'shoes', root: path.join(__dirname, '..') });
    setRelease(release.release);
    const metrics = require('openvibe-shared/metrics').instrument(app, { service: 'shoes', release: release.release });
    app.locals.metrics = metrics.registry;
    ctx.telemetry = createHttpTelemetry({ service: 'shoes', sink: opts.telemetrySink || createPgTelemetrySink({ db: s.db, log }), skipPrefixes: ['/shared'], intervalMs: 60_000 });
    app.use(ctx.telemetry.middleware());
    app.locals.ctx = ctx;

    const valkey = opts.valkey !== undefined ? opts.valkey : (config.valkey.url ? require('openvibe-sdk/valkey').createValkey({ url: config.valkey.url, prefix: config.valkey.prefix, log }) : null);
    ctx.valkey = valkey;

    app.use(contracts.http.middleware());
    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", "'unsafe-inline'", 'https://openvibe.network', 'https://static.cloudflareinsights.com'],
                styleSrc: ["'self'", "'unsafe-inline'", 'https://openvibe.network', 'https://fonts.googleapis.com', 'https://cdnjs.cloudflare.com'],
                fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com'],
                imgSrc: ["'self'", 'data:', 'https://openvibe.network', 'https://openvibe.media', 'https://static.nike.com'],
                connectSrc: ["'self'", 'https://openvibe.network', 'https://openvibe.chat', 'https://cloudflareinsights.com', 'https://openvibe.events'],
                frameSrc: ["'self'", 'https://openvibe.network'],
                frameAncestors: ["'none'"],
                objectSrc: ["'none'"],
                baseUri: ["'self'"],
                formAction: ["'self'", 'https://openvibe.network'],
            },
        },
        frameguard: { action: 'deny' },
        crossOriginEmbedderPolicy: false,
        crossOriginResourcePolicy: { policy: 'same-site' },
        referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }));
    app.use(cookieParser());

    // ── Machine endpoints ───────────────────────────────────
    app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'openvibe-shoes', name: 'Open.Shoes', version: VERSION }));
    release.mount(app, { registry: metrics.registry });
    const readiness = createServiceReadiness({ s, config, release: release.release, valkey });
    app.get('/api/ready', readiness.handler);

    // ── Who is asking (verified offline; refreshed when expired) ──
    app.use(sso.middleware());

    // ── Sign-in (OAuth2 + PKCE client of OpenVibe.Network) ──
    app.use('/auth/', rateLimit({ windowMs: 15 * 60_000, limit: 60, standardHeaders: true, legacyHeaders: false }));
    app.use('/auth', sso.routes());
    { const legal = require('openvibe-shared/legal'); app.get(legal.PATHS, legal.handler({ id: 'shoes', service: 'shoes', host: 'open.shoes', name: 'Open.Shoes', profile: 'ugc' })); }

    // ── OpenVibe.Events → this service (loopback only) ──────
    // Account export/deletion; the consumer reads the raw body itself, so it is mounted before any body parser.
    // nginx answers 404 for /internal/.
    app.use('/internal/events', accountData.consumer({
        secrets: config.events.secrets,
        send: accountSend,
        now: s.now,
        onEvent: async (ev) => `ignored:${ev.event_type}`,
    }));

    // ── Static assets (content-hashed ?v= → immutable) ──────
    app.use('/shared', require('openvibe-shared/serve').handler());
    app.use(express.static(PUBLIC_DIR, {
        index: false, redirect: false,
        setHeaders(res, filePath) {
            const rel = path.relative(PUBLIC_DIR, filePath).split(path.sep).join('/');
            const v = res.req && res.req.query && res.req.query.v;
            res.setHeader('Cache-Control', cache.assetHeaders(rel, { hashed: !!v && v === assetVersion(rel) }));
        },
    }));

    // ── /api/v1/watch/:id/share — the one Share sheet's API (openvibe-sdk/share) ──
    // GET/PUT .../share, .../share/requests, .../share/transfer[/accept|decline|cancel], GET /api/v1/share/people
    // and /api/v1/shared-with-me. Access is still decided by canView on every read path; the router answers only
    // its own paths.
    {
        const shareApi = express.Router();
        shareApi.use(principal.middleware);
        shareApi.use(sharing.shares.router({
            service: 'shoes',
            authenticate: (req) => sharing.shareViewer(req.principal.kind === 'user' ? req.principal : req.viewer),
            describe: sharing.describe,
        }));
        const SHARE_PATH = /^\/api\/v1\/(?:shared-with-me$|share\/people$|[^/]+\/[^/]+\/share(?:\/|$))/;
        app.use((req, res, next) => (SHARE_PATH.test(req.path) ? shareApi(req, res, next) : next()));
    }
    // Expire members and transfers and send queued share events/notifications. Unref'd: it never holds a test open.
    if (opts.startSharingWorker !== false) {
        const timer = setInterval(() => { sharing.work().catch(() => { /* logged inside */ }); }, 15_000);
        if (timer.unref) timer.unref();
        app.locals.sharingTimer = timer;
    }

    // ── API ─────────────────────────────────────────────────
    app.get('/api/openapi.json', (req, res) => res.json(openapi(config)));
    app.use('/api/v1', rateLimit({ windowMs: 60_000, limit: Number(process.env.SHOES_API_RATE_LIMIT_PER_MIN) || 240, standardHeaders: true, legacyHeaders: false, handler: (req, res) => contracts.http.sendProblem(res, 429, 'rate_limited', { detail: 'too many requests from this address; retry shortly', ctx: req.ov }) }));
    app.use('/api/v1', createApi(ctx));
    // GET /openapi.json (SEO-3): the API's OpenAPI 3.1 document, the same one /api/v1/openapi.json serves.
    app.get('/openapi.json', (_req, res) => res.set('Cache-Control', 'public, max-age=3600').set('Access-Control-Allow-Origin', '*').json(require('./http/openapi').openapi(config)));
    app.use('/api', (req, res) => contracts.http.sendProblem(res, 404, 'route.not_found', { detail: 'No such API route', ctx: req.ov }));

    // ── Pages ───────────────────────────────────────────────
    app.use(rateLimit({ windowMs: 60_000, limit: Number(process.env.SHOES_RATE_LIMIT_PER_MIN) || 300, standardHeaders: true, legacyHeaders: false }));
    const pageRoutes = createPageRoutes(ctx);
    // The Markdown twins of the public pages, and the head link and Link: header that name them (SEO-1,
    // server/agent-twins.js): a twin is the page rendered signed out.
    require('./agent-twins').mountTwins(app, { router: pageRoutes, descriptor: require('./agent-descriptor'), baseUrl: ctx.config.baseUrl });
    app.use(pageRoutes);
    app.use((req, res) => sendNotFound(req, res, ctx));

    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, _next) => {
        log.error('[Open.Shoes]', err && err.message ? err.message.slice(0, 300) : err);
        if (res.headersSent) return;
        res.set('Cache-Control', cache.htmlHeaders({ private: true }));
        if (err && err.type === 'entity.parse.failed') return contracts.http.sendProblem(res, 400, 'request.malformed_json', { ctx: req.ov });
        if (err && err.type === 'entity.too.large') return req.path.startsWith('/api/') ? contracts.http.sendProblem(res, 413, 'request.too_large', { ctx: req.ov }) : res.status(413).type('text/plain').send('That request was too large.');
        if (req.path.startsWith('/api/')) return contracts.http.sendProblem(res, 500, 'internal.error', { detail: 'Internal error', ctx: req.ov });
        res.status(500).type('text/plain').send('Something went wrong on our side. Try again in a moment.');
    });

    return { app, ctx };
}

function sendNotFound(req, res, ctx) {
    const views = require('./views');
    const { send } = require('./render/layout');
    return send(res, 404, {
        viewer: req.viewer, config: ctx.config, path: req.originalUrl, title: 'Not found',
        body: views.notFound(), active: '/',
    });
}

module.exports = { createApp };
