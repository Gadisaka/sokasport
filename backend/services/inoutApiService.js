/**
 * InOut Games REST client.
 *
 * Thin axios wrapper for InOut's outbound REST endpoints (currently just the
 * game catalog). Mirrors the resilience style of `services/apiSportsService.js`
 * — a bounded timeout and a couple of network retries — but throws on final
 * failure so callers (the catalog sync) can decide how to react rather than
 * silently persisting an empty list.
 *
 * @module services/inoutApiService
 */
import axios from "axios";
import { INOUT_API_BASE_URL } from "../Config/inout.js";

const REQUEST_TIMEOUT_MS = Number(process.env.INOUT_API_TIMEOUT_MS || 15000);
const MAX_NETWORK_RETRIES = Number(process.env.INOUT_API_MAX_RETRIES || 2);
const RETRY_BACKOFF_MS = 1500;

const client = axios.create({
  baseURL: INOUT_API_BASE_URL,
  timeout: REQUEST_TIMEOUT_MS,
  headers: { Accept: "application/json" },
});

function isRetriableNetworkError(err) {
  const code = err?.code;
  return (
    code === "ECONNABORTED" ||
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN"
  );
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetch the list of games available to an operator.
 *
 * @param {string} operatorId Operator UUID.
 * @returns {Promise<Array<{
 *   gameMode: string,
 *   title?: string,
 *   description?: string,
 *   iconsUrls?: { url?: string },
 *   multiplayer?: boolean,
 *   rtp?: string,
 * }>>}
 */
export async function fetchGameModesList(operatorId, attempt = 0) {
  if (!operatorId) {
    throw new Error("fetchGameModesList: operatorId is required");
  }

  try {
    const res = await client.get("/gameModesList", {
      params: { operatorId },
    });
    return Array.isArray(res.data) ? res.data : [];
  } catch (err) {
    if (isRetriableNetworkError(err) && attempt < MAX_NETWORK_RETRIES) {
      await sleep(RETRY_BACKOFF_MS * (attempt + 1));
      return fetchGameModesList(operatorId, attempt + 1);
    }
    const status = err?.response?.status;
    const detail = status ? `HTTP ${status}` : err?.code || err?.message;
    throw new Error(`InOut gameModesList failed: ${detail}`);
  }
}
