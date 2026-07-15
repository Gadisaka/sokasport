import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "./useApiRequest";

export function useCreateUserMutation() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (body) =>
      apiRequest("/admin/users", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "users"] }),
  });
}

export function useUpdateUserMutation() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...body }) =>
      apiRequest(`/admin/users/${id}`, {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "users"] }),
  });
}

export function useDeleteUserMutation() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (id) =>
      apiRequest(`/admin/users/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "users"] }),
  });
}
