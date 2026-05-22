import { useEffect, useState } from "react";
import { fetchPlayerSiteBranding } from "../services/api";
import logoWide from "../assets/Asset2.png";
import logoCompact from "../assets/Asset5.png";

function isValidHttpsLogoUrl(s) {
  return typeof s === "string" && s.trim().startsWith("https://");
}

const defaultResolved = Object.freeze({
  navbarWide: logoWide,
  navbarCompact: logoCompact,
  loadingLogo: logoCompact,
});

let brandingFetchPromise = null;

function loadBrandingOnce() {
  if (!brandingFetchPromise) {
    brandingFetchPromise = fetchPlayerSiteBranding()
      .catch(() => ({}))
      .finally(() => {
        brandingFetchPromise = null;
      });
  }
  return brandingFetchPromise;
}

/**
 * Resolved logo URLs for header + home loading overlay (CMS with bundled fallbacks).
 */
export function usePlayerSiteBranding() {
  const [resolved, setResolved] = useState(defaultResolved);

  useEffect(() => {
    let cancelled = false;
    loadBrandingOnce().then((data) => {
      if (cancelled) return;
      const wide = isValidHttpsLogoUrl(data?.navbarWide)
        ? data.navbarWide.trim()
        : logoWide;
      const compact = isValidHttpsLogoUrl(data?.navbarCompact)
        ? data.navbarCompact.trim()
        : logoCompact;
      const loading = isValidHttpsLogoUrl(data?.loadingLogo)
        ? data.loadingLogo.trim()
        : logoCompact;
      setResolved({ navbarWide: wide, navbarCompact: compact, loadingLogo: loading });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return resolved;
}
