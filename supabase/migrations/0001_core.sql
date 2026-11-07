-- AGRINET core schema (0001). Hot store for dimensions, recent prices, shocks, news.
-- Full 2001+ history lives in Parquet / static tiles (see DECISIONS.md D3).
create extension if not exists postgis with schema extensions;

create schema if not exists agri;

create table agri.commodities (
  id          smallint primary key,            -- AGMARKNET commodity code
  name        text not null unique,
  slug        text not null unique,
  pilot       boolean not null default false
);

create table agri.markets (
  id                 serial primary key,
  name               text not null,
  district           text not null,
  state              text not null,
  name_norm          text not null,
  district_norm      text not null,
  state_norm         text not null,
  lat                double precision,
  lon                double precision,
  geom               geography(Point, 4326),
  geocode_source     text,                      -- nominatim | district_centroid | manual | none
  geocode_confidence smallint check (geocode_confidence between 0 and 100),
  geocode_query      text,
  geocoded_at        timestamptz,
  unique (state_norm, district_norm, name_norm)
);
create index markets_geom_idx on agri.markets using gist (geom);
create index markets_state_idx on agri.markets (state_norm);

-- One row per market x commodity x day, aggregated across varieties/grades.
-- Prices are INR per quintal as reported by AGMARKNET (never interpolated).
create table agri.price_daily (
  market_id     integer  not null references agri.markets(id),
  commodity_id  smallint not null references agri.commodities(id),
  obs_date      date     not null,
  min_price     integer  not null,
  max_price     integer  not null,
  modal_price   integer  not null,   -- median of variety modal prices
  n_variety     smallint not null,   -- number of variety/grade rows aggregated
  primary key (commodity_id, obs_date, market_id)
);
create index price_daily_market_idx on agri.price_daily (market_id, commodity_id, obs_date);

create table agri.market_commodity_stats (
  market_id       integer  not null references agri.markets(id),
  commodity_id    smallint not null references agri.commodities(id),
  first_date      date not null,
  last_date       date not null,
  n_obs           integer not null,
  latest_modal    integer,
  latest_date     date,
  volatility_90d  real,               -- stdev of daily log returns, last 90 obs
  primary key (market_id, commodity_id)
);

create table agri.shocks (
  id             bigserial primary key,
  market_id      integer  not null references agri.markets(id),
  commodity_id   smallint not null references agri.commodities(id),
  obs_date       date     not null,
  method         text     not null,    -- return_1d | return_7d | mad_z | seasonal_dev | regional_div | sync
  direction      text     not null check (direction in ('up','down')),
  score          real     not null,    -- method-specific normalized score (z-like)
  pct_change     real,
  baseline       real,
  observed       real,
  severity       smallint not null check (severity between 1 and 4),
  window_start   date,
  window_end     date,
  details        jsonb not null default '{}'::jsonb,
  unique (market_id, commodity_id, obs_date, method)
);
create index shocks_date_idx on agri.shocks (commodity_id, obs_date desc, severity desc);
create index shocks_market_idx on agri.shocks (market_id, commodity_id, obs_date desc);

create table agri.news_events (
  id             bigserial primary key,
  dedupe_hash    text not null unique,
  title          text not null,
  url            text not null,
  source         text not null,
  published_at   timestamptz not null,
  event_date     date,
  event_type     text not null,        -- policy | weather | market | export_import | other
  commodity_ids  smallint[] not null default '{}',
  state          text,
  district       text,
  geom           geography(Point, 4326),
  summary        text,
  evidence       text,                 -- quoted snippet supporting extraction
  impact_hint    text check (impact_hint in ('up','down','mixed','none')),
  fetched_at     timestamptz not null default now()
);
create index news_pub_idx on agri.news_events (published_at desc);
create index news_geom_idx on agri.news_events using gist (geom);

-- Statistical association only; never causal.
create table agri.news_market_links (
  news_id        bigint   not null references agri.news_events(id) on delete cascade,
  market_id      integer  not null references agri.markets(id),
  commodity_id   smallint not null references agri.commodities(id),
  distance_km    real,
  association    text not null check (association in ('verified_event','statistical','speculative')),
  shock_id       bigint references agri.shocks(id) on delete set null,
  primary key (news_id, market_id, commodity_id)
);

create table agri.coverage (
  commodity_id  smallint not null references agri.commodities(id),
  year          smallint not null,
  n_rows        integer not null,
  n_markets     integer not null,
  n_days        integer not null,
  n_states      integer not null,
  primary key (commodity_id, year)
);

create table agri.ingest_runs (
  id          bigserial primary key,
  job         text not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text not null default 'running',
  rows_in     integer,
  rows_out    integer,
  details     jsonb not null default '{}'::jsonb
);

-- Read-only public access (anon) to published tables; writes only via service role.
grant usage on schema agri to anon, authenticated, service_role;
grant select on all tables in schema agri to anon, authenticated;
grant all on all tables in schema agri to service_role;
grant usage, select on all sequences in schema agri to service_role;
alter default privileges in schema agri grant select on tables to anon, authenticated;
alter default privileges in schema agri grant all on tables to service_role;

alter table agri.commodities enable row level security;
alter table agri.markets enable row level security;
alter table agri.price_daily enable row level security;
alter table agri.market_commodity_stats enable row level security;
alter table agri.shocks enable row level security;
alter table agri.news_events enable row level security;
alter table agri.news_market_links enable row level security;
alter table agri.coverage enable row level security;
alter table agri.ingest_runs enable row level security;

create policy read_all on agri.commodities for select using (true);
create policy read_all on agri.markets for select using (true);
create policy read_all on agri.price_daily for select using (true);
create policy read_all on agri.market_commodity_stats for select using (true);
create policy read_all on agri.shocks for select using (true);
create policy read_all on agri.news_events for select using (true);
create policy read_all on agri.news_market_links for select using (true);
create policy read_all on agri.coverage for select using (true);
create policy read_all on agri.ingest_runs for select using (true);
