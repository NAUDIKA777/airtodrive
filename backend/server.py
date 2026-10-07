from fastapi import FastAPI, APIRouter, Request, HTTPException
from fastapi.responses import PlainTextResponse, JSONResponse
import stripe
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import json
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List
import uuid
from datetime import datetime, timezone


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")


class StatusCheck(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_name: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class StatusCheckCreate(BaseModel):
    client_name: str


@api_router.get("/")
async def root():
    return {"message": "USB DirectFlow API"}


@api_router.post("/status", response_model=StatusCheck)
async def create_status_check(input: StatusCheckCreate):
    status_obj = StatusCheck(client_name=input.client_name)
    await db.status_checks.insert_one(status_obj.dict())
    return status_obj


@api_router.get("/status", response_model=List[StatusCheck])
async def get_status_checks():
    status_checks = await db.status_checks.find().to_list(1000)
    return [StatusCheck(**status_check) for status_check in status_checks]


# ---------------------------------------------------------------------------
# Sample download sources for the "Internet Download" mode. These are small,
# publicly-hosted media files plus a couple of local text/data files served by
# this backend so compression can be demonstrated end-to-end.
# ---------------------------------------------------------------------------
SAMPLES = [
    {
        "name": "ForBiggerBlazes.mp4",
        "url": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
        "mimeType": "video/mp4",
        "kind": "video",
        "size": 2498125,
        "compressible": False,
    },
    {
        "name": "ElephantsDream.mp4",
        "url": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
        "mimeType": "video/mp4",
        "kind": "video",
        "size": 13289448,
        "compressible": False,
    },
    {
        "name": "SoundHelix-Song-1.mp3",
        "url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
        "mimeType": "audio/mpeg",
        "kind": "audio",
        "size": 8248396,
        "compressible": False,
    },
    {
        "name": "mountain-ridge.jpg",
        "url": "https://images.unsplash.com/photo-1557264337-e8a93017fe92?fm=jpg&q=80&w=1600",
        "mimeType": "image/jpeg",
        "kind": "image",
        "size": 420000,
        "compressible": False,
    },
    {
        "name": "transfer-report.txt",
        "path": "/api/sample-file/transfer-report.txt",
        "mimeType": "text/plain",
        "kind": "document",
        "size": 3200,
        "compressible": True,
    },
    {
        "name": "telemetry.json",
        "path": "/api/sample-file/telemetry.json",
        "mimeType": "application/json",
        "kind": "document",
        "size": 5400,
        "compressible": True,
    },
]


@api_router.get("/samples")
async def get_samples():
    return SAMPLES


@api_router.get("/sample-file/transfer-report.txt", response_class=PlainTextResponse)
async def sample_report():
    lines = ["USB DIRECTFLOW — STREAM TRANSFER REPORT", "=" * 42, ""]
    for i in range(1, 61):
        lines.append(
            f"[{i:03d}] block=0x{i*4096:08x}  crc=OK  bytes={i*1024}  route=SAF->USB  compressed=gzip"
        )
    lines.append("")
    lines.append("End of report. All blocks streamed without internal caching.")
    return "\n".join(lines)


@api_router.get("/sample-file/telemetry.json")
async def sample_telemetry():
    payload = {
        "device": "usb-directflow",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "pipeline": "SAF -> USB (no internal cache)",
        "samples": [
            {"t": i, "throughput_mb_s": round(8 + (i % 7) * 1.37, 2), "buffer_kb": 256, "crc": "ok"}
            for i in range(120)
        ],
    }
    return JSONResponse(content=payload)


# ---------------------------------------------------------------------------
# Stripe one-time payment ("Air to Drive — Lifetime Access", $19.95 USD).
# The amount/price is fixed server-side; the client never sends a price.
# ---------------------------------------------------------------------------
PRODUCT_NAME = "Air to Drive — Lifetime Access"
PRICE_CENTS = 1995
PRICE_CURRENCY = "usd"


def _stripe_key() -> str:
    key = os.environ.get("STRIPE_SECRET_KEY", "") or ""
    return key if key.startswith("sk_") else ""


def _stripe_ready() -> bool:
    if not _stripe_key():
        return False
    stripe.api_key = _stripe_key()
    return True


async def _record_session(session) -> dict:
    values = {
        "session_id": session.id,
        "payment_status": session.payment_status,
        "checkout_status": session.status,
        "amount_total": session.amount_total,
        "currency": session.currency,
        "order_status": "paid" if session.payment_status == "paid" else "pending",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.orders.update_one(
        {"session_id": session.id},
        {
            "$set": values,
            "$setOnInsert": {
                "created_at": datetime.now(timezone.utc).isoformat(),
                "product": "lifetime_access",
            },
        },
        upsert=True,
    )
    return values


@api_router.get("/checkout/config")
async def checkout_config():
    return {
        "enabled": bool(_stripe_key()),
        "product": "Lifetime Access",
        "amount_display": "$19.95",
        "currency": PRICE_CURRENCY.upper(),
    }


@api_router.post("/checkout/session")
async def create_checkout_session(request: Request):
    if not _stripe_ready():
        raise HTTPException(
            status_code=503,
            detail="Stripe is not configured yet. Add STRIPE_SECRET_KEY to backend/.env.",
        )
    origin = request.headers.get("origin") or str(request.base_url).rstrip("/")
    price_id = os.environ.get("STRIPE_PRICE_ID", "") or ""
    if price_id.startswith("price_"):
        line_item = {"price": price_id, "quantity": 1}
    else:
        line_item = {
            "price_data": {
                "currency": PRICE_CURRENCY,
                "unit_amount": PRICE_CENTS,
                "product_data": {"name": PRODUCT_NAME},
            },
            "quantity": 1,
        }
    try:
        session = stripe.checkout.Session.create(
            mode="payment",
            line_items=[line_item],
            success_url=f"{origin}/success?session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url=f"{origin}/?checkout=cancelled",
            metadata={"product": "lifetime_access"},
        )
    except stripe.error.StripeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    await db.orders.update_one(
        {"session_id": session.id},
        {
            "$set": {
                "session_id": session.id,
                "product": "lifetime_access",
                "order_status": "pending",
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
            "$setOnInsert": {"created_at": datetime.now(timezone.utc).isoformat()},
        },
        upsert=True,
    )
    return {"checkout_url": session.url, "session_id": session.id}


@api_router.get("/checkout/status")
async def checkout_status(session_id: str):
    if not session_id.startswith("cs_"):
        raise HTTPException(status_code=400, detail="Invalid session ID")
    if not _stripe_ready():
        raise HTTPException(status_code=503, detail="Stripe is not configured.")
    try:
        session = stripe.checkout.Session.retrieve(session_id)
    except stripe.error.StripeError:
        raise HTTPException(status_code=404, detail="Checkout session not found")
    values = await _record_session(session)
    return {
        "session_id": session.id,
        "paid": session.payment_status == "paid",
        "payment_status": values["payment_status"],
        "order_status": values["order_status"],
        "amount_display": f"${(session.amount_total or 0) / 100:.2f}",
    }


@api_router.post("/stripe/webhook")
async def stripe_webhook(request: Request):
    secret = os.environ.get("STRIPE_WEBHOOK_SECRET", "") or ""
    payload = await request.body()
    signature = request.headers.get("stripe-signature")
    if not secret or not _stripe_ready():
        raise HTTPException(status_code=503, detail="Webhook not configured.")
    try:
        event = stripe.Webhook.construct_event(payload, signature, secret)
    except (ValueError, stripe.error.SignatureVerificationError):
        raise HTTPException(status_code=400, detail="Invalid webhook")
    etype = event["type"]
    if etype in {"checkout.session.completed", "checkout.session.async_payment_succeeded"}:
        verified = stripe.checkout.Session.retrieve(event["data"]["object"]["id"])
        await _record_session(verified)
    elif etype == "checkout.session.async_payment_failed":
        sid = event["data"]["object"]["id"]
        await db.orders.update_one(
            {"session_id": sid},
            {"$set": {"order_status": "failed", "updated_at": datetime.now(timezone.utc).isoformat()}},
        )
    return {"received": True}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
