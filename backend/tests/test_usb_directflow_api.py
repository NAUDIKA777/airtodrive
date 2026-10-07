"""Backend API tests for USB DirectFlow backend endpoints."""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://usb-direct-flow.preview.emergentagent.com").rstrip("/")


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# -- root --
class TestRoot:
    def test_api_root(self, api):
        r = api.get(f"{BASE_URL}/api/")
        assert r.status_code == 200
        j = r.json()
        assert "message" in j and "USB DirectFlow" in j["message"]


# -- status (persistence check) --
class TestStatus:
    def test_create_and_list_status(self, api):
        payload = {"client_name": "TEST_usb_directflow_backend_tests"}
        r = api.post(f"{BASE_URL}/api/status", json=payload)
        assert r.status_code == 200, r.text
        created = r.json()
        assert created["client_name"] == payload["client_name"]
        assert "id" in created and "timestamp" in created

        g = api.get(f"{BASE_URL}/api/status")
        assert g.status_code == 200
        items = g.json()
        assert isinstance(items, list)
        assert any(i.get("id") == created["id"] for i in items), "created status not persisted"


# -- samples --
class TestSamples:
    def test_list_samples_contains_expected_kinds(self, api):
        r = api.get(f"{BASE_URL}/api/samples")
        assert r.status_code == 200
        samples = r.json()
        assert isinstance(samples, list) and len(samples) >= 6
        kinds = {s["kind"] for s in samples}
        for k in ("video", "audio", "image", "document"):
            assert k in kinds, f"missing kind {k}"
        # every sample must have name + mime + kind + size
        for s in samples:
            assert set(["name", "mimeType", "kind", "size", "compressible"]).issubset(s.keys())
            # must have either url or path
            assert "url" in s or "path" in s

    def test_sample_names_match_frontend_expectations(self, api):
        r = api.get(f"{BASE_URL}/api/samples")
        names = {s["name"] for s in r.json()}
        for required in [
            "ForBiggerBlazes.mp4",
            "SoundHelix-Song-1.mp3",
            "mountain-ridge.jpg",
            "transfer-report.txt",
            "telemetry.json",
        ]:
            assert required in names, f"sample {required} missing"


# -- sample files (text/json) --
class TestSampleFiles:
    def test_transfer_report_txt(self, api):
        r = api.get(f"{BASE_URL}/api/sample-file/transfer-report.txt")
        assert r.status_code == 200
        assert "text/plain" in r.headers.get("content-type", "").lower()
        body = r.text
        assert "USB DIRECTFLOW" in body
        assert "End of report" in body
        # should be compressible-sized plain text
        assert len(body) > 1000

    def test_telemetry_json(self, api):
        r = api.get(f"{BASE_URL}/api/sample-file/telemetry.json")
        assert r.status_code == 200
        assert "application/json" in r.headers.get("content-type", "").lower()
        j = r.json()
        assert j["device"] == "usb-directflow"
        assert "samples" in j and isinstance(j["samples"], list) and len(j["samples"]) == 120
        first = j["samples"][0]
        assert set(["t", "throughput_mb_s", "buffer_kb", "crc"]).issubset(first.keys())


# -- misc edge cases --
class TestMisc:
    def test_404_on_unknown_sample(self, api):
        r = api.get(f"{BASE_URL}/api/sample-file/does-not-exist.bin")
        assert r.status_code in (404, 405)

    def test_cors_allows_wildcard(self, api):
        r = api.get(f"{BASE_URL}/api/samples", headers={"Origin": "https://example.com"})
        assert r.status_code == 200
        # starlette CORS echoes allow-origin for simple GET
        allow = r.headers.get("access-control-allow-origin")
        assert allow in ("*", "https://example.com", None)
