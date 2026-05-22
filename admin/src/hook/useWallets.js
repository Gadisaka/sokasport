import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "./useApiRequest";

const KEY = ["admin", "wallets"];

export function usePendingRequestsQuery({ page = 1, status = "PENDING", type = "" } = {}) {
  return useQuery({
    queryKey: [...KEY, "pending", { page, status, type }],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("page", String(page));
      if (status) params.set("status", status);
      if (type) params.set("type", type);
      return apiRequest(`/admin/wallet/pending?${params.toString()}`);
    },
    keepPreviousData: true,
  });
}

export function useWalletDirectoryQuery({ page = 1, search = "", walletType = "" } = {}) {
  return useQuery({
    queryKey: [...KEY, "directory", { page, search, walletType }],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("page", String(page));
      if (search) params.set("search", search);
      if (walletType) params.set("walletType", walletType);
      return apiRequest(`/admin/wallet/wallets?${params.toString()}`);
    },
    keepPreviousData: true,
  });
}

export function useGlobalWalletHistoryQuery({
  page = 1,
  search = "",
  type = "",
  walletType = "",
  from = "",
  to = "",
} = {}) {
  return useQuery({
    queryKey: [...KEY, "history", { page, search, type, walletType, from, to }],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("page", String(page));
      if (search) params.set("search", search);
      if (type) params.set("type", type);
      if (walletType) params.set("walletType", walletType);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      return apiRequest(`/admin/wallet/history?${params.toString()}`);
    },
    keepPreviousData: true,
  });
}

function mutation(qc, fn) {
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useFillWalletMutation() {
  const qc = useQueryClient();
  return mutation(qc, ({ walletId, amount, reference }) =>
    apiRequest(`/admin/wallet/${walletId}/fill`, {
      method: "POST",
      body: JSON.stringify({ amount, reference }),
    }),
  );
}

export function useDeductWalletMutation() {
  const qc = useQueryClient();
  return mutation(qc, ({ walletId, amount, reference }) =>
    apiRequest(`/admin/wallet/${walletId}/deduct`, {
      method: "POST",
      body: JSON.stringify({ amount, reference }),
    }),
  );
}

export function useApproveRequestMutation() {
  const qc = useQueryClient();
  return mutation(qc, (id) =>
    apiRequest(`/admin/wallet/requests/${id}/approve`, { method: "PATCH" }),
  );
}

export function useRejectRequestMutation() {
  const qc = useQueryClient();
  return mutation(qc, (id) =>
    apiRequest(`/admin/wallet/requests/${id}/reject`, { method: "PATCH" }),
  );
}

export function useHoldRequestMutation() {
  const qc = useQueryClient();
  return mutation(qc, (id) =>
    apiRequest(`/admin/wallet/requests/${id}/hold`, { method: "PATCH" }),
  );
}
