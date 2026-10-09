import { useQuery } from "@tanstack/react-query";

import type { FileKind } from "@/src/services/media";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL ?? "";

export interface SampleSource {
  name: string;
  url: string;
  mimeType: string;
  kind: FileKind;
  size: number;
  compressible: boolean;
}

interface RawSample {
  name: string;
  url?: string;
  path?: string;
  mimeType: string;
  kind: FileKind;
  size: number;
  compressible: boolean;
}

export async function fetchSamples(): Promise<SampleSource[]> {
  const resp = await fetch(`${BASE}/api/samples`);
  if (!resp.ok) throw new Error(`Failed to load samples (${resp.status})`);
  const data: RawSample[] = await resp.json();
  return data.map((s) => ({
    name: s.name,
    url: s.url ?? `${BASE}${s.path}`,
    mimeType: s.mimeType,
    kind: s.kind,
    size: s.size,
    compressible: s.compressible,
  }));
}

export function useSamples() {
  return useQuery({ queryKey: ["samples"], queryFn: fetchSamples });
}

export interface ResolvedMedia {
  resolved: boolean; // true when the real media URL was scraped from a webpage
  url: string;
  mimeType: string;
  kind: FileKind;
  name: string;
  source: "direct" | "html" | string;
}

const DIRECT_MEDIA_RE =
  /\.(mp4|m4v|webm|mov|mkv|m3u8|mp3|m4a|wav|aac|ogg|flac|jpg|jpeg|png|gif|webp)(\?|#|$)/i;

export function looksDirectMedia(url: string): boolean {
  return DIRECT_MEDIA_RE.test(url);
}

// Turn a pasted link into an actual playable media URL. Webpage (HTML) links are
// scraped server-side so we never stream raw HTML source to the drive.
export async function resolveMedia(url: string): Promise<ResolvedMedia> {
  const resp = await fetch(`${BASE}/api/resolve-media?url=${encodeURIComponent(url)}`);
  if (!resp.ok) {
    let detail = `Could not resolve media (${resp.status})`;
    try {
      const j = await resp.json();
      if (j?.detail) detail = j.detail;
    } catch {
      // keep default
    }
    throw new Error(detail);
  }
  return resp.json();
}
