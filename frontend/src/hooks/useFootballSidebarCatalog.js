import { useEffect, useState } from "react";
import { fetchFootballSidebarLeagues } from "../services/api";

/**
 * Loads pinned ∪ odds-horizon leagues for sidebar/tab lists (GET /api/football/sidebar-leagues).
 */
export function useFootballSidebarCatalog() {
  const [catalogItems, setCatalogItems] = useState([]);
  const [horizonDays, setHorizonDays] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchFootballSidebarLeagues()
      .then((data) => {
        if (cancelled || !data) return;
        setCatalogItems(Array.isArray(data.items) ? data.items : []);
        setHorizonDays(
          Number.isFinite(Number(data.horizonDays))
            ? Number(data.horizonDays)
            : null,
        );
      })
      .catch(() => {
        if (!cancelled) {
          setCatalogItems([]);
          setHorizonDays(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { catalogItems, horizonDays };
}
