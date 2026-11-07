-- Final public API definitions extracted verbatim from AGRINET catalog on 2026-11-07.
-- Run after 0001_core.sql. Preserve invoker security and retain superseded IDs privately.

CREATE OR REPLACE FUNCTION public.health()
 RETURNS json
 LANGUAGE sql
 STABLE
AS $function$ select json_build_object('ok',true,'markets',(select count(*) from agri.markets),'latest_price_date',(select max((select max(p.obs_date) from agri.price_daily p where p.commodity_id=c.id)) from agri.commodities c),'shocks',(select count(*) from agri.shocks where details->>'source_status' IS DISTINCT FROM 'superseded'),'news',(select count(*) from agri.news_events),'last_ingest',(select max(finished_at) from agri.ingest_runs where status='ok')); $function$;

REVOKE ALL ON FUNCTION public.health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.health() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.nearby_markets(p_market_id integer, p_commodity_id smallint, p_km double precision DEFAULT 150, p_limit integer DEFAULT 8)
 RETURNS TABLE(id integer, name text, district text, state text, lat double precision, lon double precision, distance_km double precision, latest_modal integer, latest_date date, volatility_90d real)
 LANGUAGE sql
 STABLE
AS $function$
  select m.id, m.name, m.district, m.state, m.lat, m.lon,
         extensions.st_distance(m.geom, src.geom)/1000.0 as distance_km,
         s.latest_modal, s.latest_date, s.volatility_90d
  from agri.markets src
  join agri.markets m on m.id<>src.id and m.geom is not null and extensions.st_dwithin(m.geom, src.geom, greatest(0.0, least(coalesce(p_km,150),500.0))*1000)
  join agri.market_commodity_stats s on s.market_id=m.id and s.commodity_id=p_commodity_id
  where src.id=p_market_id
  order by distance_km limit greatest(0,least(coalesce(p_limit,8),50));
$function$;

REVOKE ALL ON FUNCTION public.nearby_markets(p_market_id integer, p_commodity_id smallint, p_km double precision, p_limit integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nearby_markets(p_market_id integer, p_commodity_id smallint, p_km double precision, p_limit integer) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shock_frequency(p_commodity_id smallint)
 RETURNS TABLE(year integer, severity smallint, n bigint)
 LANGUAGE sql
 STABLE
AS $function$ select extract(year from obs_date)::integer as year,severity,count(*) as n from agri.shocks where commodity_id=p_commodity_id and details->>'source_status' IS DISTINCT FROM 'superseded' group by 1,2 order by 1,2; $function$;

REVOKE ALL ON FUNCTION public.shock_frequency(p_commodity_id smallint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shock_frequency(p_commodity_id smallint) TO anon, authenticated, service_role;

CREATE OR REPLACE VIEW public.commodities WITH (security_invoker=true) AS
 SELECT id,
    name,
    slug,
    pilot
   FROM agri.commodities;

REVOKE ALL ON public.commodities FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.commodities TO anon, authenticated;
GRANT ALL ON public.commodities TO service_role;

CREATE OR REPLACE VIEW public.coverage WITH (security_invoker=true) AS
 SELECT commodity_id,
    year,
    n_rows,
    n_markets,
    n_days,
    n_states
   FROM agri.coverage;

REVOKE ALL ON public.coverage FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.coverage TO anon, authenticated;
GRANT ALL ON public.coverage TO service_role;

CREATE OR REPLACE VIEW public.ingest_runs WITH (security_invoker=true) AS
 SELECT id,
    job,
    started_at,
    finished_at,
    status,
    rows_in,
    rows_out
   FROM agri.ingest_runs;

REVOKE ALL ON public.ingest_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ingest_runs TO anon, authenticated;
GRANT ALL ON public.ingest_runs TO service_role;

CREATE OR REPLACE VIEW public.market_commodity_stats WITH (security_invoker=true) AS
 SELECT market_id,
    commodity_id,
    first_date,
    last_date,
    n_obs,
    latest_modal,
    latest_date,
    volatility_90d
   FROM agri.market_commodity_stats
  WHERE n_obs > 0;

REVOKE ALL ON public.market_commodity_stats FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.market_commodity_stats TO anon, authenticated;
GRANT ALL ON public.market_commodity_stats TO service_role;

CREATE OR REPLACE VIEW public.markets WITH (security_invoker=true) AS
 SELECT id,
    name,
    district,
    state,
    lat,
    lon,
    geocode_source,
    geocode_confidence,
    geocoded_at
   FROM agri.markets;

REVOKE ALL ON public.markets FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.markets TO anon, authenticated;
GRANT ALL ON public.markets TO service_role;

CREATE OR REPLACE VIEW public.news_events WITH (security_invoker=true) AS
 SELECT id,
    dedupe_hash,
    title,
    url,
    source,
    published_at,
    event_date,
    event_type,
    commodity_ids,
    state,
    district,
    extensions.st_y(geom::extensions.geometry) AS lat,
    extensions.st_x(geom::extensions.geometry) AS lon,
    summary,
    evidence,
    impact_hint,
    fetched_at
   FROM agri.news_events;

REVOKE ALL ON public.news_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.news_events TO anon, authenticated;
GRANT ALL ON public.news_events TO service_role;

CREATE OR REPLACE VIEW public.news_market_links WITH (security_invoker=true) AS
 SELECT news_id,
    market_id,
    commodity_id,
    distance_km,
    association,
    shock_id
   FROM agri.news_market_links;

REVOKE ALL ON public.news_market_links FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.news_market_links TO anon, authenticated;
GRANT ALL ON public.news_market_links TO service_role;

CREATE OR REPLACE VIEW public.price_daily WITH (security_invoker=true) AS
 SELECT market_id,
    commodity_id,
    obs_date,
    min_price,
    max_price,
    modal_price,
    n_variety
   FROM agri.price_daily;

REVOKE ALL ON public.price_daily FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.price_daily TO anon, authenticated;
GRANT ALL ON public.price_daily TO service_role;

CREATE OR REPLACE VIEW public.shocks WITH (security_invoker=true) AS
 SELECT s.id,
    s.market_id,
    s.commodity_id,
    s.obs_date,
    s.method,
    s.direction,
    s.score,
    s.pct_change,
    s.baseline,
    s.observed,
    s.severity,
    s.window_start,
    s.window_end,
    s.details,
    m.name AS market_name,
    m.district,
    m.state,
    m.lat,
    m.lon
   FROM agri.shocks s
     JOIN agri.markets m ON m.id = s.market_id
  WHERE (s.details ->> 'source_status'::text) IS DISTINCT FROM 'superseded'::text;

REVOKE ALL ON public.shocks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.shocks TO anon, authenticated;
GRANT ALL ON public.shocks TO service_role;

CREATE INDEX IF NOT EXISTS shocks_current_api_idx ON agri.shocks USING btree (commodity_id, obs_date, severity) WHERE ((details ->> 'source_status'::text) IS DISTINCT FROM 'superseded'::text);

ALTER ROLE authenticator SET pgrst.db_schemas = 'public, graphql_public';
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
