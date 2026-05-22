import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "./useApiRequest";

export const meQueryKey = (token) => ["auth", "me", token];

export function useMeQuery(token) {
  return useQuery({
    queryKey: meQueryKey(token),
    queryFn: () => apiRequest("/auth/me"),
    enabled: Boolean(token),
    retry: false,
  });
}
