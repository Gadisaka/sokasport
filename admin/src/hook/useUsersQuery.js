import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "./useApiRequest";

export function useUsersQuery({
  page = 1,
  search = "",
  role = "",
  status = "",
  enabled = true,
} = {}) {
  const params = new URLSearchParams();
  params.set("page", page);
  if (search) params.set("search", search);
  if (role) params.set("role", role);
  if (status) params.set("status", status);

  return useQuery({
    queryKey: ["admin", "users", { page, search, role, status }],
    queryFn: () => apiRequest(`/admin/users?${params}`),
    keepPreviousData: true,
    enabled,
  });
}

export function useUsersMetaQuery() {
  return useQuery({
    queryKey: ["admin", "users", "meta"],
    queryFn: () => apiRequest("/admin/users/meta"),
    staleTime: 5 * 60 * 1000,
  });
}
