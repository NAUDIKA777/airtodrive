// App-wide "the USB drive is gone" signal. The DriveWatcher raises it; the
// recorder and any in-flight transfer subscribe and halt immediately.

type Listener = (reason: string) => void;

const listeners = new Set<Listener>();
let lost = false;

export const driveEvents = {
  emitLost(reason: string) {
    lost = true;
    for (const l of [...listeners]) {
      try {
        l(reason);
      } catch {
        // a failing listener must not stop the others from halting
      }
    }
  },
  // Called when a drive is (re)connected.
  reset() {
    lost = false;
  },
  isLost() {
    return lost;
  },
  onLost(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
