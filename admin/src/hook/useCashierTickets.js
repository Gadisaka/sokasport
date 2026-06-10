import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "./useApiRequest";

const TICKETS_KEY = ["cashier", "tickets"];

function formatDateParam(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildTodayTicketsPath({ status = "", page = 1, limit = 20 } = {}) {
  const params = new URLSearchParams();
  params.set("date", formatDateParam());
  params.set("page", String(page));
  params.set("limit", String(limit));
  if (status) params.set("status", status);
  return `/tickets?${params.toString()}`;
}

export function mapTicketRow(ticket) {
  if (!ticket) return null;
  return {
    id: ticket.id,
    couponNumber: ticket.coupon_number ?? ticket.couponNumber ?? "",
    receiptNumber: ticket.receipt_number ?? ticket.receiptNumber ?? "",
    cashierId: ticket.cashier_id ?? ticket.cashierId ?? "",
    cashierName: ticket.cashier_name ?? ticket.cashierName ?? "",
    branchName: ticket.branch_name ?? ticket.branchName ?? "",
    branchLocation: ticket.branch_location ?? ticket.branchLocation ?? "",
    stake: Number(ticket.stake || 0),
    totalOdds: Number(ticket.total_odds ?? ticket.totalOdds ?? 0),
    accumulatorBonusPercent: Number(
      ticket.accumulator_bonus_percent ?? ticket.accumulatorBonusPercent ?? 0,
    ),
    potentialWin: Number(ticket.potential_win ?? ticket.potentialWin ?? 0),
    applyWinningsTax: Boolean(
      ticket.apply_winnings_tax ?? ticket.applyWinningsTax,
    ),
    winningsTaxRate: ticket.winnings_tax_rate ?? ticket.winningsTaxRate ?? null,
    status: String(ticket.status || "").toUpperCase(),
    createdAt: ticket.created_at ?? ticket.createdAt ?? null,
    printed: Boolean(ticket.printed),
  };
}

export function mapTicketDetail(ticket) {
  if (!ticket) return null;
  return {
    ...mapTicketRow(ticket),
    cashout: ticket.cashout
      ? {
          id: ticket.cashout.id,
          amount: Number(ticket.cashout.amount || 0),
          createdAt:
            ticket.cashout.createdAt ?? ticket.cashout.created_at ?? null,
          processedBy:
            ticket.cashout.processedBy ?? ticket.cashout.processed_by ?? null,
        }
      : null,
    selections: Array.isArray(ticket.selections)
      ? ticket.selections.map((selection) => ({
          id: selection.id,
          selection: selection.selection,
          odds: Number(selection.odds || 0),
          result: selection.result,
          marketLabel: selection.marketLabel ?? selection.market_label ?? "",
          match: selection.match
            ? {
                id: selection.match.id,
                homeTeam:
                  selection.match.homeTeam ?? selection.match.home_team ?? "",
                awayTeam:
                  selection.match.awayTeam ?? selection.match.away_team ?? "",
                startTime:
                  selection.match.startTime ?? selection.match.start_time ?? "",
                leagueName:
                  selection.match.leagueName ??
                  selection.match.league_name ??
                  "",
                leagueType:
                  selection.match.leagueType ??
                  selection.match.league_type ??
                  "",
                leagueCountry:
                  selection.match.leagueCountry ??
                  selection.match.league_country ??
                  "",
                status:
                  selection.match.status ??
                  selection.match.match_status ??
                  null,
              }
            : null,
        }))
      : [],
  };
}

export function useTodayTicketsQuery({
  status = "",
  page = 1,
  limit = 20,
  enabled = true,
} = {}) {
  return useQuery({
    queryKey: [...TICKETS_KEY, "today", { status, page, limit }],
    queryFn: async () => {
      const payload = await apiRequest(
        buildTodayTicketsPath({ status, page, limit }),
      );
      const items = Array.isArray(payload?.items)
        ? payload.items.map(mapTicketRow)
        : [];
      return {
        items,
        page: payload?.page ?? page,
        limit: payload?.limit ?? limit,
        total: payload?.total ?? items.length,
        totalPages: payload?.totalPages ?? 1,
      };
    },
    enabled,
    keepPreviousData: true,
  });
}

export function useCouponLookupMutation() {
  return useMutation({
    mutationFn: async (input) => {
      const couponNumber =
        typeof input === "string" ? input : input?.couponNumber;
      const status =
        typeof input === "string" ? "" : String(input?.status || "").trim();

      const coupon = String(couponNumber || "").trim();
      if (!coupon) throw new Error("Coupon number is required");
      const params = new URLSearchParams();
      params.set("couponNumber", coupon);
      params.set("limit", "1");
      if (status) params.set("status", status);
      const payload = await apiRequest(`/tickets?${params.toString()}`);
      const item = Array.isArray(payload?.items) ? payload.items[0] : null;
      if (!item) throw new Error("Ticket not found");
      const detail = await apiRequest(`/tickets/${item.id}`);
      return mapTicketDetail(detail);
    },
  });
}

export function useReceiptLookupMutation() {
  return useMutation({
    mutationFn: async (receiptNumber) => {
      const r = String(receiptNumber || "").trim();
      if (!r) throw new Error("Receipt number is required");
      const params = new URLSearchParams();
      params.set("receiptNumber", r);
      const detail = await apiRequest(
        `/tickets/by-receipt?${params.toString()}`,
      );
      return mapTicketDetail(detail);
    },
  });
}

export function useTicketByIdLookupMutation() {
  return useMutation({
    mutationFn: async (ticketId) => {
      const id = String(ticketId || "").trim();
      if (!id) throw new Error("Ticket id is required");
      const detail = await apiRequest(`/tickets/${id}`);
      return mapTicketDetail(detail);
    },
  });
}

export function useCancelTicketMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ticketId) =>
      apiRequest(`/tickets/${ticketId}/cancel`, {
        method: "PATCH",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TICKETS_KEY });
    },
  });
}

export function usePayoutTicketMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ticketId, cashierId }) =>
      apiRequest(`/tickets/${ticketId}/payout`, {
        method: "PATCH",
        body: JSON.stringify(cashierId ? { cashierId } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TICKETS_KEY });
    },
  });
}

export function useCashoutQuoteMutation() {
  return useMutation({
    mutationFn: async (ticketId) => {
      const payload = await apiRequest(`/tickets/${ticketId}/cashout-quote`);
      return payload;
    },
  });
}

export function useExecuteCashoutMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ticketId) => {
      const payload = await apiRequest(`/tickets/${ticketId}/cashout`, {
        method: "POST",
      });
      return payload;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TICKETS_KEY });
    },
  });
}

export function useUpdateTicketStakeMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ticketId, stake }) => {
      const payload = await apiRequest(`/tickets/${ticketId}/stake`, {
        method: "PATCH",
        body: JSON.stringify({ stake: Number(stake) }),
      });
      return mapTicketDetail(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TICKETS_KEY });
    },
  });
}

export function useSellBlockingQuery(ticketId, { enabled = true } = {}) {
  const id = String(ticketId || "").trim();
  return useQuery({
    queryKey: [...TICKETS_KEY, "sell-blocking", id],
    queryFn: async () => {
      const payload = await apiRequest(`/tickets/${id}/sell-blocking`);
      return {
        blockingLegs: Array.isArray(payload?.blockingLegs)
          ? payload.blockingLegs
          : [],
        hasBlockingLegs: Boolean(payload?.hasBlockingLegs),
      };
    },
    enabled: Boolean(enabled && id),
  });
}

export function useRemoveTicketSelectionMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ticketId, selectionId }) => {
      const payload = await apiRequest(
        `/tickets/${ticketId}/selections/${encodeURIComponent(selectionId)}`,
        { method: "DELETE" },
      );
      return mapTicketDetail(payload);
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: TICKETS_KEY });
      if (variables?.ticketId) {
        qc.invalidateQueries({
          queryKey: [...TICKETS_KEY, "sell-blocking", String(variables.ticketId)],
        });
      }
    },
  });
}

export function usePreparePrintTicketMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ticketId }) =>
      apiRequest(`/tickets/${ticketId}/prepare-print`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TICKETS_KEY });
    },
  });
}

export function useValidatePrintTicketMutation() {
  return useMutation({
    mutationFn: ({ ticketId, acceptOddsChanges = false, selections = [] }) =>
      apiRequest(`/tickets/${ticketId}/validate-print`, {
        method: "POST",
        body: JSON.stringify({
          acceptOddsChanges,
          selections,
        }),
      }),
  });
}

export function useConfirmPrintedTicketMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ticketId, acceptOddsChanges = false, selections = [] }) =>
      apiRequest(`/tickets/${ticketId}/confirm-print`, {
        method: "PATCH",
        body: JSON.stringify({
          acceptOddsChanges,
          selections,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TICKETS_KEY });
    },
  });
}
