import { API_URL } from "../../constants.js";

export async function apiRequest(path, options = {}) {
  const token = localStorage.getItem("accessToken");
  const headers = { "Content-Type": "application/json", ...options.headers };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}${path}`, {
    credentials: "include",
    ...options,
    headers,
  });
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error(body?.message || "Request failed");
    error.status = response.status;
    error.code = body?.code || null;
    error.details = body;
    throw error;
  }

  return body;
}

/** POST multipart (e.g. Cloudinary upload). Do not set Content-Type — browser sets boundary. */
export async function apiUpload(path, formData) {
  const token = localStorage.getItem("accessToken");
  const headers = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    body: formData,
    credentials: "include",
    headers,
  });
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error(body?.message || "Upload failed");
    error.status = response.status;
    error.code = body?.code || null;
    error.details = body;
    throw error;
  }

  return body;
}
