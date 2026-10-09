import { Platform } from "react-native";

import { storage } from "@/src/utils/storage";
import type { DriveFile } from "@/src/services/media";

export interface DriveInfo {
  name: string;
  uri: string;
  simulated: boolean; // true = internal/virtual drive (preview / fallback)
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
    } else {
      try {
        const { Directory } = require("expo-file-system");
        const dir = await Directory.pickDirectoryAsync();
        const uri = dir.uri as string;
        // SAF tree URIs for removable media look like
        // content://com.android.externalstorage.documents/tree/XXXX-XXXX%3A...
        // "primary%3A" means the user picked a folder on INTERNAL storage.
        if (!uri.startsWith("content://") || uri.includes("/tree/primary%3A")) {
          throw new Error("NOT_USB: pick a folder on the USB drive, not internal storage");
        }
        info = { name: "USB DRIVE", uri, simulated: false };
      } catch (e: any) {
        // Only dev builds / Expo Go may fall back to an internal virtual drive.
        // In release builds we never silently write to internal storage.
        if (!__DEV__) throw e;
        const uri = await getInternalVirtualDir();
        info = { name: "SIM-USB (internal)", uri, simulated: true };
      }
    }
    await storage.setItem(DRIVE_KEY, info as any);
    return info;
  },

  async disconnect(): Promise<void> {
    await storage.removeItem(DRIVE_KEY);
    await storage.setItem(INDEX_KEY, [] as any);
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
        const { File } = require("expo-file-system");
        const f = new File(target.uri);
        if (f.exists) f.delete();
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
