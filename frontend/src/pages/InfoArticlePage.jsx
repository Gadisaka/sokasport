import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import PageContainer from "../components/layout/PageContainer";
import TopHeader from "../components/layout/TopHeader";
import PrimaryNav from "../components/layout/PrimaryNav";
import MobileBottomBar from "../components/layout/MobileBottomBar";
import AppIcon from "../components/common/AppIcon";
import SoftPanel from "../components/common/SoftPanel";
import {
  CONTACT_PAGE_SLUG,
  FAQ_PAGE_SLUG,
  infoPageLabelForSlug,
  isValidInfoPageSlug,
} from "../data/infoPages";
import { topNavItems } from "../data/homepageData";
import { fetchPlayerInfoPages } from "../services/api";
import { useTranslation } from "../i18n/LanguageContext.jsx";

function InfoArticlePage() {
  const { slug } = useParams();
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pages, setPages] = useState(null);

  const validSlug = slug && isValidInfoPageSlug(slug);

  useEffect(() => {
    if (!validSlug) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const data = await fetchPlayerInfoPages();
        if (!cancelled) setPages(data?.pages ?? null);
      } catch (e) {
        if (!cancelled) setError(e?.message || "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [slug, validSlug]);

  if (!validSlug) {
    return <Navigate to="/" replace />;
  }

  const title = t(`infoPage.${slug}`, infoPageLabelForSlug(slug));

  const faqItems =
    slug === FAQ_PAGE_SLUG && Array.isArray(pages?.faq?.items)
      ? pages.faq.items
      : [];
  const contactEntries =
    slug === CONTACT_PAGE_SLUG && Array.isArray(pages?.["contact-us"]?.entries)
      ? pages["contact-us"].entries
      : [];
  const bodyText =
    slug !== FAQ_PAGE_SLUG && slug !== CONTACT_PAGE_SLUG
      ? typeof pages?.[slug]?.body === "string"
        ? pages[slug].body
        : ""
      : "";

  const hasFaqContent = faqItems.length > 0;
  const hasContactContent = contactEntries.length > 0;
  const hasBodyContent = bodyText.trim().length > 0;

  return (
    <PageContainer>
      <div className="sticky top-0 z-50">
        <TopHeader />
        <PrimaryNav items={topNavItems} />
      </div>

      <div className="relative mx-auto w-full max-w-2xl px-4 pb-28 pt-2 sm:px-5 sm:pt-4">
        <div
          className="pointer-events-none absolute -top-4 left-1/2 h-64 w-[min(100%,36rem)] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(1,144,82,0.12),transparent_68%)] blur-xl"
          aria-hidden
        />

        <header className="relative mb-6 flex items-center gap-4">
          <Link
            to="/"
            className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-(--sb-bg-2)/90 text-[#ffffff] shadow-lg shadow-black/20  transition-transform duration-300 hover:scale-105 hover:bg-(--sb-bg-2) hover:ring-(--sb-accent-fill)/30 active:scale-95"
            aria-label={t("article.backHome")}
          >
            <AppIcon name="chevronDown" size={18} className="rotate-90" />
          </Link>
          <div>
            <p className="m-0 text-[11px] font-extrabold uppercase tracking-[0.2em] text-[rgba(255,255,255,0.72)]">
              {t("sidebar.infoSection")}
            </p>
            <h1 className="m-0 text-xl font-black tracking-tight text-[#ffffff] sm:text-2xl">
              {title}
            </h1>
          </div>
        </header>

        <SoftPanel>
          {loading ? (
            <p className="m-0 text-center text-sm text-[rgba(255,255,255,0.72)]">{t("article.loading")}</p>
          ) : error ? (
            <p className="m-0 text-center text-sm text-red-400">{error}</p>
          ) : slug === FAQ_PAGE_SLUG ? (
            <div
              className="max-h-[min(70vh,40rem)] space-y-2 overflow-y-auto pr-1"
              style={{ scrollbarGutter: "stable" }}
            >
              {!hasFaqContent ? (
                <p className="m-0 text-center text-sm text-[rgba(255,255,255,0.5)]">
                  {t("article.emptyTopic")}
                </p>
              ) : (
                faqItems.map((item, i) => (
                  <details
                    key={`faq-${i}`}
                    className="rounded-lg bg-[#0d1429]/65 ring-1 ring-[#253055]/85 open:bg-[#0d1429]/80 open:ring-[#33406a] open:[&_.faq-chevron]:rotate-180"
                  >
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-left [&::-webkit-details-marker]:hidden">
                      <span className="text-sm font-extrabold text-[#ffffff]">
                        {item.question}
                      </span>
                      <AppIcon
                        name="chevronDown"
                        size={18}
                        className="faq-chevron shrink-0 text-[rgba(255,255,255,0.5)] transition-transform duration-200"
                      />
                    </summary>
                    <div className="border-t border-[#253055]/60 px-4 pb-4 pt-1">
                      <div className="whitespace-pre-wrap wrap-break-word text-sm leading-relaxed text-[#9ca8c7]">
                        {item.answer}
                      </div>
                    </div>
                  </details>
                ))
              )}
            </div>
          ) : slug === CONTACT_PAGE_SLUG ? (
            <div
              className="max-h-[min(70vh,40rem)] overflow-y-auto"
              style={{ scrollbarGutter: "stable" }}
            >
              {!hasContactContent ? (
                <p className="m-0 text-center text-sm text-[rgba(255,255,255,0.5)]">
                  {t("article.emptyTopic")}
                </p>
              ) : (
                <ul className="flex list-none flex-col gap-4 p-0">
                  {contactEntries.map((entry, i) => (
                    <li key={`soc-${i}`}>
                      <a
                        href={entry.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-4 rounded-xl bg-[#0d1429]/65 p-4 no-underline ring-1 ring-[#253055]/85 transition-colors hover:bg-[#121a36]/85"
                      >
                        {entry.logo ? (
                          <img
                            src={entry.logo}
                            alt=""
                            className="h-12 w-12 shrink-0 rounded-lg object-cover ring-1 ring-[#33406a]"
                          />
                        ) : null}
                        <span className="text-sm font-bold text-[#ffffff]">
                          {entry.name}
                        </span>
                        <AppIcon
                          name="chevronRight"
                          size={14}
                          className="ml-auto shrink-0 text-[rgba(255,255,255,0.5)]"
                        />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : hasBodyContent ? (
            <div
              className="max-h-[min(70vh,40rem)] overflow-y-auto whitespace-pre-wrap wrap-break-word text-sm leading-relaxed text-[#c8cbd9]"
              style={{ scrollbarGutter: "stable" }}
            >
              {bodyText}
            </div>
          ) : (
            <p className="m-0 text-center text-sm text-[rgba(255,255,255,0.5)]">
              {t("article.emptyTopic")}
            </p>
          )}
        </SoftPanel>
      </div>

      <MobileBottomBar />
    </PageContainer>
  );
}

export default InfoArticlePage;
