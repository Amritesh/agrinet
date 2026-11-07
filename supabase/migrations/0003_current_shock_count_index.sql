-- Public shocks joins market metadata. Include the join key in a compact
-- current-only index so exact counts avoid decoding every JSON details row.
CREATE INDEX IF NOT EXISTS shocks_current_market_idx
ON agri.shocks (market_id)
WHERE (details->>'source_status') IS DISTINCT FROM 'superseded';
