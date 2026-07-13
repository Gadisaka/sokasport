/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLoginMutation } from "../hook/useLoginMutation";
import { meQueryKey, useMeQuery } from "../hook/useMeQuery";
import { ADMIN_ALLOWED_ROLES } from "../constants/auth";

const AuthContext = createContext(null);

function loadStoredAuth() {
  try {
    const token = localStorage.getItem("accessToken");
    const raw = localStorage.getItem("user");
    if (token && raw) return { token, user: JSON.parse(raw) };
  } catch { /* corrupted storage */ }
  return { token: null, user: null };
}

export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const initialAuth = loadStoredAuth();

  const [token, setToken] = useState(initialAuth.token);
  const [user, setUser] = useState(initialAuth.user);
  const loginMutation = useLoginMutation();
  const meQuery = useMeQuery(token);

  const logout = useCallback(() => {
    localStorage.removeItem("accessToken");
    localStorage.removeItem("user");
    setToken(null);
    setUser(null);
    queryClient.removeQueries({ queryKey: ["auth", "me"] });
  }, [queryClient]);

  const replaceAccessToken = useCallback(
    (nextToken) => {
      if (!nextToken) return;
      localStorage.setItem("accessToken", nextToken);
      setToken(nextToken);
      queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
    },
    [queryClient],
  );

  const meUser = useMemo(() => {
    if (!meQuery.data) {
      return null;
    }

    return {
      id: meQuery.data.id,
      username: meQuery.data.username ?? null,
      fullname: meQuery.data.fullname,
      phone: meQuery.data.phone,
      role: meQuery.data.role,
    };
  }, [meQuery.data]);

  const effectiveUser = useMemo(() => {
    const source = meUser || user;
    if (!source) {
      return null;
    }
    if (!ADMIN_ALLOWED_ROLES.includes(source.role)) {
      return null;
    }
    if (token && meQuery.isError) {
      return null;
    }
    return source;
  }, [meQuery.isError, meUser, token, user]);

  useEffect(() => {
    if (!token || !meUser) {
      return;
    }
    localStorage.setItem("user", JSON.stringify(meUser));
  }, [token, meUser]);

  useEffect(() => {
    if (!token || !meQuery.isError) {
      return;
    }
    localStorage.removeItem("accessToken");
    localStorage.removeItem("user");
  }, [token, meQuery.isError]);

  async function login(username, password, fingerprint) {
    const { accessToken, user: loggedInUser } = await loginMutation.mutateAsync({
      username,
      password,
      fingerprint,
    });

    if (!ADMIN_ALLOWED_ROLES.includes(loggedInUser.role)) {
      throw new Error("Access denied — this portal is for admin staff only.");
    }

    localStorage.setItem("accessToken", accessToken);
    localStorage.setItem("user", JSON.stringify(loggedInUser));
    setToken(accessToken);
    setUser(loggedInUser);
    queryClient.setQueryData(meQueryKey(accessToken), loggedInUser);
    return loggedInUser;
  }

  const loading = useMemo(
    () => Boolean(token && (meQuery.isLoading || meQuery.isFetching)),
    [token, meQuery.isFetching, meQuery.isLoading],
  );

  return (
    <AuthContext.Provider
      value={{
        user: effectiveUser,
        loading,
        login,
        logout,
        replaceAccessToken,
        isLoggingIn: loginMutation.isPending,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
