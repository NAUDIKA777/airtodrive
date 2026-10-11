import { Platform } from "react-native";

import { UsbDrive, type UsbAccessStatus } from "@/modules/usb-drive";
import { storage } from "@/src/utils/storage";
import type { DriveFile } from "@/src/services/media";

export interface DriveInfo {
  name: string;
  uri: string;
  simulated: boolean; // true = internal/virtual drive (preview / fallback)
  // Live SAF check, filled in by getStatus() on every read (never trusted from
  // storage). undefined = could not check (simulated drive / no native module).
  status?: UsbAccessStatus;
}

// A drive we can actually write to right now.
export function isDriveReady(info: DriveInfo | null | undefined): info is DriveInfo {
  if (!info) return false;
  return info.simulated || info.status === undefined || info.status === "ok";
}

// Friendly toast text for a failed connect(). Returns null when the user simply
// backed out of the picker (no toast needed).
export function connectErrorMessage(e: unknown): string | null {
  const code = String((e as any)?.code ?? "");
  const msg = String((e as any)?.message ?? e);
  if (code === "ERR_CANCELLED" || /cancel/i.test(msg)) return null;
  if (msg.startsWith("NOT_USB")) return "That's phone storage — pick a folder on the USB drive";
  if (code === "ERR_NOT_WRITABLE") return "Android didn't grant write access — pick the drive again and tap Allow";
  return "Could not connect drive";
}

// Short human label for the drive's current state.
export function driveStatusLabel(info: DriveInfo | null | undefined): string {
  if (!info) return "No drive · tap to connect";
  switch (info.status) {
    case "unmounted":
      return "Drive unplugged · tap to reconnect";
    case "no_permission":
      return "Access lost · tap to reconnect";
    case "read_only":
      return "Read-only · tap to reconnect";
    default:
      return info.name;
  }
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
    const info = (await storage.getItem<DriveInfo | null>(DRIVE_KEY, null)) as DriveInfo | null;
    if (!info || info.simulated || !info.uri.startsWith("content://")) return info;
    // Re-check the persisted SAF grant and that the drive is still plugged in,
    // so the UI never claims a drive that Android will refuse to write to.
    const access = UsbDrive.checkAccess(info.uri);
    return { ...info, status: access?.status };
  },

  async connect(): Promise<DriveInfo> {
    let info: DriveInfo;
    if (isWeb()) {
      info = { name: "SIM-USB 32G", uri: "virtual://usb", simulated: true };
    } else if (UsbDrive.isAvailable) {
      // Native SAF picker: opens on the USB volume and persists READ + WRITE.
      const access = await UsbDrive.pickFolder();
      if (access.isInternal) {
        UsbDrive.releaseAccess(access.uri);
        throw new Error("NOT_USB: pick a folder on the USB drive, not internal storage");
      }
      const previous = (await storage.getItem<DriveInfo | null>(DRIVE_KEY, null)) as DriveInfo | null;
      if (previous && !previous.simulated && previous.uri !== access.uri) {
        UsbDrive.releaseAccess(previous.uri); // don't pile up stale grants (Android caps them)
      }
      const name = access.folder ? `${access.label} / ${access.folder}` : access.label;
      info = { name, uri: access.uri, simulated: false };
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
    return { ...info, status: info.simulated ? undefined : "ok" };
  },

  async disconnect(): Promise<void> {
    const info = (await storage.getItem<DriveInfo | null>(DRIVE_KEY, null)) as DriveInfo | null;
    if (info && !info.simulated) UsbDrive.releaseAccess(info.uri);
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
