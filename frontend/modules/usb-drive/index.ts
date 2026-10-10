import { requireOptionalNativeModule, type NativeModule } from "expo";

// JS face of the local Kotlin module in ./android (Android only). It is absent
// on web / iOS / Expo Go, so callers must check `UsbDrive` for null.

export interface PickedDrive {
  uri: string; // persisted SAF tree URI of the USB drive root
  volumeId: string; // e.g. "1A2B-3C4D"
  name: string; // volume label shown by Android
}

export interface CreatedDocument {
  uri: string; // content:// document URI on the drive
  name: string; // final name (the provider may de-duplicate it)
}

export interface DownloadResult extends CreatedDocument {
  size: number;
}

export interface DownloadProgressEvent {
  id: string;
  bytesWritten: number;
  totalBytes: number; // -1 when the server sends no Content-Length
}

export interface DriveDetachedEvent {
  action: string;
  volumeId: string | null;
}

type UsbDriveEvents = {
  onDriveDetached: (e: DriveDetachedEvent) => void;
  onDownloadProgress: (e: DownloadProgressEvent) => void;
};

declare class UsbDriveNativeModule extends NativeModule<UsbDriveEvents> {
  pickDriveRoot(): Promise<PickedDrive>;
  watchDrive(treeUri: string | null): void;
  hasAccess(treeUri: string): boolean;
  isAttached(treeUri: string): Promise<boolean>;
  releaseAccess(treeUri: string): void;
  createFile(treeUri: string, name: string, mimeType: string): Promise<CreatedDocument>;
  deleteFile(documentUri: string): Promise<boolean>;
  fileSize(documentUri: string): Promise<number>;
  download(options: {
    id: string;
    url: string;
    treeUri: string;
    name: string;
    mimeType: string;
  }): Promise<DownloadResult>;
  cancelDownload(id: string): void;
}

export const UsbDrive = requireOptionalNativeModule<UsbDriveNativeModule>("UsbDrive");
