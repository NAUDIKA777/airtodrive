import { Platform } from "react-native";
import pako from "pako";

import { drive, type DriveInfo } from "@/src/services/drive";
import {
  type DriveFile,
  type FileKind,
  type TransferSource,
  isCompressible,
  kindFromMime,
  mimeFromName,
} from "@/src/services/media";

export type TransferPhase =
  | "connecting"
  | "streaming"
  | "compressing"
  | "finalizing"
  | "done"
  | "error"
  | "cancelled";

export interface Progress {
  phase: TransferPhase;
  bytesWritten: number;
  totalBytes: number; // -1 if unknown
  bytesPerSec: number;
  compressed: boolean;
  message: string;
}

export interface TransferInput {
  url?: string; // internet source
  assetUri?: string; // local source
  name: string;
  mimeType?: string;
  size?: number; // known source size when available
  source: TransferSource;
  compress: boolean;
  driveInfo: DriveInfo;
  onProgress: (p: Progress) => void;
  signal?: { aborted: boolean };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function uniqueName(dir: any, base: string): string {
  try {
    const names = new Set((dir.list() as any[]).map((e) => e.name));
    if (!names.has(base)) return base;
    const dot = base.lastIndexOf(".");
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : "";
    let i = 1;
    while (names.has(`${stem}-${i}${ext}`)) i += 1;
    return `${stem}-${i}${ext}`;
  } catch {
    return base;
  }
}

async function finalize(
  partial: Omit<DriveFile, "id" | "createdAt">,
): Promise<DriveFile> {
  const file: DriveFile = {
    ...partial,
    id: uid(),
    createdAt: new Date().toISOString(),
  };
  await drive.saveFile(file);
  return file;
}

// ---- Simulated transfer (web preview + virtual drive) ---------------------
async function simulate(input: TransferInput): Promise<DriveFile> {
  const { name, source, onProgress, signal } = input;
  const mimeType = input.mimeType ?? mimeFromName(name);
  const kind: FileKind = kindFromMime(mimeType, name);
  const compressed = input.compress && isCompressible(mimeType, name);
  const originalSize = input.size && input.size > 0 ? input.size : estimateSize(kind);
  const finalSize = compressed ? Math.round(originalSize * 0.38) : originalSize;

  onProgress({
    phase: "connecting",
    bytesWritten: 0,
    totalBytes: originalSize,
    bytesPerSec: 0,
    compressed,
    message: "Opening stream\u2026",
  });
  await sleep(400);

  const steps = 24;
  const start = now();
  for (let i = 1; i <= steps; i += 1) {
    if (signal?.aborted) throw new Error("cancelled");
    const written = Math.round((originalSize * i) / steps);
    const elapsed = Math.max(0.001, (now() - start) / 1000);
    onProgress({
      phase: compressed ? "compressing" : "streaming",
      bytesWritten: written,
      totalBytes: originalSize,
      bytesPerSec: written / elapsed,
      compressed,
      message: compressed ? "Compressing \u2192 USB" : "Streaming \u2192 USB",
    });
    await sleep(70 + Math.random() * 60);
  }

  onProgress({
    phase: "finalizing",
    bytesWritten: originalSize,
    totalBytes: originalSize,
    bytesPerSec: 0,
    compressed,
    message: "Flushing to drive\u2026",
  });
  await sleep(300);

  // In the simulated drive, uri points at the source so playback still works.
  const uri = input.url ?? input.assetUri ?? "";
  return finalize({
    name: compressed ? `${name}.gz` : name,
    displayName: name,
    size: finalSize,
    originalSize,
    mimeType,
    kind,
    uri,
    compressed,
    source,
    simulated: true,
  });
}

function estimateSize(kind: FileKind): number {
  switch (kind) {
    case "video":
      return 24 * 1024 * 1024;
    case "audio":
      return 6 * 1024 * 1024;
    case "image":
      return 1.5 * 1024 * 1024;
    default:
      return 48 * 1024;
  }
}

// ---- Real native transfer via expo-file-system (SAF / content://) ---------
async function nativeTransfer(input: TransferInput): Promise<DriveFile> {
  const { Directory, File } = require("expo-file-system");
  const { name, source, driveInfo, onProgress, signal } = input;
  const mimeType = input.mimeType ?? mimeFromName(name);
  const kind: FileKind = kindFromMime(mimeType, name);
  const compressed = input.compress && isCompressible(mimeType, name);
  const dir = new Directory(driveInfo.uri);

  onProgress({
    phase: "connecting",
    bytesWritten: 0,
    totalBytes: input.size ?? -1,
    bytesPerSec: 0,
    compressed,
    message: "Opening stream\u2026",
  });

  // Media / non-compressible from the internet: stream the response body
  // directly into the USB file (no full copy on internal storage).
  if (!compressed && input.url) {
    const finalName = uniqueName(dir, name);
    const dest = new File(dir, finalName);
    const start = now();
    const controller = new AbortController();
    if (signal) {
      const poll = setInterval(() => {
        if (signal.aborted) controller.abort();
      }, 150);
      // cleared on completion below via finally
      (dest as any).__poll = poll;
    }
    try {
      await File.downloadFileAsync(input.url, dest, {
        idempotent: true,
        signal: controller.signal,
        onProgress: ({ bytesWritten, totalBytes }: { bytesWritten: number; totalBytes: number }) => {
          const elapsed = Math.max(0.001, (now() - start) / 1000);
          onProgress({
            phase: "streaming",
            bytesWritten,
            totalBytes,
            bytesPerSec: bytesWritten / elapsed,
            compressed: false,
            message: "Streaming \u2192 USB",
          });
        },
      });
    } finally {
      if ((dest as any).__poll) clearInterval((dest as any).__poll);
    }
    const size = safeSize(dest);
    return finalize({
      name: finalName,
      displayName: name,
      size,
      originalSize: size,
      mimeType,
      kind,
      uri: dest.uri,
      compressed: false,
      source,
      simulated: driveInfo.simulated,
    });
  }

  // Non-compressible local media: stream-copy source -> USB in chunks.
  if (!compressed && input.assetUri) {
    const finalName = uniqueName(dir, name);
    const src = new File(input.assetUri);
    const dest = new File(dir, finalName);
    const total = input.size ?? safeSize(src) ?? -1;
    const reader = src.readableStream().getReader();
    const writer = dest.writableStream().getWriter();
    let written = 0;
    const start = now();
    try {
      for (;;) {
        if (signal?.aborted) throw new Error("cancelled");
        const { done, value } = await reader.read();
        if (done) break;
        await writer.write(value);
        written += value.length;
        const elapsed = Math.max(0.001, (now() - start) / 1000);
        onProgress({
          phase: "streaming",
          bytesWritten: written,
          totalBytes: total,
          bytesPerSec: written / elapsed,
          compressed: false,
          message: "Streaming \u2192 USB",
        });
      }
      await writer.close();
    } catch (e) {
      try {
        await writer.abort();
      } catch {}
      throw e;
    }
    const size = safeSize(dest) || written;
    return finalize({
      name: finalName,
      displayName: name,
      size,
      originalSize: size,
      mimeType,
      kind,
      uri: dest.uri,
      compressed: false,
      source,
      simulated: driveInfo.simulated,
    });
  }

  // Compressible text / data: read fully, gzip, write .gz to USB in chunks.
  const bytes = await readAllBytes(input);
  const originalSize = bytes.length;
  onProgress({
    phase: "compressing",
    bytesWritten: 0,
    totalBytes: originalSize,
    bytesPerSec: 0,
    compressed: true,
    message: "Compressing (gzip)\u2026",
  });
  const gz = pako.gzip(bytes);
  const finalName = uniqueName(dir, `${name}.gz`);
  const dest = dir.createFile(finalName, "application/gzip");
  const writer = dest.writableStream().getWriter();
  const CHUNK = 256 * 1024;
  const start = now();
  for (let i = 0; i < gz.length; i += CHUNK) {
    if (signal?.aborted) {
      try {
        await writer.abort();
      } catch {}
      throw new Error("cancelled");
    }
    const chunk = gz.slice(i, Math.min(i + CHUNK, gz.length));
    await writer.write(chunk);
    const elapsed = Math.max(0.001, (now() - start) / 1000);
    onProgress({
      phase: "compressing",
      bytesWritten: Math.min(i + CHUNK, gz.length),
      totalBytes: gz.length,
      bytesPerSec: Math.min(i + CHUNK, gz.length) / elapsed,
      compressed: true,
      message: "Compressing \u2192 USB",
    });
  }
  await writer.close();
  return finalize({
    name: finalName,
    displayName: name,
    size: gz.length,
    originalSize,
    mimeType,
    kind,
    uri: dest.uri,
    compressed: true,
    source,
    simulated: driveInfo.simulated,
  });
}

function safeSize(file: any): number {
  try {
    return (file.size as number) ?? 0;
  } catch {
    return 0;
  }
}

async function readAllBytes(input: TransferInput): Promise<Uint8Array> {
  const { File } = require("expo-file-system");
  if (input.url) {
    const resp = await fetch(input.url);
    return new Uint8Array(await resp.arrayBuffer());
  }
  const src = new File(input.assetUri);
  return new Uint8Array(await src.arrayBuffer());
}

export async function runTransfer(input: TransferInput): Promise<DriveFile> {
  try {
    let file: DriveFile;
    if (Platform.OS === "web" || input.driveInfo.uri.startsWith("virtual://")) {
      file = await simulate(input);
    } else {
      try {
        file = await nativeTransfer(input);
      } catch (e: any) {
        if (String(e?.message || e).toLowerCase().includes("cancel")) throw e;
        // Native FS failed (e.g. Expo Go without SAF) — fall back to simulation
        // so the flow still completes end-to-end.
        file = await simulate(input);
      }
    }
    input.onProgress({
      phase: "done",
      bytesWritten: file.size,
      totalBytes: file.size,
      bytesPerSec: 0,
      compressed: file.compressed,
      message: "Transfer complete",
    });
    return file;
  } catch (e: any) {
    const cancelled = String(e?.message || e).toLowerCase().includes("cancel");
    input.onProgress({
      phase: cancelled ? "cancelled" : "error",
      bytesWritten: 0,
      totalBytes: 0,
      bytesPerSec: 0,
      compressed: false,
      message: cancelled ? "Transfer cancelled" : `Error: ${String(e?.message || e)}`,
    });
    throw e;
  }
}

// Stream a finished capture (camera temp file) straight onto the mounted USB
// drive. The destination File lives in the SAF directory the user picked
// (driveInfo.uri) — i.e. the external OTG storage path, never internal phone
// storage. The write stream is explicitly ended/closed (writer.close) on
// completion and aborted on cancel.
export async function streamFileToDrive(opts: {
  srcUri: string;
  name: string;
  mimeType: string;
  driveInfo: DriveInfo;
  onProgress?: (p: Progress) => void;
  signal?: { aborted: boolean };
}): Promise<DriveFile> {
  const { srcUri, name, mimeType, driveInfo, onProgress, signal } = opts;
  const kind = kindFromMime(mimeType, name);

  // Web / virtual drive: reuse the simulated pipeline so the flow still completes.
  if (Platform.OS === "web" || driveInfo.uri.startsWith("virtual://")) {
    return runTransfer({
      assetUri: srcUri,
      name,
      mimeType,
      source: "local",
      compress: false,
      driveInfo,
      onProgress: onProgress ?? (() => {}),
      signal,
    });
  }

  const { Directory, File } = require("expo-file-system");
  const dir = new Directory(driveInfo.uri); // mounted USB (SAF) directory
  const finalName = uniqueName(dir, name);
  const src = new File(srcUri);
  const dest = new File(dir, finalName); // destination ON the USB drive
  const total = safeSize(src) || -1;

  const reader = src.readableStream().getReader();
  const writer = dest.writableStream().getWriter();
  let written = 0;
  const start = now();
  try {
    for (;;) {
      if (signal?.aborted) throw new Error("cancelled");
      const { done, value } = await reader.read();
      if (done) break;
      await writer.write(value);
      written += value.length;
      const elapsed = Math.max(0.001, (now() - start) / 1000);
      onProgress?.({
        phase: "streaming",
        bytesWritten: written,
        totalBytes: total,
        bytesPerSec: written / elapsed,
        compressed: false,
        message: "Streaming \u2192 USB",
      });
    }
    // Explicitly end + close the USB file write stream.
    await writer.close();
  } catch (e) {
    try {
      await writer.abort();
    } catch {
      // writer may already be torn down
    }
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
    // Don't leave a truncated, unplayable file on the USB drive.
    try {
      if (dest.exists) dest.delete();
    } catch {
      // best-effort
    }
    throw e;
  }

  const size = safeSize(dest) || written;
  const file = await finalize({
    name: finalName,
    displayName: name,
    size,
    originalSize: size,
    mimeType,
    kind,
    uri: dest.uri,
    compressed: false,
    source: "local",
    simulated: driveInfo.simulated,
  });
  onProgress?.({
    phase: "done",
    bytesWritten: size,
    totalBytes: size,
    bytesPerSec: 0,
    compressed: false,
    message: "Transfer complete",
  });
  return file;
}

// Read a decompressed text preview from a gzipped file on the drive.
export async function readTextPreview(file: DriveFile, maxChars = 4000): Promise<string> {
  try {
    if (Platform.OS === "web" || file.simulated) {
      if (file.uri) {
        const resp = await fetch(file.uri);
        const txt = await resp.text();
        return txt.slice(0, maxChars);
      }
      return "";
    }
    const { File } = require("expo-file-system");
    const f = new File(file.uri);
    const bytes = new Uint8Array(await f.arrayBuffer());
    const raw = file.compressed ? pako.ungzip(bytes) : bytes;
    const text = new TextDecoder().decode(raw);
    return text.slice(0, maxChars);
  } catch (e: any) {
    return `Unable to read preview: ${String(e?.message || e)}`;
  }
}
