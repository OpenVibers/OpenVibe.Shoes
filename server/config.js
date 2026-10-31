'use strict';

/**
 * OpenVibe.Shoes configuration (open.shoes). Every value comes from the environment (production:
 * /etc/openvibe/shoes.env, see .env.example). Only environment variable NAMES appear in code and docs; secrets are
 * never logged.
 *
 * load(env) is pure so tests can build a config without touching process.env.
 */
require('dotenv').config();
const trim = (s) => String(s || '').replace(/\/+$/, '');
const int = (v, def) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : def);
const bool = (v, def = false) => (v == null ? def : v === '1' || v === 'true' || v === 'yes');

function load(env = process.env) {
    const nodeEnv = env.NODE_ENV || 'development';
    const isProduction = nodeEnv === 'production';
    const port = int(env.PORT, 5180);
    const baseUrl = trim(env.BASE_URL || (isProduction ? 'https://open.shoes' : `http://localhost:${port}`));
    const networkUrl = trim(env.OV_NETWORK_URL || 'https://openvibe.network');

    return {
        service: 'shoes',
        room: 'shoes',
        port,
        host: env.HOST || '127.0.0.1',
        nodeEnv,
        isProduction,
        baseUrl,
        trustProxy: env.TRUST_PROXY != null ? Number(env.TRUST_PROXY) : 2,
        drill: bool(env.SHOES_DRILL),
        limits: {
            minute: Math.max(1, int(env.SHOES_LIMITS_MINUTE, 120)),
            hour: Math.max(1, int(env.SHOES_LIMITS_HOUR, 3000)),
        },

        // PostgreSQL (ADR-035): DATABASE_URL serves (PgBouncer), DATABASE_DIRECT_URL migrates (owner role). In
        // development without DATABASE_URL an embedded PGlite database in data/pglite is used (SHOES_PGLITE_DIR
        // overrides the directory).
        db: { url: env.DATABASE_URL || '', directUrl: env.DATABASE_DIRECT_URL || '', pgliteDir: env.SHOES_PGLITE_DIR || '' },
        valkey: { url: env.VALKEY_URL || '', prefix: env.VALKEY_PREFIX || 'ov:shoes:' },

        // OpenVibe.Network: SSO (OAuth2 authorization server with PKCE) and its JWKS.
        networkUrl,
        networkInternalUrl: trim(env.OV_NETWORK_INTERNAL_URL || 'http://127.0.0.1:4000'),
        networkIssuer: trim(env.OV_NETWORK_ISSUER || networkUrl),
        audience: env.SHOES_AUDIENCE || 'open.shoes',
        oauth: {
            clientId: env.OV_OAUTH_CLIENT_ID || 'shoes',
            clientSecret: env.OV_OAUTH_CLIENT_SECRET || '',
            redirectUri: env.OV_OAUTH_REDIRECT_URI || `${baseUrl}/auth/callback`,
            scope: 'profile',
            sessionAudience: env.OV_SESSION_AUDIENCE || 'openvibe.network',
        },
        cookies: { secure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : isProduction },

        // OpenVibe.Events → this service's account export/deletion route. The secret signs a delivery
        // (comma-separated for rotation, 32+ characters each); unset turns POST /internal/events off (503).
        events: {
            secrets: String(env.SHOES_EVENTS_SECRET || '').split(',').map((x) => x.trim()).filter(Boolean),
            url: trim(env.SHOES_EVENTS_URL || env.EVENTS_URL || ''),
            endpoint: env.SHOES_EVENTS_ENDPOINT || '',
            intervalMs: Math.max(500, int(env.SHOES_EVENTS_INTERVAL_MS, 5000)),
            scope: env.SHOES_EVENTS_SCOPE || 'events.event.publish',
        },

        // The sources the jobs read. OpenVibe.Deals is the network's own offer aggregator (its public API); the drop
        // source is a brand's or a store's own public release page. eBay's official Browse API is used only when a
        // key pair is set. No key, no source: that part is off with a plain note, never an error.
        sources: {
            dealsUrl: trim(env.SHOES_DEALS_URL || 'https://openvibe.deals'),
            offersPages: Math.max(1, Math.min(200, int(env.SHOES_OFFERS_PAGES, 20))),
            productLookups: Math.max(0, Math.min(500, int(env.SHOES_PRODUCT_LOOKUPS, 300))),
            dropsUrl: trim(env.SHOES_DROPS_URL || 'https://www.nike.com/launch'),
            dropsSourceName: env.SHOES_DROPS_SOURCE_NAME || 'Nike SNKRS launch calendar',
            dropFeeds: (() => {
                const raw = String(env.SHOES_DROP_FEEDS || '').trim();
                if (!raw) return [];
                try {
                    const parsed = JSON.parse(raw);
                    return Array.isArray(parsed) ? parsed.filter((x) => x && x.url) : [];
                } catch { return []; }
            })(),
            staleHours: Math.max(1, int(env.SHOES_STALE_HOURS, 48)),
            timeoutMs: Math.max(500, int(env.SHOES_UPSTREAM_TIMEOUT_MS, 15000)),
            requestGapMs: Math.max(0, int(env.SHOES_REQUEST_GAP_MS, 250)),
            ebay: {
                clientId: env.SHOES_EBAY_CLIENT_ID || '',
                clientSecret: env.SHOES_EBAY_CLIENT_SECRET || '',
                marketplace: env.SHOES_EBAY_MARKETPLACE || 'EBAY_US',
                apiUrl: trim(env.SHOES_EBAY_API_URL || 'https://api.ebay.com'),
                limit: Math.max(1, Math.min(200, int(env.SHOES_EBAY_LIMIT, 50))),
                categoryId: env.SHOES_EBAY_CATEGORY_ID || '93427',
            },
        },

        // OpenVibe.Watch: the watch service that carries the alerts. The call is made with the signed-in person's
        // own Network token; without one the watch is saved here and marked "not connected" (a plain note, never
        // an error).
        watch: {
            url: trim(env.SHOES_WATCH_URL || 'https://openvibe.watch'),
            internalUrl: trim(env.SHOES_WATCH_INTERNAL_URL || 'http://127.0.0.1:4730'),
            everySec: Math.max(900, int(env.SHOES_WATCH_EVERY_SEC, 21600)),
        },

        // OpenVibe.Today: the drops calendar's reminders.
        today: {
            url: trim(env.SHOES_TODAY_URL || 'https://openvibe.today'),
            internalUrl: trim(env.SHOES_TODAY_INTERNAL_URL || 'http://127.0.0.1:5100'),
        },

        // The jobs. Each refuses to start under SHOES_DRILL; tests call their runOnce().
        jobs: {
            offersIntervalMs: Math.max(60_000, int(env.SHOES_OFFERS_INTERVAL_MS, 30 * 60_000)),
            dropsIntervalMs: Math.max(60_000, int(env.SHOES_DROPS_INTERVAL_MS, 6 * 60 * 60_000)),
            ebayIntervalMs: Math.max(60_000, int(env.SHOES_EBAY_INTERVAL_MS, 60 * 60_000)),
        },
    };
}

module.exports = { load };
