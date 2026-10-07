# USB DirectFlow — PRD

## Original Problem Statement
Build an Android app with a clean UI featuring a toggle switch to select between two data
sources: direct internet download and local phone media (photos, videos, audio). The app must
stream incoming data directly to an attached external USB drive without saving full files to the
device's internal storage. Include a media preview screen with a timeline scrubber slider that
reads the USB drive, letting the user scrub to any timestamp and stream back a small temporary
chunk for on-screen playback. Use Android Storage Access Framework (SAF) for the core pipeline.
Add on-the-fly streaming compression for text/documents/data files while media passes through
uncompressed; enable on-the-fly decompression when reading from the drive.

## User Choices
- Toggle between BOTH modes (internet download + local phone media)
- Preview supports ALL media types (video, audio, image) + documents
- No transfer history — local-only, simple
- Dark / techy "utility tool" look
- Android; user understands USB features need a real native build (not Expo Go / web)

## Architecture
- **Frontend**: Expo Router (SDK 57), dark single-theme utility UI. Bottom tabs: Transfer /
  Browse / About. Stack route `preview/[id]` for media preview.
- **Native storage**: `expo-file-system` modern API — `Directory.pickDirectoryAsync()` (SAF USB
  picker), `File.downloadFileAsync(url, dest, {onProgress, signal})` streams internet downloads
  directly into the USB file, `readableStream()/writableStream()` stream-copy local media, `pako`
  gzip for compressible text/data. On web / Expo Go (no SAF) a **simulated drive** backs the full
  UX so it is testable; real SAF runs in a native build.
- **Playback**: `expo-video` (ExoPlayer) + `expo-audio` seek natively from the drive uri (scrub =
  buffer a small chunk, no full extraction); `expo-image` for images; gzip docs decompressed in
  memory for text preview.
- **Backend**: FastAPI + Mongo (status check retained). Adds `GET /api/samples` and
  `/api/sample-file/*` to power Internet-download mode and compression demos. No history/persistence.
- **State**: `@tanstack/react-query` for drive status / files / usage / samples. Local metadata
  index in AsyncStorage via `@/src/utils/storage`.

## User Personas
- Power user / technician who offloads downloads and phone media directly onto a USB drive in the
  field without filling up phone storage.

## Core Requirements (static)
- Source toggle (internet vs local media)
- Direct-to-USB streaming via SAF, no full internal cache
- On-the-fly gzip compression for text/data; media passthrough
- USB file browser with usage stats + delete
- Media preview with timeline scrubber for video/audio; image + doc viewers
- Dark utility aesthetic

## Implemented (2026-06)
- Transfer Dashboard: connect/eject drive, source segmented toggle, URL input + sample chips,
  phone-media pickers (photos/videos + audio/files) with runtime permission handling, compression
  switch, live terminal stream console (phase/written/total/speed + progress), sticky START/CANCEL.
- SAF transfer engine with real native streaming + web/Expo-Go simulation fallback + cancellation.
- Browse: usage bar, dense file list with type icons/thumbnails + GZIP badges, pull-to-refresh, delete.
- Media Preview: video + audio scrubber (timeline slider, play/pause, timestamps), image viewer,
  gzip-decompressed document text preview.
- About screen explaining pipeline + native-build caveat.
- Backend sample sources + sample files. Full backend + frontend testing passed (iteration_1).

## Implemented — PWA Landing Page + Stripe (2026-06)
- **Web homepage is now the "Air to Drive" marketing PWA landing page** (`app/index.tsx`:
  web → `LandingPage`, native → the USB app). Dark techy theme, glowing cyan/blue emblem
  (`BrandEmblem`: satellite → phone → USB data-stream).
- Sections: sticky nav (Install + Get Lifetime), hero (exact headline + subheadline + CTAs +
  trust row), 3 feature callouts (Video Creators / Mobile Professionals / Amateur Astronomers),
  Lifetime Access pricing card ($19.95 one-time, 5 bullets), footer.
- **Automatic PWA install prompt** on arrival (`usePwaInstall` captures `beforeinstallprompt`);
  Install / Maybe-later with persisted dismissal. Web manifest fields added to `app.json` (name,
  standalone, theme/background colors).
- **Stripe one-time Checkout** ($19.95) per integration playbook: `POST /api/checkout/session`
  (server-side fixed price_data, no client amount), `GET /api/checkout/status` (poll + verify),
  `POST /api/stripe/webhook`, `GET /api/checkout/config`. Orders stored in Mongo. `app/success.tsx`
  verifies payment on return. Stripe keys NOT yet provided → endpoints return 503 and the buy
  button shows an info toast (graceful). Tested: iteration_2 (10/10 backend + all frontend flows).

## Pending config (needs user)
- Add `STRIPE_SECRET_KEY` (and optionally `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`) to
  `backend/.env` to activate live checkout.
- PWA install + live Stripe only fully work once deployed to the custom domain (HTTPS).
- Optional: real "Air to Drive" logo image (Drive link was not public) to replace `BrandEmblem`.

## Backlog
- P1: Multi-file / batch queue of transfers.
- P1: Resume / pause of in-flight downloads (DownloadTask pause-state).
- P2: Folder navigation inside the USB drive (subdirectories).
- P2: Verify checksum (CRC) after transfer.
- P2: Per-file-type compression level / toggle.

## Next Tasks
- Gather feedback after first native Android build (real USB) test.
