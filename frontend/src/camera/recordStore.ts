import { useSyncExternalStore } from "react";

// Tiny global store so the floating record overlay can reflect the recorder's
// state from ANY screen (recording in progress, or a capture still streaming to
// the USB drive after the user navigated away).
export interface RecordState {
  recording: boolean;
  streaming: boolean;
}

let state: RecordState = { recording: false, streaming: false };
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export const recordStore = {
  get(): RecordState {
    return state;
  },
  setRecording(recording: boolean) {
    if (state.recording === recording) return;
    state = { ...state, recording };
    emit();
  },
  setStreaming(streaming: boolean) {
    if (state.streaming === streaming) return;
    state = { ...state, streaming };
    emit();
  },
  reset() {
    if (!state.recording && !state.streaming) return;
    state = { recording: false, streaming: false };
    emit();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useRecordState(): RecordState {
  return useSyncExternalStore(recordStore.subscribe, recordStore.get, recordStore.get);
}
