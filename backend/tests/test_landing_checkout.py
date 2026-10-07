"""Backend tests for the Air to Drive landing page / Stripe checkout endpoints.

Stripe is intentionally NOT configured in this iteration, so:
 - /api/checkout/config  -> enabled: false
 - /api/checkout/session -> 503
 - /api/checkout/status  -> 400 for bad id, 503 for cs_-prefixed id
 - /api/stripe/webhook   -> 503

Also re-verifies existing endpoints still work.
"""
import os
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")


@pytest.fixture
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# -- Checkout config --------------------------------------------------------
class TestCheckoutConfig:
    def test_config_disabled_shape(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/checkout/config")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["enabled"] is False
        assert data["product"] == "Lifetime Access"
        assert data["amount_display"] == "$19.95"
        assert data["currency"] == "USD"


# -- Checkout session (unconfigured) ---------------------------------------
class TestCheckoutSessionUnconfigured:
    def test_session_returns_503(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/checkout/session", json={})
        assert r.status_code == 503, r.text
        detail = r.json().get("detail", "")
        assert "Stripe" in detail and "not configured" in detail


# -- Checkout status --------------------------------------------------------
class TestCheckoutStatus:
    def test_status_bad_id_returns_400(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/checkout/status", params={"session_id": "bad"})
        assert r.status_code == 400, r.text
        assert "Invalid session ID" in r.json().get("detail", "")

    def test_status_cs_prefixed_returns_503_when_unconfigured(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/checkout/status", params={"session_id": "cs_test_abc"})
        assert r.status_code == 503, r.text
        assert "not configured" in r.json().get("detail", "").lower()


# -- Stripe webhook ---------------------------------------------------------
class TestStripeWebhook:
    def test_webhook_returns_503_without_secret(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/stripe/webhook", data=b"{}",
                            headers={"stripe-signature": "t=0,v1=fake"})
        assert r.status_code == 503, r.text


# -- Existing endpoints still working --------------------------------------
class TestExistingEndpoints:
    def test_root(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/")
        assert r.status_code == 200
        assert r.json().get("message") == "USB DirectFlow API"

    def test_samples(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/samples")
        assert r.status_code == 200
        samples = r.json()
        assert isinstance(samples, list) and len(samples) >= 6
        names = [s["name"] for s in samples]
        assert "transfer-report.txt" in names
        assert "telemetry.json" in names

    def test_sample_transfer_report(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/sample-file/transfer-report.txt")
        assert r.status_code == 200
        assert "STREAM TRANSFER REPORT" in r.text

    def test_sample_telemetry(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/sample-file/telemetry.json")
        assert r.status_code == 200
        data = r.json()
        assert data["device"] == "usb-directflow"
        assert len(data["samples"]) == 120

    def test_status_create_and_fetch(self, api_client):
        payload = {"client_name": "TEST_landing_checkout_suite"}
        c = api_client.post(f"{BASE_URL}/api/status", json=payload)
        assert c.status_code == 200
        created = c.json()
        assert created["client_name"] == payload["client_name"]
        assert "id" in created and "timestamp" in created

        g = api_client.get(f"{BASE_URL}/api/status")
        assert g.status_code == 200
        ids = [row["id"] for row in g.json()]
        assert created["id"] in ids
