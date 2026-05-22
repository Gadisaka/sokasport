import { useEffect, useState } from "react";
import { fetchPublicPlatformConfig } from "../services/api";

/** Re-fetch so admin edits propagate (SPA + tab revisit). */
const REVAL_MS = 30_000;

let memo = null;
let memoAt = 0;
let inflightPromise = null;

/** For tests or forcing next fetch to bypass memo. */
export function invalidatePlatformSettingsCache() {
  memo = null;
  memoAt = 0;
  inflightPromise = null;
}

export function kickPlatformSettingsRefresh() {
  memo = null;
  memoAt = 0;
}

function isMemoStale() {
  if (!memo) return true;
  return Date.now() - memoAt > REVAL_MS;
}

async function ensurePlatformConfig() {
  if (!isMemoStale()) return memo;
  if (!inflightPromise) {
    inflightPromise = fetchPublicPlatformConfig()
      .then((data) => {
        memo = data;
        memoAt = Date.now();
        return data;
      })
      .finally(() => {
        inflightPromise = null;
      });
  }
  return inflightPromise;
}

/**
 * Loads public `/api/cms/platform-config` with memo + TTL revalidation,
 * visibility/focus refresh, and in-flight deduplication across components.
 */
export function usePlatformSettings() {
  const [config, setConfig] = useState(memo ?? null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await ensurePlatformConfig();
        if (!cancelled) {
          setConfig(data);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function revalidateSoon() {
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      )
        return;
      if (!isMemoStale()) return;
      ensurePlatformConfig()
        .then((data) => {
          setConfig(data);
          setError(null);
        })
        .catch((e) => setError(e));
    }

    window.addEventListener("focus", revalidateSoon);
    document.addEventListener("visibilitychange", revalidateSoon);
    return () => {
      window.removeEventListener("focus", revalidateSoon);
      document.removeEventListener("visibilitychange", revalidateSoon);
    };
  }, []);

  return {
    config,
    limits: config?.limits ?? null,
    ticketCancelWindowMinutes: config?.ticketCancelWindowMinutes ?? null,
    onlineDepositReceivers: config?.onlineDepositReceivers ?? null,
    winningsTax: config?.winningsTax ?? null,
    loading: Boolean(!config && error == null),
    error,
  };
}
