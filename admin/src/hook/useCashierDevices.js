import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "./useApiRequest";

const KEY = ["admin", "cashier-devices"];

export function usePendingDeviceApprovalsQuery({
  page = 1,
  status = "PENDING",
} = {}) {
  return useQuery({
    queryKey: [...KEY, "pending", { page, status }],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("page", String(page));
      if (status) params.set("status", status);
      return apiRequest(`/admin/cashier-devices/pending?${params.toString()}`);
    },
    keepPreviousData: true,
  });
}

export function useTrustedDevicesQuery({ page = 1, activeOnly = true } = {}) {
  return useQuery({
    queryKey: [...KEY, "trusted", { page, activeOnly }],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("activeOnly", String(activeOnly));
      return apiRequest(`/admin/cashier-devices/trusted?${params.toString()}`);
    },
    keepPreviousData: true,
  });
}

export function useApproveDeviceMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) =>
      apiRequest(`/admin/cashier-devices/pending/${id}/approve`, {
        method: "PATCH",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KEY });
    },
  });
}

export function useRejectDeviceMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) =>
      apiRequest(`/admin/cashier-devices/pending/${id}/reject`, {
        method: "PATCH",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KEY });
    },
  });
}

export function useRevokeDeviceMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) =>
      apiRequest(`/admin/cashier-devices/trusted/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KEY });
    },
  });
}
