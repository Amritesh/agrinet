"""Read-only real public API regression: superseded retained rows are not current."""
from pathlib import Path
import json
import httpx
import pytest
from dotenv import dotenv_values


def test_public_api_excludes_superseded_shocks():
    root = Path(__file__).resolve().parents[1]
    cfg = dotenv_values(root / "web/.env")
    if not cfg.get("VITE_SUPABASE_URL"):
        pytest.skip("public API config absent")
    expected = json.loads((root / "data/derived/shock_summary.json").read_text())["shocks"]
    with httpx.Client(base_url=cfg["VITE_SUPABASE_URL"], headers={"apikey": cfg["VITE_SUPABASE_KEY"]}, timeout=30) as client:
        response = client.get("/rest/v1/shocks", params={"select":"id", "limit":1}, headers={"Prefer":"count=exact"})
        response.raise_for_status()
        assert int(response.headers["content-range"].split("/")[-1]) == expected
        response = client.post("/rest/v1/rpc/health", json={})
        response.raise_for_status()
        assert response.json()["shocks"] == expected
