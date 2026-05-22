import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "./useApiRequest";

const KEY = ["admin", "tickets"];

function withQuery(path, params) {
  const search = new URLSearchParams();
  for (const [k, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === "") continue;
    search.set(k, String(value));
  }
  const q = search.toString();
  return q ? `${path}?${q}` : path;
}

export function useAdminTicketsQuery({
  page = 1,
  limit = 20,
  date = "",
  status = "",
  couponNumber = "",
  receiptId = "",
  branchName = "",
  branchLocation = "",
  cashierId = "",
  enabled = true,
} = {}) {
  return useQuery({
    queryKey: [
      ...KEY,
      "list",
      {
        page,
        limit,
        date,
        status,
        couponNumber,
        receiptId,
        branchName,
        branchLocation,
        cashierId,
      },
    ],
    queryFn: () =>
      apiRequest(
        withQuery("/tickets", {
          page,
          limit,
          date,
          status,
          couponNumber,
          receiptId,
          branchName,
          branchLocation,
          cashierId,
        }),
      ),
    enabled,
    keepPreviousData: true,
  });
}

export function useAdminTicketDetailQuery(ticketId, { enabled = true } = {}) {
  return useQuery({
    queryKey: [...KEY, "detail", ticketId],
    queryFn: () => apiRequest(`/tickets/${ticketId}`),
    enabled: Boolean(enabled && ticketId),
  });
}
