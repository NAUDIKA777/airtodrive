"""Backend tests for the Air to Drive landing page / Stripe checkout endpoints.

Stripe TEST key is now configured, so:
 - /api/checkout/config  -> enabled: true, amount_display: '$14.95'
 - /api/checkout/session -> returns a real checkout_url (checkout.stripe.com) + session_id (cs_test_...)
 - /api/checkout/status  -> returns amount_display reflecting server-side price (promo-aware)
 - /api/stripe/webhook   -> 503 (no STRIPE_WEBHOOK_SECRET set)

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
    def test_config_enabled_shape(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/checkout/config")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["enabled"] is True
        assert data["product"] == "Lifetime Access"
        assert data["amount_display"] == "$14.95"
        assert data["currency"] == "USD"


# -- Checkout session (configured) -----------------------------------------
class TestCheckoutSessionConfigured:
    def test_session_no_promo_returns_real_url(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/checkout/session", json={})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["session_id"].startswith("cs_test_")
        assert data["checkout_url"].startswith("https://checkout.stripe.com/")

    def test_session_with_promo_returns_real_url(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/checkout/session", json={"promo_code": "FOUNDER"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["session_id"].startswith("cs_test_")
        assert data["checkout_url"].startswith("https://checkout.stripe.com/")


# -- Server-authoritative pricing via /api/checkout/status -----------------
@pytest.mark.parametrize("promo,expected", [
    (None, "$14.95"),
    ("FOUNDER", "$13.96"),
    ("EARLY50", "$9.98"),
    ("LAUNCH25", "$14.95"),   # 25% off $19.95 = $14.96, but capped to sale $14.95
    ("NOPE123", "$14.95"),    # bogus falls back to sale price
])
def test_server_side_pricing_amount(api_client, promo, expected):
    body = {} if promo is None else {"promo_code": promo}
    r = api_client.post(f"{BASE_URL}/api/checkout/session", json=body)
    assert r.status_code == 200, r.text
    sid = r.json()["session_id"]

    s = api_client.get(f"{BASE_URL}/api/checkout/status", params={"session_id": sid})
    assert s.status_code == 200, s.text
    data = s.json()
    assert data["amount_display"] == expected, f"promo={promo} -> {data}"
    # unpaid session, order should be pending
    assert data["order_status"] == "pending"
    assert data["paid"] is False


@pytest.fixture
def api_client_module():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# -- Checkout status validation --------------------------------------------
class TestCheckoutStatusValidation:
    def test_status_bad_id_returns_400(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/checkout/status", params={"session_id": "bad"})
        assert r.status_code == 400, r.text
        assert "Invalid session ID" in r.json().get("detail", "")

    def test_status_unknown_cs_id_returns_404(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/checkout/status",
                           params={"session_id": "cs_test_doesnotexist_xyz"})
        assert r.status_code == 404, r.text


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

    def test_status_create_and_fetch(self, api_client):
        payload = {"client_name": "TEST_landing_checkout_suite"}
        c = api_client.post(f"{BASE_URL}/api/status", json=payload)
        assert c.status_code == 200
        created = c.json()
        assert created["client_name"] == payload["client_name"]
