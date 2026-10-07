import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { drive } from "@/src/services/drive";

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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["drive"] });
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
