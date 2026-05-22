import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "./useApiRequest";

const KEY = ["cashier", "wallet"];

/**
 * POST /api/cashier/wallet/deposit
 */
export function useCashierDepositMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ phone, amount }) =>
      apiRequest("/cashier/wallet/deposit", {
        method: "POST",
        body: JSON.stringify({ phone, amount }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/**
 * GET /api/cashier/wallet/withdraw-request?phone=...
 */
export function useCashierWithdrawRequestQuery(phone) {
  return useQuery({
    queryKey: [...KEY, "withdraw-request", phone],
    queryFn: () => apiRequest(`/cashier/wallet/withdraw-request?phone=${encodeURIComponent(phone)}`),
    enabled: !!phone,
  });
}

/**
 * PATCH /api/cashier/wallet/withdraw-request/:id/approve
 */
export function useCashierApproveWithdrawMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) =>
      apiRequest(`/cashier/wallet/withdraw-request/${id}/approve`, {
        method: "PATCH",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/**
 * POST /api/cashier/wallet/shop-withdraw/preview
 */
export function useCashierShopWithdrawPreviewMutation() {
  return useMutation({
    mutationFn: ({ phone, code }) =>
      apiRequest("/cashier/wallet/shop-withdraw/preview", {
        method: "POST",
        body: JSON.stringify({ phone, code }),
      }),
  });
}

/**
 * POST /api/cashier/wallet/shop-withdraw/redeem
 */
export function useCashierShopWithdrawRedeemMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ phone, code, amount }) =>
      apiRequest("/cashier/wallet/shop-withdraw/redeem", {
        method: "POST",
        body: JSON.stringify(
          amount !== undefined && amount !== null
            ? { phone, code, amount }
            : { phone, code },
        ),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/**
 * Maps UI tabs to wallet `type` on the API.
 * Cashier→player top-ups are stored as WITHDRAW on the cashier wallet (float decreases).
 * Approved player withdrawals credit the cashier wallet as DEPOSIT (float increases).
 */
function cashierHistoryTabToApiType(uiTab) {
  if (uiTab === "DEPOSIT") return "WITHDRAW";
  if (uiTab === "WITHDRAW") return "DEPOSIT";
  return "";
}

/**
 * GET /api/cashier/wallet/history?type=...&page=...
 * @param {string} type - UI tab: "DEPOSIT" = deposits to players, "WITHDRAW" = payout approvals
 */
export function useCashierHistoryQuery({ type = "", page = 1 } = {}) {
  const apiType = cashierHistoryTabToApiType(type);
  return useQuery({
    queryKey: [...KEY, "history", { type, page }],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("page", String(page));
      if (apiType) params.set("type", apiType);
      return apiRequest(`/cashier/wallet/history?${params.toString()}`);
    },
    keepPreviousData: true,
  });
}
