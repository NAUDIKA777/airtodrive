import type { IconName } from "@/src/components/icon";

export type FileKind = "video" | "audio" | "image" | "document";
export type TransferSource = "internet" | "local";

export interface DriveFile {
  id: string;
  name: string; // stored name on the drive (may end with .gz)
  displayName: string; // original name shown to the user
  size: number; // bytes stored on drive (compressed size if gz)
  originalSize: number; // bytes before compression
  mimeType: string;
  kind: FileKind;
  uri: string; // playable/readable uri (content:// on device, http/blob in sim)
  compressed: boolean;
  source: TransferSource;
  simulated: boolean;
  createdAt: string;
}

const EXT_MIME: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
  webm: "video/webm",
  mkv: "video/x-matroska",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  flac: "audio/flac",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  txt: "text/plain",
  md: "text/markdown",
  json: "application/json",
  csv: "text/csv",
  xml: "application/xml",
  log: "text/plain",
  html: "text/html",
  pdf: "application/pdf",
};

export function extOf(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

export function mimeFromName(name: string): string {
  return EXT_MIME[extOf(name)] ?? "application/octet-stream";
}

export function kindFromMime(mime: string, name = ""): FileKind {
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("image/")) return "image";
  const ext = extOf(name);
  if (["mp4", "mov", "m4v", "webm", "mkv"].includes(ext)) return "video";
  if (["mp3", "wav", "m4a", "aac", "ogg", "flac"].includes(ext)) return "audio";
  if (["jpg", "jpeg", "png", "gif", "webp", "heic"].includes(ext)) return "image";
  return "document";
}

// Text / data files compress well; media passes through uncompressed so it can
// play instantly without decompression.
const COMPRESSIBLE_MIME = /^(text\/|application\/(json|xml|javascript|csv))/;
export function isCompressible(mime: string, name = ""): boolean {
  if (COMPRESSIBLE_MIME.test(mime)) return true;
  return ["txt", "md", "json", "csv", "xml", "log", "html", "js", "ts"].includes(extOf(name));
}

export function iconForKind(kind: FileKind): IconName {
  switch (kind) {
    case "video":
      return "movie-outline";
    case "audio":
      return "music-note";
    case "image":
      return "image-outline";
    default:
      return "file-document-outline";
  }
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const val = bytes / Math.pow(1024, i);
  return `${val >= 100 || i === 0 ? val.toFixed(0) : val.toFixed(1)} ${units[i]}`;
}

export function formatSpeed(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
