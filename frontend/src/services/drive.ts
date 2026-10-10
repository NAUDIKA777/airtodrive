import { Platform } from "react-native";

import { UsbDrive } from "@/modules/usb-drive";
import { driveEvents } from "@/src/services/driveEvents";
import { storage } from "@/src/utils/storage";
import type { DriveFile } from "@/src/services/media";

export interface DriveInfo {
  name: string;
  uri: string; // SAF tree URI of the USB drive root (content://...)
  simulated: boolean; // true = internal/virtual drive (preview / fallback)
  volumeId?: string; // Android storage volume id, e.g. "1A2B-3C4D"
}

const DRIVE_KEY = "usb_drive";
const INDEX_KEY = "usb_index";

// Simulated capacity so the usage bar renders nicely (real SAF free-space is
// not reliably queryable).
export const DRIVE_CAPACITY = 32 * 1024 * 1024 * 1024; // 32 GB

function isWeb() {
  return Platform.OS === "web";
}

async function getInternalVirtualDir(): Promise<string> {
  // Native fallback drive backed by the app's document dir.
  const { Directory, Paths } = require("expo-file-system");
  const dir = new Directory(Paths.document, "virtual-usb");
  try {
    if (!dir.exists) dir.create();
  } catch {
    // ignore
  }
  return dir.uri as string;
}

export const drive = {
  async getStatus(): Promise<DriveInfo | null> {
    return storage.getItem<DriveInfo | null>(DRIVE_KEY, null) as Promise<DriveInfo | null>;
  },

  async connect(): Promise<DriveInfo> {
    let info: DriveInfo;
    if (isWeb()) {
      info = { name: "SIM-USB 32G", uri: "virtual://usb", simulated: true };
    } else if (UsbDrive) {
      // Android: SAF tree picker opened on the USB drive's root. The user taps
      // "Use this folder"; the grant is persisted with takePersistableUriPermission.
      // The native side rejects internal storage and sub-folders.
      try {
        const picked = await UsbDrive.pickDriveRoot();
        info = { name: picked.name || "USB DRIVE", uri: picked.uri, simulated: false, volumeId: picked.volumeId };
      } catch (e: any) {
        if (!__DEV__ || e?.code !== "ERR_NO_DRIVE") throw e;
        // Dev builds without a drive plugged in: internal virtual drive.
        info = { name: "SIM-USB (internal)", uri: await getInternalVirtualDir(), simulated: true };
      }
    } else {
      // Expo Go / builds without the native module: development fallback only.
      if (!__DEV__) throw new Error("USB drive support is missing from this build");
      info = { name: "SIM-USB (internal)", uri: await getInternalVirtualDir(), simulated: true };
    }
    await storage.setItem(DRIVE_KEY, info as any);
    driveEvents.reset();
    return info;
  },

  async disconnect(): Promise<void> {
    const info = await this.getStatus();
    if (info && !info.simulated && UsbDrive) {
      try {
        UsbDrive.releaseAccess(info.uri);
      } catch {
        // already released
      }
    }
    await storage.removeItem(DRIVE_KEY);
    await storage.setItem(INDEX_KEY, [] as any);
  },

  // The drive was unplugged: drop the active connection but keep the persisted
  // grant and file index, so re-picking the same drive picks up where it left off.
  async markDetached(): Promise<void> {
    await storage.removeItem(DRIVE_KEY);
  },

  // True while the saved drive is still plugged in and writable by this app.
  async isAvailable(info: DriveInfo): Promise<boolean> {
    if (info.simulated || !UsbDrive) return true;
    try {
      return UsbDrive.hasAccess(info.uri) && (await UsbDrive.isAttached(info.uri));
    } catch {
      return false;
    }
  },

  async listFiles(): Promise<DriveFile[]> {
    const list = (await storage.getItem<DriveFile[]>(INDEX_KEY, [])) ?? [];
    return [...list].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },

  async getFile(id: string): Promise<DriveFile | null> {
    const list = (await storage.getItem<DriveFile[]>(INDEX_KEY, [])) ?? [];
    return list.find((f) => f.id === id) ?? null;
  },

  async saveFile(file: DriveFile): Promise<void> {
    const list = (await storage.getItem<DriveFile[]>(INDEX_KEY, [])) ?? [];
    await storage.setItem(INDEX_KEY, [...list, file] as any);
  },

  async deleteFile(id: string): Promise<void> {
    const list = (await storage.getItem<DriveFile[]>(INDEX_KEY, [])) ?? [];
    const target = list.find((f) => f.id === id);
    if (target && !target.simulated && !isWeb()) {
      try {
        if (UsbDrive) {
          await UsbDrive.deleteFile(target.uri);
        } else {
          const { File } = require("expo-file-system");
          const f = new File(target.uri);
          if (f.exists) f.delete();
        }
      } catch {
        // ignore physical-delete failures; still remove from index
      }
    }
    await storage.setItem(INDEX_KEY, list.filter((f) => f.id !== id) as any);
  },

  async usage(): Promise<{ used: number; capacity: number; count: number }> {
    const list = await this.listFiles();
    const used = list.reduce((sum, f) => sum + (f.size || 0), 0);
    return { used, capacity: DRIVE_CAPACITY, count: list.length };
  },
};
