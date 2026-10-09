from fastapi import FastAPI, APIRouter, Request, HTTPException
from fastapi.responses import PlainTextResponse, JSONResponse
import stripe
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import re
import logging
import httpx
from urllib.parse import urljoin, urlparse, unquote
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List
import uuid
from datetime import datetime, timezone
from contextlib import asynccontextmanager


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    client.close()


app = FastAPI(lifespan=lifespan)
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
    await db.status_checks.insert_one(status_obj.model_dump())
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
# Media URL resolver.
# A pasted link is often a *webpage* (text/html) rather than a direct media
# file. Downloading it verbatim would save the raw HTML source to the USB drive
# instead of a playable video. This endpoint fetches the URL, and when it is an
# HTML page it scrapes the real media URL (og:video, <video>/<source>, JSON
# media keys, or any direct .mp4/.webm/... link) so the client streams an actual
# playable file.
# ---------------------------------------------------------------------------
BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/122.0 Safari/537.36"
    ),
    "Accept": "*/*",
}

MEDIA_EXT_MIME = {
    "mp4": ("video/mp4", "video"),
    "mov": ("video/quicktime", "video"),
    "m4v": ("video/x-m4v", "video"),
    "webm": ("video/webm", "video"),
    "mkv": ("video/x-matroska", "video"),
    "m3u8": ("application/vnd.apple.mpegurl", "video"),
    "mp3": ("audio/mpeg", "audio"),
    "m4a": ("audio/mp4", "audio"),
    "wav": ("audio/wav", "audio"),
    "aac": ("audio/aac", "audio"),
    "ogg": ("audio/ogg", "audio"),
    "flac": ("audio/flac", "audio"),
    "jpg": ("image/jpeg", "image"),
    "jpeg": ("image/jpeg", "image"),
    "png": ("image/png", "image"),
    "gif": ("image/gif", "image"),
    "webp": ("image/webp", "image"),
}

_VIDEO_EXT = r"mp4|m4v|webm|mov|mkv"
_AUDIO_EXT = r"mp3|m4a|wav|aac|ogg|flac"
_MEDIA_URL_RE = re.compile(
    rf"https?://[^\s\"'<>\\]+?\.(?:{_VIDEO_EXT}|{_AUDIO_EXT}|m3u8)(?:\?[^\s\"'<>\\]*)?",
    re.I,
)
_META_PATTERNS = [
    r'<meta[^>]+(?:property|name)=["\']og:video:secure_url["\'][^>]+content=["\']([^"\']+)["\']',
    r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\']og:video:secure_url["\']',
    r'<meta[^>]+(?:property|name)=["\']og:video:url["\'][^>]+content=["\']([^"\']+)["\']',
    r'<meta[^>]+(?:property|name)=["\']og:video["\'][^>]+content=["\']([^"\']+)["\']',
    r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\']og:video["\']',
    r'<meta[^>]+(?:property|name)=["\']twitter:player:stream["\'][^>]+content=["\']([^"\']+)["\']',
]


def _ext_of(u: str) -> str:
    path = urlparse(u).path
    m = re.search(r"\.([a-zA-Z0-9]+)$", path)
    return m.group(1).lower() if m else ""


def _name_from_url(u: str) -> str:
    path = urlparse(u).path
    base = unquote(path.rsplit("/", 1)[-1]) or "download.bin"
    return base


def _meta_for(u: str):
    return MEDIA_EXT_MIME.get(_ext_of(u), ("application/octet-stream", "document"))


def _extract_media_url(html: str, base: str):
    def abspath(u: str) -> str:
        u = u.strip().replace("&amp;", "&")
        if u.startswith("//"):
            return "https:" + u
        return urljoin(base, u)

    cands: list[str] = []
    for pat in _META_PATTERNS:
        for m in re.finditer(pat, html, re.I):
            cands.append(m.group(1))
    for m in re.finditer(r'<(?:video|source)[^>]+src=["\']([^"\']+)["\']', html, re.I):
        cands.append(m.group(1))
    for m in re.finditer(
        rf'"(?:contentUrl|file|src|url|hls|mp4|playbackUrl)"\s*:\s*"([^"]+?\.(?:{_VIDEO_EXT}|m3u8)[^"]*)"',
        html,
        re.I,
    ):
        cands.append(m.group(1))
    for m in _MEDIA_URL_RE.finditer(html):
        cands.append(m.group(0))

    seen: list[str] = []
    for u in cands:
        au = abspath(u)
        if au and au not in seen:
            seen.append(au)

    # Prefer directly-downloadable video files, then audio, then anything else.
    for u in seen:
        if re.search(rf"\.(?:{_VIDEO_EXT})(?:\?|#|$)", u, re.I):
            return u
    for u in seen:
        if re.search(rf"\.(?:{_AUDIO_EXT})(?:\?|#|$)", u, re.I):
            return u
    return seen[0] if seen else None


@api_router.get("/resolve-media")
async def resolve_media(url: str):
    url = (url or "").strip()
    if not re.match(r"^https?://", url, re.I):
        raise HTTPException(status_code=400, detail="Enter a valid http(s) link")

    # Fast path: the link already points at a media file by extension — trust it
    # and skip the network round-trip (some CDNs 403 non-browser clients).
    if _ext_of(url) in MEDIA_EXT_MIME:
        mime, kind = _meta_for(url)
        return {
            "resolved": False,
            "url": url,
            "mimeType": mime,
            "kind": kind,
            "name": _name_from_url(url),
            "source": "direct",
        }

    final_url = url
    html = ""
    try:
        async with httpx.AsyncClient(
            follow_redirects=True, timeout=15.0, headers=BROWSER_HEADERS
        ) as client_http:
            async with client_http.stream("GET", url) as resp:
                final_url = str(resp.url)
                ctype = resp.headers.get("content-type", "").split(";")[0].strip().lower()

                # Already a direct media file — hand it straight back.
                is_direct = ctype.startswith(("video/", "audio/", "image/")) or (
                    ctype in ("application/octet-stream", "binary/octet-stream")
                    and _ext_of(final_url) in MEDIA_EXT_MIME
                )
                if is_direct:
                    mime, kind = _meta_for(final_url)
                    if ctype.startswith("video/"):
                        mime, kind = ctype, "video"
                    elif ctype.startswith("audio/"):
                        mime, kind = ctype, "audio"
                    elif ctype.startswith("image/"):
                        mime, kind = ctype, "image"
                    return {
                        "resolved": False,
                        "url": final_url,
                        "mimeType": mime,
                        "kind": kind,
                        "name": _name_from_url(final_url),
                        "source": "direct",
                    }

                # Otherwise read a bounded chunk of the page and scrape it.
                chunks, total = [], 0
                async for chunk in resp.aiter_bytes():
                    chunks.append(chunk)
                    total += len(chunk)
                    if total > 3_000_000:  # cap ~3MB of HTML
                        break
                html = b"".join(chunks).decode("utf-8", errors="ignore")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not reach that link ({e})")

    media_url = _extract_media_url(html, final_url)
    if not media_url:
        raise HTTPException(
            status_code=422,
            detail="No playable video was found on that page — paste a direct media link.",
        )
    mime, kind = _meta_for(media_url)
    return {
        "resolved": True,
        "url": media_url,
        "mimeType": mime,
        "kind": kind,
        "name": _name_from_url(media_url),
        "source": "html",
    }


# ---------------------------------------------------------------------------
# Stripe one-time payment ("Air to Drive — Lifetime Access").
# Price is computed server-side; the client only sends an optional promo code.
# ---------------------------------------------------------------------------
PRODUCT_NAME = "Air to Drive — Lifetime Access"
REGULAR_CENTS = 1995
SALE_CENTS = 1495  # standing launch sale
PRICE_CURRENCY = "usd"
PROMO_CODES = {"LAUNCH25": 25, "EARLY50": 50, "FOUNDER": 30}


def compute_amount(promo_code):
    """Return (cents, applied_code). A promo discounts off the regular price but
    never costs more than the standing sale price."""
    code = (promo_code or "").strip().upper()
    pct = PROMO_CODES.get(code)
    if pct:
        promo_price = int(REGULAR_CENTS * (1 - pct / 100) + 0.5)  # round half up
        return min(promo_price, SALE_CENTS), code
    return SALE_CENTS, None


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
        "amount_display": "$14.95",
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
    try:
        body = await request.json()
    except Exception:
        body = {}
    amount, applied_code = compute_amount((body or {}).get("promo_code"))
    metadata = {"product": "lifetime_access"}
    if applied_code:
        metadata["promo_code"] = applied_code
    line_item = {
        "price_data": {
            "currency": PRICE_CURRENCY,
            "unit_amount": amount,
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
            metadata=metadata,
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
        try:
            verified = stripe.checkout.Session.retrieve(event["data"]["object"]["id"])
        except stripe.error.StripeError:
            # Let Stripe retry; our upsert is idempotent on session_id.
            raise HTTPException(status_code=502, detail="Could not verify session")
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
    allow_credentials=False,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)
