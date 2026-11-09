-- phase: expand
-- The shared product catalog can grow beyond shoe_models without changing the established shoe/offer tables.
-- Accessory rows are published only after a cited, permitted source is configured.
CREATE TABLE shoe_products (
    id text COLLATE "C" PRIMARY KEY,
    kind text COLLATE "C" NOT NULL,
    slug text COLLATE "C" NOT NULL UNIQUE,
    title text COLLATE "C" NOT NULL,
    brand text COLLATE "C",
    model text COLLATE "C",
    url text,
    image text,
    sizes jsonb NOT NULL DEFAULT '[]'::jsonb,
    materials jsonb NOT NULL DEFAULT '[]'::jsonb,
    uses jsonb NOT NULL DEFAULT '[]'::jsonb,
    source_name text COLLATE "C" NOT NULL,
    source_url text NOT NULL,
    checked_at timestamptz NOT NULL,
    facts jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT shoe_products_kind CHECK (kind IN ('shoe', 'laces', 'socks', 'care', 'insoles', 'kids')),
    CONSTRAINT shoe_products_slug CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' AND length(slug) <= 160),
    CONSTRAINT shoe_products_source_url CHECK (source_url ~ '^https?://'),
    CONSTRAINT shoe_products_url CHECK (url IS NULL OR url ~ '^https?://'),
    CONSTRAINT shoe_products_image CHECK (image IS NULL OR image ~ '^https?://')
);
CREATE INDEX shoe_products_kind_title ON shoe_products (kind, lower(title));
CREATE INDEX shoe_products_checked ON shoe_products (checked_at DESC);

CREATE TABLE shoe_product_offers (
    id text COLLATE "C" PRIMARY KEY,
    product_id text COLLATE "C" NOT NULL REFERENCES shoe_products (id) ON DELETE CASCADE,
    source text COLLATE "C" NOT NULL,
    source_id text COLLATE "C" NOT NULL,
    store_domain text COLLATE "C" NOT NULL,
    store_name text,
    title text COLLATE "C" NOT NULL,
    url text NOT NULL,
    price_amount numeric(10,2),
    shipping_amount numeric(10,2),
    currency text COLLATE "C" NOT NULL DEFAULT 'USD',
    size text COLLATE "C",
    condition text COLLATE "C",
    checked_at timestamptz NOT NULL,
    stale boolean NOT NULL DEFAULT false,
    raw jsonb NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT shoe_product_offers_unique UNIQUE (source, source_id),
    CONSTRAINT shoe_product_offers_url CHECK (url ~ '^https?://'),
    CONSTRAINT shoe_product_offers_price CHECK (price_amount IS NULL OR price_amount >= 0),
    CONSTRAINT shoe_product_offers_shipping CHECK (shipping_amount IS NULL OR shipping_amount >= 0)
);
CREATE INDEX shoe_product_offers_product ON shoe_product_offers (product_id, checked_at DESC);
