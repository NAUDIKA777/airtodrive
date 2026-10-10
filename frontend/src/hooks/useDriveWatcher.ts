import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";

import { UsbDrive } from "@/modules/usb-drive";
import { useToast } from "@/src/components/toast";
import { useDriveStatus } from "@/src/hooks/useDrive";
import { drive, type DriveInfo } from "@/src/services/drive";
import { driveEvents } from "@/src/services/driveEvents";

// Backup check for devices that don't broadcast unplug events reliably.
const POLL_MS = 2000;

// Watches the connected USB drive app-wide. The moment it disappears, every
// recording / transfer is halted (via driveEvents) and the drive is marked
// disconnected so nothing tries to write to it again.
export function useDriveWatcher() {
  const { data: info } = useDriveStatus();
  const qc = useQueryClient();
  const toast = useToast();
  const handling = useRef(false);

  useEffect(() => {
    const native = UsbDrive;
    if (!native || !info || info.simulated) return;
    const current: DriveInfo = info;
    native.watchDrive(current.uri);

    const lose = async (reason: string) => {
      if (handling.current) return;
      handling.current = true;
      driveEvents.emitLost(reason); // halt first, tidy up after
      await drive.markDetached();
      qc.invalidateQueries({ queryKey: ["drive"] });
      toast.show("USB drive disconnected — recording and transfers stopped", "error");
      handling.current = false;
    };

    const check = async () => {
      if (!(await drive.isAvailable(current))) lose("unavailable");
    };

    // Native unplug / unmount broadcast: the native side has already aborted
    // its own downloads by the time this fires.
    const sub = native.addListener("onDriveDetached", (e) => lose(e.action));
    const timer = setInterval(check, POLL_MS);
    const appState = AppState.addEventListener("change", (s) => {
      if (s === "active") check();
    });
    check(); // the drive may have been unplugged while the app was closed

    return () => {
      sub.remove();
      clearInterval(timer);
      appState.remove();
      native.watchDrive(null);
    };
  }, [info, qc, toast]);
}

export function DriveWatcher() {
  useDriveWatcher();
  return null;
}
