import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "./useApiRequest";

export function useChangePasswordMutation() {
  return useMutation({
    mutationFn: ({ oldPassword, newPassword, confirmPassword }) =>
      apiRequest("/auth/change-password", {
        method: "PATCH",
        body: JSON.stringify({ oldPassword, newPassword, confirmPassword }),
      }),
  });
}
