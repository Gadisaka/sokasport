import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "./useApiRequest";

export function useLoginMutation() {
  return useMutation({
    mutationFn: ({ phone, password, fingerprint }) =>
      apiRequest("/auth/login", {
        method: "POST",
        body: JSON.stringify({ phone, password, fingerprint }),
      }),
  });
}
