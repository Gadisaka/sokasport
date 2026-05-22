import { useEffect, useMemo, useState } from "react";
import { fetchHomeHeroBanners } from "../../services/api";

import bannerFour from "../../assets/banners/banner4.png";

function HeroBanner() {
  const fallbackBanners = useMemo(() => [bannerFour], []);
  const [banners, setBanners] = useState(fallbackBanners);
  const [currentBanner, setCurrentBanner] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchHomeHeroBanners();
        const urls = Array.isArray(data?.urls)
          ? data.urls.filter(
              (u) => typeof u === "string" && u.trim().startsWith("https://"),
            )
          : [];
        if (!cancelled) {
          const next = urls.length > 0 ? urls : fallbackBanners;
          setBanners(next);
          setCurrentBanner(0);
        }
      } catch {
        if (!cancelled) {
          setBanners(fallbackBanners);
          setCurrentBanner(0);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fallbackBanners]);

  useEffect(() => {
    if (banners.length <= 1) return;
    const intervalId = setInterval(() => {
      setCurrentBanner((prev) => (prev + 1) % banners.length);
    }, 3500);

    return () => clearInterval(intervalId);
  }, [banners.length]);

  return (
    <div className="sb-card aspect-1080/300 w-full overflow-hidden rounded-[1.15rem] transition-shadow duration-500 hover:shadow-[0_20px_48px_-14px_rgba(1,144,82,0.12)]">
      <img
        src={banners[currentBanner]}
        alt="Promotional banner"
        className="h-full w-full object-contain object-center"
        width={1080}
        height={300}
        decoding="async"
      />
    </div>
  );
}

export default HeroBanner;
