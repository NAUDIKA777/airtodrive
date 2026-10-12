import { useSyncExternalStore } from "react";
import { PermissionsAndroid, Platform } from "react-native";

import {
  addCaptureListener,
  getCaptureStatus,
  isScreenCaptureAvailable,
  openFacebook,
  startScreenCapture,
  stopScreenCapture,
  type CaptureAudioSource,
  type CaptureStateEvent,
} from "@/modules/usb-screen-capture";
import { queryClient } from "@/src/query-client";
import type { DriveInfo } from "@/src/services/drive";
import {
  canRecordDirect,
  createDriveFile,
  deleteDriveFile,
  registerDriveFile,
  type DriveTarget,
} from "@/src/services/transfer";

// Facebook Live -> USB screen recording controller. Lives outside React so a
// capture keeps being tracked (and its file indexed when it ends) no matter
// which screen is showing — the user is in the Facebook app most of the time.

export type LivePhase = "idle" | "starting" | "capturing" | "stopping";

export interface LiveState {
  phase: LivePhase;
  audioSource: CaptureAudioSource;
  fileName: string | null;
  startedAt: number | null;
}

export interface LiveNotice {
  kind: "success" | "error" | "info";
  message: string;
}

let state: LiveState = { phase: "idle", audioSource: "none", fileName: null, startedAt: null };
let target: DriveTarget | null = null;
let targetDrive: DriveInfo | null = null;

const listeners = new Set<() => void>();
const noticeListeners = new Set<(n: LiveNotice) => void>();

function set(patch: Partial<LiveState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

function notify(n: LiveNotice) {
  for (const l of noticeListeners) l(n);
}

function resetToIdle() {
  target = null;
  targetDrive = null;
  set({ phase: "idle", audioSource: "none", fileName: null, startedAt: null });
}

function nameFromUri(uri: string): string {
  const last = decodeURIComponent(uri).split(/[/:]/).pop();
  return last || `FBLIVE_${Date.now()}.mp4`;
}

async function onNativeEvent(e: CaptureStateEvent) {
  switch (e.state) {
    case "started":
      set({ phase: "capturing", audioSource: e.audioSource ?? state.audioSource });
      break;
    case "audio":
      if (e.audioSource) set({ audioSource: e.audioSource });
      if (e.audioSource === "microphone" && state.phase === "capturing") {
        notify({ kind: "info", message: "Facebook blocks app audio — recording the microphone instead" });
      }
      break;
    case "finished": {
      const finished = target ?? (e.uri ? { uri: e.uri, name: nameFromUri(e.uri) } : null);
      const drive = targetDrive;
      resetToIdle();
      if (!finished) break;
      if (!e.playable) {
        deleteDriveFile(finished.uri);
        notify({ kind: "error", message: "Screen recording ended before any video was captured" });
        break;
      }
      try {
        await registerDriveFile(finished, "video/mp4", drive ?? { name: "USB", uri: "", simulated: false });
        notify({ kind: "success", message: `Saved ${finished.name} to USB` });
      } catch {
        notify({ kind: "error", message: "Recorded to USB, but could not index the file" });
      }
      queryClient.invalidateQueries({ queryKey: ["files"] });
      queryClient.invalidateQueries({ queryKey: ["drive-usage"] });
      break;
    }
    case "error": {
      const failed = target;
      resetToIdle();
      if (failed) deleteDriveFile(failed.uri);
      notify({ kind: "error", message: e.message || "Screen recording failed" });
      break;
    }
  }
}

// One global native listener for the life of the app.
if (isScreenCaptureAvailable) {
  addCaptureListener((e) => {
    onNativeEvent(e);
  });
  // JS reloaded while a capture was running (e.g. dev reload): pick it back up.
  const status = getCaptureStatus();
  if (status.running && status.uri) {
    target = { uri: status.uri, name: nameFromUri(status.uri) };
    state = { phase: "capturing", audioSource: status.audioSource, fileName: target.name, startedAt: Date.now() };
  }
}

async function requestPermissions(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  const wanted = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
  // Lets the "Stop" notification show on Android 13+ (capture works without it).
  if (Platform.Version >= 33 && PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS) {
    wanted.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  }
  const result = await PermissionsAndroid.requestMultiple(wanted);
  return result[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === PermissionsAndroid.RESULTS.GRANTED;
}

export const liveCapture = {
  get: (): LiveState => state,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  onNotice(listener: (n: LiveNotice) => void) {
    noticeListeners.add(listener);
    return () => {
      noticeListeners.delete(listener);
    };
  },

  /** Ask for screen-recording consent, start recording to the USB drive, then open Facebook. */
  async start(drive: DriveInfo): Promise<void> {
    if (state.phase !== "idle") return;
    if (!isScreenCaptureAvailable) throw new Error("Screen recording needs the Android app build");
    if (!canRecordDirect(drive)) throw new Error("Connect a real USB drive (not the simulated one) first");

    set({ phase: "starting" });
    let created: DriveTarget | null = null;
    try {
      const hasMic = await requestPermissions();
      if (!hasMic) notify({ kind: "info", message: "No microphone permission — recording video without sound" });

      const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "_").slice(0, 15);
      created = createDriveFile(drive, `FBLIVE_${stamp}.mp4`, "video/mp4");
      target = created;
      targetDrive = drive;
      set({ fileName: created.name });

      // Resolves only after the foreground service is actually recording.
      await startScreenCapture(created.uri, { appAudio: true });
      set({ phase: "capturing", startedAt: Date.now() });
    } catch (e: any) {
      if (created) deleteDriveFile(created.uri);
      resetToIdle();
      throw new Error(e?.message || "Could not start screen recording");
    }

    try {
      await openFacebook();
    } catch {
      notify({ kind: "info", message: "Recording — open Facebook and tap Live to go live" });
    }
  },

  /** Stop recording; the MP4 is finalised on the drive and indexed when the service reports back. */
  async stop(): Promise<void> {
    if (state.phase !== "capturing") return;
    set({ phase: "stopping" });
    const stopped = await stopScreenCapture().catch(() => false);
    if (!stopped) resetToIdle(); // native side wasn't running
  },
};

export function useLiveCapture(): LiveState {
  return useSyncExternalStore(liveCapture.subscribe, liveCapture.get, liveCapture.get);
}
