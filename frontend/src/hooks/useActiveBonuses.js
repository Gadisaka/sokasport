import { useEffect, useState } from "react";
import { fetchActiveBonuses } from "../services/api";

const REVAL_MS = 30_000;
let memo = null;
let memoAt = 0;
let inflight = null;

function stale() {
  return !memo || Date.now() - memoAt > REVAL_MS;
}

async function load() {
  if (!stale()) return memo;
  if (!inflight) {
    inflight = fetchActiveBonuses()
      .then((d) => {
        memo = d;
        memoAt = Date.now();
        return d;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** Active platform bonuses for slip (accumulator tiers, etc.). */
export function useActiveBonuses() {
  const [data, setData] = useState(memo);
  const [error, setError] = useState(null);

  useEffect(() => {
    let c = false;
    load()
      .then((d) => {
        if (!c) {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => {
        if (!c) setError(e);
      });
    return () => {
      c = true;
    };
  }, []);

  return {
    bonuses: data?.bonuses ?? [],
    loading: Boolean(!data && !error),
    error,
  };
}
