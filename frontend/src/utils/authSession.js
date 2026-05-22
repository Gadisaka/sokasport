export const PLAYER_ROLE = "PLAYER";

export function getStoredUser() {
  const raw = localStorage.getItem("user") || sessionStorage.getItem("user");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function hasStoredAuthToken() {
  return Boolean(
    localStorage.getItem("token") || sessionStorage.getItem("token"),
  );
}

export function isPlayerUser(user) {
  return user?.role === PLAYER_ROLE;
}

export function clearAuthSession() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  sessionStorage.removeItem("token");
  sessionStorage.removeItem("user");
  window.dispatchEvent(new Event("authSessionUpdated"));
}

export function saveAuthSession({ token, user, remember = false }) {
  const storage = remember ? localStorage : sessionStorage;
  storage.setItem("token", token);
  storage.setItem("user", JSON.stringify(user));
  window.dispatchEvent(new Event("authSessionUpdated"));
}

/** Drop sessions for staff/admin accounts that cannot use the player site. */
export function enforcePlayerSession() {
  if (!hasStoredAuthToken()) return;
  const user = getStoredUser();
  if (!isPlayerUser(user)) {
    clearAuthSession();
  }
}
