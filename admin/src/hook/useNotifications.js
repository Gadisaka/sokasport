import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "./useApiRequest";

export function useNotificationsQuery({ page = 1, limit = 20, unreadOnly = false, enabled = true } = {}) {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("limit", String(limit));
  if (unreadOnly) params.set("unreadOnly", "true");

  return useQuery({
    queryKey: ["notifications", { page, limit, unreadOnly }],
    queryFn: () => apiRequest(`/notifications?${params}`),
    enabled,
    refetchInterval: enabled ? 30_000 : false,
  });
}

export function useNotificationUnreadCountQuery({ enabled = true } = {}) {
  return useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: () => apiRequest("/notifications/unread-count"),
    enabled,
    refetchInterval: enabled ? 30_000 : false,
  });
}

export function useMarkNotificationReadMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) =>
      apiRequest(`/notifications/${id}/read`, { method: "PATCH" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

export function useMarkAllNotificationsReadMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiRequest("/notifications/read-all", { method: "PATCH" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

export function useSendAdminNotificationMutation() {
  return useMutation({
    mutationFn: (body) =>
      apiRequest("/admin/notifications/send", {
        method: "POST",
        body: JSON.stringify(body),
      }),
  });
}
