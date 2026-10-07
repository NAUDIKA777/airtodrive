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
