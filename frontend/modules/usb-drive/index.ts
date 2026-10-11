import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";

// Result of a SAF access check on the stored USB folder.
export type UsbAccessStatus = "ok" | "no_permission" | "read_only" | "unmounted";

export interface UsbAccessInfo {
  uri: string;
  status: UsbAccessStatus;
  canRead: boolean;
  canWrite: boolean;
  isInternal: boolean; // user picked a folder on the phone's own storage
  isRemovable: boolean; // folder lives on a mounted removable volume (USB / SD)
  label: string; // volume label, e.g. "SanDisk USB drive"
  folder: string | null; // sub-folder inside the volume, null = drive root
}

export interface RemovableVolume {
  uuid: string | null;
  label: string;
}

interface UsbDriveNative {
  listRemovableVolumes(): RemovableVolume[];
  pickFolderAsync(): Promise<UsbAccessInfo>;
  checkAccess(uri: string): UsbAccessInfo;
  releaseAccess(uri: string): void;
  addListener(event: "onVolumeChange", cb: (e: { action: string }) => void): { remove(): void };
}

// Absent on web, iOS, Expo Go — callers fall back gracefully.
const native: UsbDriveNative | null =
  Platform.OS === "android" ? requireOptionalNativeModule<UsbDriveNative>("UsbDrive") : null;

export const UsbDrive = {
  isAvailable: native != null,

  listRemovableVolumes(): RemovableVolume[] {
    return native?.listRemovableVolumes() ?? [];
  },

  /** Opens the system folder picker on the USB drive and persists R/W access. */
  pickFolder(): Promise<UsbAccessInfo> {
    if (!native) return Promise.reject(new Error("UsbDrive native module unavailable"));
    return native.pickFolderAsync();
  },

  checkAccess(uri: string): UsbAccessInfo | null {
    if (!native) return null;
    try {
      return native.checkAccess(uri);
    } catch {
      return null;
    }
  },

  releaseAccess(uri: string): void {
    try {
      native?.releaseAccess(uri);
    } catch {
      // best-effort
    }
  },

  /** Subscribe to USB/SD mount + unmount events. Returns an unsubscribe fn. */
  onVolumeChange(cb: () => void): () => void {
    if (!native) return () => {};
    const sub = native.addListener("onVolumeChange", () => cb());
    return () => sub.remove();
  },
};
