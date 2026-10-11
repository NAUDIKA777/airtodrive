import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { AppState } from "react-native";

import { UsbDrive } from "@/modules/usb-drive";
import { drive } from "@/src/services/drive";

// Re-validate the USB drive whenever a volume is plugged / unplugged or the app
// returns to the foreground (the user may have yanked the drive meanwhile).
// Mount once, near the root.
export function useDriveWatcher() {
  const qc = useQueryClient();
  useEffect(() => {
    const refresh = () => qc.invalidateQueries({ queryKey: ["drive"] });
    const offVolume = UsbDrive.onVolumeChange(refresh);
    const appSub = AppState.addEventListener("change", (s) => {
      if (s === "active") refresh();
    });
    return () => {
      offVolume();
      appSub.remove();
    };
  }, [qc]);
}

export function useDriveStatus() {
  return useQuery({ queryKey: ["drive"], queryFn: () => drive.getStatus() });
}

export function useDriveUsage() {
  return useQuery({ queryKey: ["drive-usage"], queryFn: () => drive.usage() });
}

export function useDriveFiles() {
  return useQuery({ queryKey: ["files"], queryFn: () => drive.listFiles() });
}

export function useConnectDrive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => drive.connect(),
    onSuccess: (info) => {
      qc.setQueryData(["drive"], info);
    },
  });
}

export function useDisconnectDrive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => drive.disconnect(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["drive"] });
      qc.invalidateQueries({ queryKey: ["files"] });
      qc.invalidateQueries({ queryKey: ["drive-usage"] });
    },
  });
}

export function useDeleteFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => drive.deleteFile(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["files"] });
      qc.invalidateQueries({ queryKey: ["drive-usage"] });
    },
  });
}
