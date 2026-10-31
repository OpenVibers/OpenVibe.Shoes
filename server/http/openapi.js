'use strict';

/**
 * The OpenAPI 3.1 document for the Shoes API. Kept as data, not a framework: every route the service answers is
 * listed here with its parameters and an honest answer shape. The servers are this host and the production host.
 */
function openapi(config = {}) {
    const base = String(config.baseUrl || 'https://open.shoes').replace(/\/+$/, '');
    const problem = { $ref: '#/components/schemas/Problem' };
    const params = {
        q: { name: 'q', in: 'query', schema: { type: 'string', maxLength: 80 }, description: 'A brand, model or name fragment.' },
        brand: { name: 'brand', in: 'query', schema: { type: 'string', maxLength: 80 } },
        size: { name: 'size', in: 'query', schema: { type: 'string', maxLength: 12 } },
        condition: { name: 'condition', in: 'query', schema: { type: 'string', enum: ['new', 'used', 'deadstock'] } },
        store: { name: 'store', in: 'query', schema: { type: 'string', maxLength: 120 } },
        sort: { name: 'sort', in: 'query', schema: { type: 'string', enum: ['recent', 'drop', 'price', 'price_desc', 'popular', 'name'], default: 'recent' } },
        page: { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
        limit: { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 24 } },
        slug: { name: 'slug', in: 'path', required: true, schema: { type: 'string', maxLength: 80 } },
        from: { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
        to: { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
    };
    const ok = (schema) => ({ 200: { description: 'OK', content: { 'application/json': { schema } } } });
    const bad = { 400: { description: 'Bad request', content: { 'application/problem+json': { schema: problem } } }, 404: { description: 'Not found', content: { 'application/problem+json': { schema: problem } } } };
    return {
        openapi: '3.1.0',
        info: {
            title: 'OpenVibe.Shoes API',
            version: '0.1.0',
            summary: 'Every shoe, every market, the right price.',
            description: 'Shoes aggregates official store offers into one all-in price per variant, keeps its own daily price snapshots, and exposes the drops calendar and a person\'s watches. Public reads take no key. There are no affiliate links and no Marketplace scraping.',
            license: { name: 'AGPL-3.0-only', url: 'https://www.gnu.org/licenses/agpl-3.0.html' },
        },
        servers: [{ url: base }, { url: 'https://open.shoes' }],
        tags: [{ name: 'shoes' }, { name: 'drops' }, { name: 'me' }, { name: 'status' }],
        paths: {
            '/api/v1/shoes': {
                get: {
                    tags: ['shoes'], summary: 'Search the catalogue', operationId: 'listShoes',
                    parameters: [params.q, params.brand, params.size, params.condition, params.store, params.sort, params.page, params.limit],
                    responses: { ...ok({ $ref: '#/components/schemas/ShoeList' }), ...bad },
                },
            },
            '/api/v1/shoes/{slug}': {
                get: {
                    tags: ['shoes'], summary: 'One model with its offers, history, curve and cited facts', operationId: 'getShoe',
                    parameters: [params.slug],
                    responses: { ...ok({ $ref: '#/components/schemas/ShoePage' }), ...bad },
                },
            },
            '/api/v1/shoes/{slug}/price': {
                get: {
                    tags: ['shoes'], summary: 'The lowest all-in price for a model (and size)', operationId: 'getShoePrice',
                    parameters: [params.slug, params.size, params.condition],
                    responses: { ...ok({ $ref: '#/components/schemas/Price' }), ...bad },
                },
            },
            '/api/v1/drops': {
                get: {
                    tags: ['drops'], summary: 'The official release dates', operationId: 'listDrops',
                    parameters: [params.from, params.to],
                    responses: { ...ok({ type: 'object', properties: { drops: { type: 'array', items: { $ref: '#/components/schemas/Drop' } } } }), ...bad },
                },
            },
            '/api/v1/drops/{id}': {
                get: {
                    tags: ['drops'], summary: 'One drop', operationId: 'getDrop',
                    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
                    responses: { ...ok({ $ref: '#/components/schemas/Drop' }), ...bad },
                },
            },
            '/api/v1/me/watches': {
                get: {
                    tags: ['me'], summary: 'The signed-in person\'s watches', operationId: 'listWatches',
                    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
                    responses: { ...ok({ type: 'object', properties: { watches: { type: 'array', items: { $ref: '#/components/schemas/Watch' } } } }), 401: { description: 'Not signed in', content: { 'application/problem+json': { schema: problem } } } },
                },
                post: {
                    tags: ['me'], summary: 'Tell me when this drops below $X at my size', operationId: 'createWatch',
                    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
                    requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/WatchRequest' } } } },
                    responses: { 201: { description: 'Created', content: { 'application/json': { schema: { type: 'object', properties: { watch: { $ref: '#/components/schemas/Watch' }, remote: { type: 'object', nullable: true } } } } } }, ...bad },
                },
            },
            '/api/v1/me/track': {
                post: {
                    tags: ['me'], summary: 'Track a pasted listing link through OpenVibe.Watch', operationId: 'trackLink',
                    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
                    requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['url'], properties: { url: { type: 'string', format: 'uri', maxLength: 2000 } } } } } },
                    responses: { 201: { description: 'Created', content: { 'application/json': { schema: { type: 'object', properties: { watch: { $ref: '#/components/schemas/Watch' }, remote: { type: 'object', nullable: true } } } } } }, ...bad },
                },
            },
            '/api/v1/status': {
                get: {
                    tags: ['status'], summary: 'The last read of each source', operationId: 'getStatus',
                    responses: { ...ok({ type: 'object', properties: { counts: { type: 'object' }, jobs: { type: 'array', items: { type: 'object' } } } }) },
                },
            },
        },
        components: {
            securitySchemes: {
                bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
                cookieAuth: { type: 'apiKey', in: 'cookie', name: 'shoes_at' },
            },
            schemas: {
                Problem: { type: 'object', required: ['type', 'title', 'status', 'code'], properties: { type: { type: 'string' }, title: { type: 'string' }, status: { type: 'integer' }, code: { type: 'string' }, detail: { type: 'string' } } },
                Offer: {
                    type: 'object',
                    properties: {
                        id: { type: 'string' }, store: { type: 'string' }, store_name: { type: 'string', nullable: true },
                        title: { type: 'string' }, url: { type: 'string', format: 'uri' },
                        price: { type: 'number', nullable: true }, list_price: { type: 'number', nullable: true },
                        shipping: { type: 'number', nullable: true }, shipping_known: { type: 'boolean' }, all_in: { type: 'number', nullable: true },
                        drop_from_list: { type: 'number', nullable: true }, currency: { type: 'string' },
                        condition: { type: 'string', nullable: true }, size: { type: 'string', nullable: true }, colourway: { type: 'string', nullable: true },
                        checked_at: { type: 'string', format: 'date-time' }, stale: { type: 'boolean' }, source: { type: 'string' },
                    },
                },
                Shoe: {
                    type: 'object',
                    properties: {
                        id: { type: 'string' }, slug: { type: 'string' }, brand: { type: 'string' }, model: { type: 'string' }, name: { type: 'string' },
                        price_min: { type: 'number', nullable: true }, price_max: { type: 'number', nullable: true },
                        offer_count: { type: 'integer' }, store_count: { type: 'integer' }, stale_count: { type: 'integer' },
                        checked_at: { type: 'string', format: 'date-time', nullable: true }, drop_amount: { type: 'number', nullable: true }, drop_percent: { type: 'number', nullable: true },
                    },
                },
                ShoeList: {
                    type: 'object',
                    properties: {
                        shoes: { type: 'array', items: { $ref: '#/components/schemas/Shoe' } },
                        page: { type: 'integer' }, per_page: { type: 'integer' }, total: { type: 'integer' },
                        facets: { type: 'object' },
                    },
                },
                ShoePage: {
                    type: 'object',
                    properties: {
                        shoe: { $ref: '#/components/schemas/Shoe' },
                        offers: { type: 'array', items: { $ref: '#/components/schemas/Offer' } },
                        history: { type: 'array', items: { type: 'object', properties: { day: { type: 'string', format: 'date' }, price: { type: 'number' }, offers: { type: 'integer' } } } },
                        curve: { type: 'object', properties: { median: { type: 'number', nullable: true }, points: { type: 'array', items: { type: 'object' } } } },
                        facts: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string' }, label: { type: 'string' }, value: { type: 'string' }, source_name: { type: 'string' }, source_url: { type: 'string' }, fetched_at: { type: 'string' } } } },
                        drops: { type: 'array', items: { $ref: '#/components/schemas/Drop' } },
                    },
                },
                Price: { type: 'object', properties: { slug: { type: 'string' }, size: { type: 'string', nullable: true }, condition: { type: 'string', nullable: true }, price: { type: 'number', nullable: true }, currency: { type: 'string' }, checked_at: { type: 'string', nullable: true }, offers: { type: 'integer' } } },
                Drop: {
                    type: 'object',
                    properties: {
                        id: { type: 'string' }, slug: { type: 'string' }, brand: { type: 'string' }, model: { type: 'string' }, colourway: { type: 'string', nullable: true },
                        release_at: { type: 'string', format: 'date-time' }, price: { type: 'number', nullable: true }, currency: { type: 'string' },
                        sizes: { type: 'array', items: { type: 'string' } }, source_name: { type: 'string' }, source_url: { type: 'string', format: 'uri' }, fetched_at: { type: 'string' },
                    },
                },
                Watch: {
                    type: 'object',
                    properties: {
                        id: { type: 'string' }, kind: { type: 'string', enum: ['price', 'link'] }, slug: { type: 'string', nullable: true }, size: { type: 'string', nullable: true },
                        condition: { type: 'string', nullable: true }, threshold: { type: 'number', nullable: true }, currency: { type: 'string' },
                        source_url: { type: 'string', nullable: true }, remote_id: { type: 'string', nullable: true }, status: { type: 'string' }, note: { type: 'string', nullable: true }, created_at: { type: 'string' },
                    },
                },
                WatchRequest: {
                    type: 'object', required: ['slug', 'threshold'],
                    properties: {
                        slug: { type: 'string', maxLength: 80 }, size: { type: 'string', maxLength: 12 }, condition: { type: 'string', enum: ['new', 'used', 'deadstock'] },
                        threshold: { type: 'number', exclusiveMinimum: 0 }, currency: { type: 'string', default: 'USD' },
                    },
                },
            },
        },
    };
}

module.exports = { openapi };
