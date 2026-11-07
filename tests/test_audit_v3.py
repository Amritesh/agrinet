"""Offline audit regressions. Binary fixtures are test data, not observed prices."""
import importlib.util
import struct
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / 'pipeline' / 'audit_v3.py'


def load_audit():
    assert SCRIPT.exists(), 'Read-only audit implementation is missing'
    spec = importlib.util.spec_from_file_location('audit_v3', SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_snapshot_counts_dates_and_32_bit_price(tmp_path):
    path = tmp_path / '2026.bin'
    path.write_bytes(struct.pack('<IIIIHI', 0x41475232, 1, 9240, 1, 7, 71000))
    result = load_audit().inspect_binary(path, 'snapshot')
    assert result == {'rows': 1, 'min_day': 9240, 'max_day': 9240, 'commodities': []}


@pytest.mark.parametrize('payload', [b'', struct.pack('<II', 123, 0),
    struct.pack('<IIII', 0x41475232, 1, 1, 1),
    struct.pack('<II', 0x41475232, 0) + b'x'])
def test_snapshot_rejects_invalid_framing(tmp_path, payload):
    path = tmp_path / 'bad.bin'
    path.write_bytes(payload)
    with pytest.raises(ValueError):
        load_audit().inspect_binary(path, 'snapshot')


def test_series_reports_commodity_and_rejects_duplicate_days(tmp_path):
    path = tmp_path / '7.bin'
    row = struct.pack('<HIIIB', 100, 10, 71000, 71000, 1)
    path.write_bytes(struct.pack('<IBBI', 0x41475333, 1, 23, 1) + row)
    assert load_audit().inspect_binary(path, 'series') == {
        'rows': 1, 'min_day': 100, 'max_day': 100, 'commodities': [23]}
    path.write_bytes(struct.pack('<IBBI', 0x41475333, 1, 23, 2) + row * 2)
    with pytest.raises(ValueError, match='unordered'):
        load_audit().inspect_binary(path, 'series')


@pytest.mark.skipif(not (SCRIPT.parents[1] / 'data/derived/price_daily.parquet').exists(),
                    reason='Retained data not restored')
def test_retained_audit_reconciles_local_files_without_modifying_them():
    root = SCRIPT.parents[1]
    paths = [*root.glob('data/**/*.parquet'), *root.glob('web/public/data/**/*.bin')]
    before = {p: (p.stat().st_size, p.stat().st_mtime_ns) for p in paths}
    result = load_audit().audit(root)
    assert result['daily']['rows'] > 0
    assert all(result['checks'].values()), result['checks']
    assert before == {p: (p.stat().st_size, p.stat().st_mtime_ns) for p in paths}

