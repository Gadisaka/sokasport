import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "./useApiRequest";

const BASE = "/admin/agents-cashiers";
const KEY = ["admin", "agents-cashiers"];

// ─── Cashiers ────────────────────────────────────────────────────────────────

export function useCashiersQuery({ page = 1, search = "" } = {}) {
  return useQuery({
    queryKey: [...KEY, "cashiers", { page, search }],
    queryFn: () => {
      const p = new URLSearchParams();
      p.set("page", page);
      if (search) p.set("search", search);
      return apiRequest(`${BASE}/cashiers?${p}`);
    },
    keepPreviousData: true,
  });
}

export function useCashierDetailQuery(id) {
  return useQuery({
    queryKey: [...KEY, "cashiers", id],
    queryFn: () => apiRequest(`${BASE}/cashiers/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateCashierMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      apiRequest(`${BASE}/cashiers`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateCashierMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) =>
      apiRequest(`${BASE}/cashiers/${id}`, { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteCashierMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) =>
      apiRequest(`${BASE}/cashiers/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

// ─── Agents ──────────────────────────────────────────────────────────────────

export function useCreateAgentMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      apiRequest(`${BASE}/agents`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateAgentMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) =>
      apiRequest(`${BASE}/agents/${id}`, { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteAgentMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) =>
      apiRequest(`${BASE}/agents/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useAgentsQuery({ page = 1, search = "" } = {}) {
  return useQuery({
    queryKey: [...KEY, "agents", { page, search }],
    queryFn: () => {
      const p = new URLSearchParams();
      p.set("page", page);
      if (search) p.set("search", search);
      return apiRequest(`${BASE}/agents?${p}`);
    },
    keepPreviousData: true,
  });
}

// ─── Assignable cashiers (for agent assignment UI) ───────────────────────────

export function useAssignableCashiersQuery() {
  return useQuery({
    queryKey: [...KEY, "assignable-cashiers"],
    queryFn: () => apiRequest(`${BASE}/assignable-cashiers`),
    staleTime: 30_000,
  });
}

// ─── Assignment ──────────────────────────────────────────────────────────────

export function useAssignAgentMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, cashierProfileId }) =>
      apiRequest(`${BASE}/assign`, {
        method: "POST",
        body: JSON.stringify({ agentId, cashierProfileId }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUnassignAgentMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cashierProfileId) =>
      apiRequest(`${BASE}/assign/${cashierProfileId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
