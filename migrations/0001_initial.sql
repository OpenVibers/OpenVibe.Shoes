-- phase: expand
-- OpenVibe.Shoes: the shoe catalogue (open.shoes). Every offer comes from an official source with the time it was
-- checked; every price history point is one snapshot per offer per day; every drop cites the release page it came
-- from; every spec or care note is cited to the open source that said it, or the page says "not known yet".
-- Nothing here is a secret: a watch holds a person's subject id, a threshold and the public URL they pasted.

-- One model: a brand and a model name ("Nike" + "Air Max 90"). The slug is the page: /shoe/<brand>-<model>.
CREATE TABLE shoe_models (
    id            text COLLATE "C" PRIMARY KEY,              -- shm_ + 26 Crockford base32 characters (ULID)
    slug          text COLLATE "C" NOT NULL UNIQUE,          -- /shoe/<brand>-<model>
    brand         text COLLATE "C" NOT NULL,
    model         text COLLATE "C" NOT NULL,
    name          text COLLATE "C" NOT NULL,                 -- the model's name as its source wrote it
    first_seen_at timestamptz NOT NULL,
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT shoe_models_id CHECK (id ~ '^shm_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT shoe_models_slug CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' AND length(slug) <= 80),
    CONSTRAINT shoe_models_brand CHECK (length(brand) BETWEEN 1 AND 80),
    CONSTRAINT shoe_models_model CHECK (length(model) BETWEEN 1 AND 120),
    CONSTRAINT shoe_models_unique UNIQUE (brand, model)
);
CREATE INDEX shoe_models_brand ON shoe_models (brand);

-- One offer: a store's listing of one model, with the price, the shipping when the store states it, the list price
-- when the source gives one, the condition, the size when the source names one, the time the source was checked and
-- a stale flag. raw holds the source's own item (public, no credentials).
CREATE TABLE shoe_offers (
    id              text COLLATE "C" PRIMARY KEY,            -- sho_ + 26 Crockford base32 characters (ULID)
    model_id        text COLLATE "C" NOT NULL REFERENCES shoe_models (id) ON DELETE CASCADE,
    source          text COLLATE "C" NOT NULL,               -- the source that published it (deals | ebay)
    source_id       text COLLATE "C" NOT NULL,               -- that source's own id
    store_domain    text COLLATE "C" NOT NULL,
    store_name      text,
    title           text COLLATE "C" NOT NULL,
    url             text NOT NULL,                          -- the store's own page for the listing
    price_amount    numeric(10,2),                          -- the price as the source stated it
    list_price_amount numeric(10,2),                        -- the source's own "was" price, when it states one
    currency        text COLLATE "C" NOT NULL DEFAULT 'USD',
    shipping_amount numeric(10,2),                          -- null when the store states no shipping
    condition       text COLLATE "C",                       -- new | used | deadstock | null (not stated)
    size            text COLLATE "C",                       -- the size, when the source names one
    colourway       text COLLATE "C",
    checked_at      timestamptz NOT NULL,                   -- when the source was checked
    stale           boolean NOT NULL DEFAULT false,
    active          boolean NOT NULL DEFAULT true,
    raw             jsonb NOT NULL DEFAULT '{}'::jsonb,     -- the source's own public item
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT shoe_offers_id CHECK (id ~ '^sho_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT shoe_offers_unique UNIQUE (source, source_id),
    CONSTRAINT shoe_offers_price CHECK (price_amount IS NULL OR price_amount >= 0),
    CONSTRAINT shoe_offers_list_price CHECK (list_price_amount IS NULL OR list_price_amount >= 0),
    CONSTRAINT shoe_offers_condition CHECK (condition IS NULL OR condition IN ('new', 'used', 'deadstock')),
    CONSTRAINT shoe_offers_url CHECK (url ~ '^https?://')
);
CREATE INDEX shoe_offers_model ON shoe_offers (model_id, active);
CREATE INDEX shoe_offers_store ON shoe_offers (store_domain);
CREATE INDEX shoe_offers_checked ON shoe_offers (checked_at DESC);
CREATE INDEX shoe_offers_size ON shoe_offers (model_id, size) WHERE size IS NOT NULL;

-- The price history: one snapshot per offer per day (the first check of that day wins).
CREATE TABLE shoe_snapshots (
    id           text COLLATE "C" PRIMARY KEY,               -- shs_ + 26 Crockford base32 characters (ULID)
    offer_id     text COLLATE "C" NOT NULL REFERENCES shoe_offers (id) ON DELETE CASCADE,
    model_id     text COLLATE "C" NOT NULL REFERENCES shoe_models (id) ON DELETE CASCADE,
    price_amount numeric(10,2),
    shipping_amount numeric(10,2),                          -- the shipping the offer stated that day (null: not stated)
    checked_at   timestamptz NOT NULL,
    day          date NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT shoe_snapshots_id CHECK (id ~ '^shs_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT shoe_snapshots_unique UNIQUE (offer_id, day)
);
CREATE INDEX shoe_snapshots_model_day ON shoe_snapshots (model_id, day DESC);

-- A drop: an official release date, with the page it was read from and the time it was read.
CREATE TABLE shoe_drops (
    id           text COLLATE "C" PRIMARY KEY,               -- shd_ + 26 Crockford base32 characters (ULID)
    slug         text COLLATE "C" NOT NULL UNIQUE,
    brand        text COLLATE "C" NOT NULL,
    model        text COLLATE "C" NOT NULL,
    colourway    text COLLATE "C",
    release_at   timestamptz NOT NULL,
    price_amount numeric(10,2),
    currency     text COLLATE "C" NOT NULL DEFAULT 'USD',
    sizes        jsonb NOT NULL DEFAULT '[]'::jsonb,        -- the size grid the source published
    source_name  text COLLATE "C" NOT NULL,                 -- who published the release date
    source_url   text NOT NULL,                             -- the release page itself
    source_key   text COLLATE "C" NOT NULL,                 -- that source's own key for the drop
    fetched_at   timestamptz NOT NULL,                      -- when we read it
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT shoe_drops_id CHECK (id ~ '^shd_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT shoe_drops_slug CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' AND length(slug) <= 80),
    CONSTRAINT shoe_drops_url CHECK (source_url ~ '^https?://'),
    CONSTRAINT shoe_drops_unique UNIQUE (source_name, source_key)
);
CREATE INDEX shoe_drops_release ON shoe_drops (release_at);

-- A person's watches: a price watch (this model, this size, below this price) or a pasted listing link.
-- The watch itself lives in OpenVibe.Watch; this row is what Shoes shows and links.
CREATE TABLE shoe_watches (
    id                text COLLATE "C" PRIMARY KEY,          -- shw_ + 26 Crockford base32 characters (ULID)
    subject           text COLLATE "C" NOT NULL,             -- usr_ + 26 Crockford base32 characters
    kind              text COLLATE "C" NOT NULL,             -- price | link
    model_id          text COLLATE "C" REFERENCES shoe_models (id) ON DELETE SET NULL,
    slug              text COLLATE "C",
    size              text COLLATE "C",
    condition         text COLLATE "C",
    threshold_amount  numeric(10,2),
    currency          text COLLATE "C" NOT NULL DEFAULT 'USD',
    source_url        text,
    remote_id         text,                                 -- the watch id in OpenVibe.Watch
    status            text COLLATE "C" NOT NULL DEFAULT 'active', -- active | not_connected | failed
    note              text,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT shoe_watches_id CHECK (id ~ '^shw_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT shoe_watches_kind CHECK (kind IN ('price', 'link')),
    CONSTRAINT shoe_watches_status CHECK (status IN ('active', 'not_connected', 'failed')),
    CONSTRAINT shoe_watches_threshold CHECK (threshold_amount IS NULL OR threshold_amount > 0),
    CONSTRAINT shoe_watches_source_url CHECK (source_url IS NULL OR source_url ~ '^https?://')
);
CREATE INDEX shoe_watches_subject ON shoe_watches (subject, created_at DESC);

-- A cited open fact: a spec, a fit note, a release fact or a care note. Only ever inserted with its source;
-- a model with no rows says "not known yet" instead of guessing.
CREATE TABLE shoe_facts (
    id          text COLLATE "C" PRIMARY KEY,                -- shf_ + 26 Crockford base32 characters (ULID)
    model_id    text COLLATE "C" NOT NULL REFERENCES shoe_models (id) ON DELETE CASCADE,
    kind        text COLLATE "C" NOT NULL,                   -- specs | fit | release | care
    label       text COLLATE "C" NOT NULL,
    value       text NOT NULL,
    source_name text COLLATE "C" NOT NULL,
    source_url  text NOT NULL,
    fetched_at  timestamptz NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT shoe_facts_id CHECK (id ~ '^shf_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT shoe_facts_kind CHECK (kind IN ('specs', 'fit', 'release', 'care')),
    CONSTRAINT shoe_facts_url CHECK (source_url ~ '^https?://')
);
CREATE INDEX shoe_facts_model ON shoe_facts (model_id, kind);

-- What each job did, so a page or a person can say when a source was last read and whether it answered.
CREATE TABLE shoe_job_runs (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job         text COLLATE "C" NOT NULL,                   -- offers | drops | ebay
    source_name text COLLATE "C" NOT NULL,
    source_url  text,
    started_at  timestamptz NOT NULL,
    finished_at timestamptz,
    ok          boolean,
    counts      jsonb NOT NULL DEFAULT '{}'::jsonb,
    error       text
);
CREATE INDEX shoe_job_runs_job ON shoe_job_runs (job, started_at DESC);

-- openvibe-sdk/account-data keeps its own idempotency here (ADR-033): a redelivered export or deletion changes
-- nothing. It holds an export_id or deletion_id, the subject and the counts sent to Network; it is not a secret.
CREATE TABLE account_data_events (
    id         text PRIMARY KEY,
    kind       text NOT NULL,
    subject    text NOT NULL,
    outcome    jsonb,
    applied_at timestamptz NOT NULL DEFAULT now(),
    sent_at    timestamptz
);

-- Request telemetry (openvibe-sdk/telemetry): one row per aggregated sample, pruned after 14 days.
CREATE TABLE telemetry_samples (
    id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    at                    timestamptz NOT NULL,
    service               text NOT NULL,
    project               text,
    subject               text,
    resource              text,
    provider              text,
    node                  text,
    cell                  text,
    region                text,
    operation             text NOT NULL,
    latency_ms            double precision,
    queue_delay_ms        double precision,
    ttfb_ms               double precision,
    throughput_per_second double precision,
    bytes                 bigint,
    status                text,
    cache_status          text,
    cost_estimate         double precision,
    route_epoch           bigint,
    trace_id              text,
    extra                 jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX telemetry_samples_at_idx ON telemetry_samples (at);
CREATE INDEX telemetry_samples_service_idx ON telemetry_samples (service, operation, at);
