import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";

export interface EventSubscription {
  remove(): void;
}

// Android-only native module (modules/usb-screen-capture/android). It records
// the screen via MediaProjection in a foreground service and writes the MP4
// straight into a content:// document on the USB drive.

export type CaptureAudioSource = "pending" | "app" | "microphone" | "none";

export interface CaptureStateEvent {
  state: "started" | "audio" | "finished" | "error";
  uri?: string | null;
  audioSource?: CaptureAudioSource;
  playable?: boolean;
  message?: string | null;
}

export interface CaptureStatus {
  running: boolean;
  uri: string | null;
  audioSource: CaptureAudioSource;
}

interface NativeUsbScreenCapture {
  isRunning(): boolean;
  getStatus(): CaptureStatus;
  isFacebookInstalled(): boolean;
  start(outputUri: string, appAudio: boolean): Promise<void>;
  stop(): Promise<boolean>;
  openFacebook(): Promise<"app" | "web">;
  addListener(event: "onCaptureState", listener: (e: CaptureStateEvent) => void): EventSubscription;
}

const Native: NativeUsbScreenCapture | null =
  Platform.OS === "android" ? requireOptionalNativeModule<NativeUsbScreenCapture>("UsbScreenCapture") : null;

/** False in Expo Go / web / iOS — the feature needs the native Android build. */
export const isScreenCaptureAvailable = Native != null;

export function getCaptureStatus(): CaptureStatus {
  return Native?.getStatus() ?? { running: false, uri: null, audioSource: "none" };
}

export function isFacebookInstalled(): boolean {
  return Native?.isFacebookInstalled() ?? false;
}

/** Shows Android's screen-recording consent, then resolves once recording has started. */
export async function startScreenCapture(outputUri: string, opts: { appAudio: boolean }): Promise<void> {
  if (!Native) throw new Error("Screen recording needs the Android app build");
  await Native.start(outputUri, opts.appAudio);
}

export async function stopScreenCapture(): Promise<boolean> {
  return Native ? Native.stop() : false;
}

export async function openFacebook(): Promise<"app" | "web"> {
  if (!Native) throw new Error("Unavailable");
  return Native.openFacebook();
}

export function addCaptureListener(listener: (e: CaptureStateEvent) => void): EventSubscription | null {
  return Native?.addListener("onCaptureState", listener) ?? null;
}
