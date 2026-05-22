import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "./useApiRequest";

/**
 * POST /api/auth/verify-password — checks password for the current JWT user.
 */
export function useVerifyPasswordMutation() {
  return useMutation({
    mutationFn: ({ password }) =>
      apiRequest("/auth/verify-password", {
        method: "POST",
        body: JSON.stringify({ password }),
      }),
  });
}
