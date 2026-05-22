import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import AdminShell from "../../components/layout/AdminShell";
import PanelCard from "../../components/ui/PanelCard";
import PrimaryButton from "../../components/ui/PrimaryButton";
import { apiUpload } from "../../hook/useApiRequest";
import {
  useHomeHeroBannersQuery,
  useUpdateHomeHeroBannersMutation,
  usePlayerInfoPagesQuery,
  useUpdatePlayerInfoPagesMutation,
  usePlayerSiteBrandingQuery,
  useUpdatePlayerSiteBrandingMutation,
} from "../../hook/useSettingsQuery";
import { hasPermission } from "../../lib/permissions";
import CmsMessagesPanel from "../../components/cms/CmsMessagesPanel";

const MAX_BANNERS = 5;

const CMS_MAIN_TABS = [
  { key: "banners", label: "Hero banners" },
  { key: "branding", label: "Site branding" },
  { key: "info", label: "Info pages" },
  { key: "messages", label: "Messages" },
];

/** Must match backend `PLAYER_INFO_PAGE_IDS` */
const INFO_PAGE_DEFS = [
  { id: "faq", label: "FAQ" },
  { id: "how-to-play", label: "How to play" },
  { id: "privacy-policy", label: "Privacy Policy" },
  { id: "terms-and-conditions", label: "Terms and conditions" },
  { id: "contact-us", label: "Contact Us" },
];

const FAQ_PAGE_ID = "faq";
const CONTACT_PAGE_ID = "contact-us";

/** Plain `{ body }` pages — must match backend `BODY_PAGE_IDS`. */
const BODY_PAGE_IDS_PLAIN = [
  "how-to-play",
  "privacy-policy",
  "terms-and-conditions",
];

function normalizeInfoPagesDraft(fromApi) {
  const out = {};

  /** @type {{ question: string, answer: string }[]} */
  const faqRaw = Array.isArray(fromApi?.faq?.items) ? fromApi.faq.items : [];
  out.faq = {
    items: faqRaw.map((row) => ({
      question: typeof row.question === "string" ? row.question : "",
      answer: typeof row.answer === "string" ? row.answer : "",
    })),
  };

  /** @type {{ logo: string, name: string, link: string }[]} */
  const contactRaw = Array.isArray(fromApi?.["contact-us"]?.entries)
    ? fromApi["contact-us"].entries
    : [];
  out[CONTACT_PAGE_ID] = {
    entries: contactRaw.map((row) => ({
      logo: typeof row.logo === "string" ? row.logo : "",
      name: typeof row.name === "string" ? row.name : "",
      link: typeof row.link === "string" ? row.link : "",
    })),
  };

  for (const id of BODY_PAGE_IDS_PLAIN) {
    out[id] = {
      body: typeof fromApi?.[id]?.body === "string" ? fromApi[id].body : "",
    };
  }
  return out;
}

export default function CmsPage() {
  const { user, logout } = useAuth();
  const canWrite = hasPermission(user?.role, "cms:write");

  const bannersQuery = useHomeHeroBannersQuery();
  const bannersMutation = useUpdateHomeHeroBannersMutation();
  const [urls, setUrls] = useState([]);
  const [bannerError, setBannerError] = useState("");
  const [bannerSaved, setBannerSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const contactLogoRef = useRef(null);
  const [contactLogoRowIdx, setContactLogoRowIdx] = useState(null);
  const [contactUploadingIdx, setContactUploadingIdx] = useState(null);

  const infoQuery = usePlayerInfoPagesQuery();
  const infoMutation = useUpdatePlayerInfoPagesMutation();
  const brandingQuery = usePlayerSiteBrandingQuery();
  const brandingMutation = useUpdatePlayerSiteBrandingMutation();
  const [mainTab, setMainTab] = useState("banners");
  const [infoTabId, setInfoTabId] = useState(INFO_PAGE_DEFS[0].id);
  const [draftPages, setDraftPages] = useState(() =>
    normalizeInfoPagesDraft({}),
  );
  const [infoError, setInfoError] = useState("");
  const [infoSaved, setInfoSaved] = useState(false);

  const [draftBranding, setDraftBranding] = useState({
    navbarWide: "",
    navbarCompact: "",
    loadingLogo: "",
  });
  const [brandingError, setBrandingError] = useState("");
  const [brandingSaved, setBrandingSaved] = useState(false);
  const brandingFileRef = useRef(null);
  const [brandingPickKey, setBrandingPickKey] = useState(null);
  const [brandingUploadingKey, setBrandingUploadingKey] = useState(null);

  useEffect(() => {
    if (Array.isArray(bannersQuery.data?.urls)) {
      setUrls(bannersQuery.data.urls);
    }
  }, [bannersQuery.data?.urls]);

  useEffect(() => {
    if (infoQuery.data?.pages && typeof infoQuery.data.pages === "object") {
      setDraftPages(normalizeInfoPagesDraft(infoQuery.data.pages));
    }
  }, [infoQuery.data?.pages]);

  useEffect(() => {
    const d = brandingQuery.data;
    if (!d || typeof d !== "object") return;
    setDraftBranding({
      navbarWide: typeof d.navbarWide === "string" ? d.navbarWide : "",
      navbarCompact: typeof d.navbarCompact === "string" ? d.navbarCompact : "",
      loadingLogo: typeof d.loadingLogo === "string" ? d.loadingLogo : "",
    });
  }, [brandingQuery.data]);

  async function handlePickFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !canWrite) return;
    if (urls.length >= MAX_BANNERS) {
      setBannerError(
        `At most ${MAX_BANNERS} images. Remove one to add another.`,
      );
      return;
    }
    setBannerError("");
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const { imageUrl } = await apiUpload("/admin/upload/image", fd);
      if (typeof imageUrl !== "string" || !imageUrl.startsWith("https://")) {
        throw new Error("Invalid response from upload");
      }
      setUrls((prev) => [...prev, imageUrl]);
    } catch (err) {
      setBannerError(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function move(idx, delta) {
    const next = idx + delta;
    if (next < 0 || next >= urls.length) return;
    setUrls((prev) => {
      const copy = [...prev];
      const t = copy[idx];
      copy[idx] = copy[next];
      copy[next] = t;
      return copy;
    });
  }

  function removeAt(idx) {
    setUrls((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSaveBanners(e) {
    e.preventDefault();
    setBannerError("");
    setBannerSaved(false);
    try {
      await bannersMutation.mutateAsync(urls);
      setBannerSaved(true);
      setTimeout(() => setBannerSaved(false), 2500);
    } catch (err) {
      setBannerError(err.message || "Failed to save");
    }
  }

  function setDraftBody(pageId, body) {
    setDraftPages((prev) => ({
      ...prev,
      [pageId]: { body },
    }));
  }

  function updateFaqItem(index, patch) {
    setDraftPages((prev) => {
      const items = [...(prev.faq?.items ?? [])];
      if (!items[index]) return prev;
      items[index] = { ...items[index], ...patch };
      return { ...prev, faq: { items } };
    });
  }

  function addFaqRow() {
    setDraftPages((prev) => ({
      ...prev,
      faq: {
        items: [...(prev.faq?.items ?? []), { question: "", answer: "" }],
      },
    }));
  }

  function removeFaqRow(index) {
    setDraftPages((prev) => {
      const items = (prev.faq?.items ?? []).filter((_, i) => i !== index);
      return { ...prev, faq: { items } };
    });
  }

  function moveFaqRow(index, delta) {
    const next = index + delta;
    setDraftPages((prev) => {
      const items = [...(prev.faq?.items ?? [])];
      if (next < 0 || next >= items.length) return prev;
      const t = items[index];
      items[index] = items[next];
      items[next] = t;
      return { ...prev, faq: { items } };
    });
  }

  function updateContactEntry(index, patch) {
    setDraftPages((prev) => {
      const entries = [...(prev[CONTACT_PAGE_ID]?.entries ?? [])];
      if (!entries[index]) return prev;
      entries[index] = { ...entries[index], ...patch };
      return { ...prev, [CONTACT_PAGE_ID]: { entries } };
    });
  }

  function addContactRow() {
    setDraftPages((prev) => ({
      ...prev,
      [CONTACT_PAGE_ID]: {
        entries: [
          ...(prev[CONTACT_PAGE_ID]?.entries ?? []),
          { logo: "", name: "", link: "" },
        ],
      },
    }));
  }

  function removeContactRow(index) {
    setDraftPages((prev) => {
      const entries = (prev[CONTACT_PAGE_ID]?.entries ?? []).filter(
        (_, i) => i !== index,
      );
      return { ...prev, [CONTACT_PAGE_ID]: { entries } };
    });
  }

  function pickContactLogoRow(index) {
    setContactLogoRowIdx(index);
    queueMicrotask(() => contactLogoRef.current?.click());
  }

  async function handleContactLogoFile(e) {
    const file = e.target.files?.[0];
    const idx = contactLogoRowIdx;
    e.target.value = "";
    if (!file || idx == null || !canWrite) {
      setContactLogoRowIdx(null);
      return;
    }
    setContactLogoRowIdx(null);
    setContactUploadingIdx(idx);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const { imageUrl } = await apiUpload("/admin/upload/image", fd);
      if (typeof imageUrl !== "string" || !imageUrl.startsWith("https://")) {
        throw new Error("Invalid response from upload");
      }
      updateContactEntry(idx, { logo: imageUrl });
    } finally {
      setContactUploadingIdx(null);
    }
  }

  async function handleSaveInfo(e) {
    e.preventDefault();
    setInfoError("");
    setInfoSaved(false);
    try {
      await infoMutation.mutateAsync(draftPages);
      setInfoSaved(true);
      setTimeout(() => setInfoSaved(false), 2500);
    } catch (err) {
      setInfoError(err.message || "Failed to save");
    }
  }

  async function handleBrandingFile(e) {
    const file = e.target.files?.[0];
    const key = brandingPickKey;
    e.target.value = "";
    if (!file || !key || !canWrite) {
      setBrandingPickKey(null);
      return;
    }
    setBrandingPickKey(null);
    setBrandingUploadingKey(key);
    setBrandingError("");
    try {
      const fd = new FormData();
      fd.append("image", file);
      const { imageUrl } = await apiUpload("/admin/upload/image", fd);
      if (typeof imageUrl !== "string" || !imageUrl.startsWith("https://")) {
        throw new Error("Invalid response from upload");
      }
      setDraftBranding((prev) => ({ ...prev, [key]: imageUrl }));
    } catch (err) {
      setBrandingError(err.message || "Upload failed");
    } finally {
      setBrandingUploadingKey(null);
    }
  }

  function clearBrandingField(key) {
    setDraftBranding((prev) => ({ ...prev, [key]: "" }));
  }

  async function handleSaveBranding(e) {
    e.preventDefault();
    setBrandingError("");
    setBrandingSaved(false);
    try {
      await brandingMutation.mutateAsync({
        navbarWide: draftBranding.navbarWide.trim(),
        navbarCompact: draftBranding.navbarCompact.trim(),
        loadingLogo: draftBranding.loadingLogo.trim(),
      });
      setBrandingSaved(true);
      setTimeout(() => setBrandingSaved(false), 2500);
    } catch (err) {
      setBrandingError(err.message || "Failed to save");
    }
  }

  return (
    <AdminShell user={user} onLogout={logout}>
      <div className="mb-6">
        <h2 className="text-xl font-semibold">CMS</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Manage the player site banner carousel (1080×300 recommended), header
          and loading logos, and sidebar articles (FAQ, legal, contact). Up to{" "}
          {MAX_BANNERS} banner slides.
        </p>
      </div>

      <div className="mb-4 flex border-b border-[var(--border)]">
        {CMS_MAIN_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setMainTab(tab.key)}
            className={`border-b-2 px-4 py-2.5 text-sm font-semibold ${
              mainTab === tab.key
                ? "border-[var(--accent)] text-[var(--accent)]"
                : "border-transparent text-[var(--muted)]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {mainTab === "banners" ? (
        <PanelCard className="p-6">
          <h3 className="text-sm font-semibold uppercase tracking-wide">
            Home hero banners
          </h3>
          {bannersQuery.isLoading ? (
            <p className="mt-4 text-sm text-[var(--muted)]">Loading...</p>
          ) : bannersQuery.isError ? (
            <p className="mt-4 text-sm text-[var(--danger)]">
              {bannersQuery.error?.message || "Failed to load banners"}
            </p>
          ) : (
            <form onSubmit={handleSaveBanners} className="mt-4 space-y-4">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handlePickFile}
                disabled={!canWrite || uploading}
              />
              <div className="flex flex-wrap items-center gap-3">
                <PrimaryButton
                  type="button"
                  disabled={
                    !canWrite ||
                    uploading ||
                    bannersMutation.isPending ||
                    urls.length >= MAX_BANNERS
                  }
                  onClick={() => fileRef.current?.click()}
                >
                  {uploading ? "Uploading…" : "Upload image"}
                </PrimaryButton>
                {!bannersQuery.data?.configuredInDatabase &&
                urls.length === 0 ? (
                  <span className="text-xs text-[var(--muted)]">
                    No banners saved yet — player site will use default images
                    until you save at least one URL.
                  </span>
                ) : null}
              </div>

              {urls.length > 0 ? (
                <ul className="space-y-3">
                  {urls.map((url, idx) => (
                    <li
                      key={`${url}-${idx}`}
                      className="flex flex-wrap items-start gap-3 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-3"
                    >
                      <img
                        src={url}
                        alt=""
                        className="h-20 w-40 shrink-0 rounded object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="break-all font-mono text-xs text-[var(--muted)]">
                          {url}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={!canWrite || idx === 0}
                            className="text-xs font-semibold uppercase tracking-wide text-[var(--accent)] disabled:opacity-40"
                            onClick={() => move(idx, -1)}
                          >
                            Up
                          </button>
                          <button
                            type="button"
                            disabled={!canWrite || idx === urls.length - 1}
                            className="text-xs font-semibold uppercase tracking-wide text-[var(--accent)] disabled:opacity-40"
                            onClick={() => move(idx, 1)}
                          >
                            Down
                          </button>
                          <button
                            type="button"
                            disabled={!canWrite}
                            className="text-xs font-semibold uppercase tracking-wide text-[var(--danger)] disabled:opacity-40"
                            onClick={() => removeAt(idx)}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-[var(--muted)]">
                  No images in the list. Upload to add slides (order = rotation
                  order).
                </p>
              )}

              {bannerError ? (
                <p className="text-sm text-[var(--danger)]">{bannerError}</p>
              ) : null}
              {bannerSaved ? (
                <p className="text-sm text-[var(--success,#22c55e)]">Saved.</p>
              ) : null}

              <div className="flex flex-wrap gap-3 pt-2">
                <PrimaryButton
                  type="submit"
                  disabled={!canWrite || bannersMutation.isPending}
                >
                  {bannersMutation.isPending ? "Saving…" : "Save to platform"}
                </PrimaryButton>
              </div>
            </form>
          )}
        </PanelCard>
      ) : mainTab === "branding" ? (
        <PanelCard className="p-6">
          <h3 className="text-sm font-semibold uppercase tracking-wide">
            Site branding
          </h3>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Desktop navbar uses the wide logo at large breakpoints; smaller
            screens use the compact logo. Loading overlay is only replaced when
            you upload a dedicated image below; otherwise the player site keeps
            its default loader asset.
          </p>
          {brandingQuery.isLoading ? (
            <p className="mt-4 text-sm text-[var(--muted)]">Loading...</p>
          ) : brandingQuery.isError ? (
            <p className="mt-4 text-sm text-[var(--danger)]">
              {brandingQuery.error?.message || "Failed to load branding"}
            </p>
          ) : (
            <form onSubmit={handleSaveBranding} className="mt-4 space-y-6">
              <input
                ref={brandingFileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleBrandingFile}
                disabled={!canWrite || brandingUploadingKey !== null}
              />

              {[
                {
                  key: "navbarWide",
                  label: "Navbar logo — desktop (wide)",
                },
                {
                  key: "navbarCompact",
                  label: "Navbar logo — mobile / compact",
                },
                {
                  key: "loadingLogo",
                  label: "Home loading overlay",
                },
              ].map(({ key, label }) => (
                <div
                  key={key}
                  className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-4"
                >
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--text)]">
                    {label}
                  </h4>
                  <div className="mt-3 flex flex-wrap items-start gap-3">
                    {draftBranding[key] ? (
                      <img
                        src={draftBranding[key]}
                        alt=""
                        className="h-16 max-w-[200px] shrink-0 rounded object-contain"
                      />
                    ) : (
                      <div className="flex h-16 min-w-[120px] items-center justify-center rounded border border-dashed border-[var(--border)] bg-[var(--surface)] px-3 text-xs text-[var(--muted)]">
                        Default (bundled)
                      </div>
                    )}
                    <div className="min-w-0 flex-1 space-y-2">
                      {draftBranding[key] ? (
                        <p className="break-all font-mono text-xs text-[var(--muted)]">
                          {draftBranding[key]}
                        </p>
                      ) : null}
                      <div className="flex flex-wrap gap-2">
                        <PrimaryButton
                          type="button"
                          disabled={
                            !canWrite ||
                            brandingMutation.isPending ||
                            brandingUploadingKey !== null
                          }
                          onClick={() => {
                            setBrandingPickKey(key);
                            brandingFileRef.current?.click();
                          }}
                        >
                          {brandingUploadingKey === key
                            ? "Uploading…"
                            : "Upload image"}
                        </PrimaryButton>
                        <button
                          type="button"
                          disabled={
                            !canWrite ||
                            !draftBranding[key] ||
                            brandingUploadingKey !== null
                          }
                          className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--danger)] disabled:opacity-40"
                          onClick={() => clearBrandingField(key)}
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {!brandingQuery.data?.configuredInDatabase &&
              !draftBranding.navbarWide &&
              !draftBranding.navbarCompact &&
              !draftBranding.loadingLogo ? (
                <span className="text-xs text-[var(--muted)]">
                  No branding saved yet — player site uses default logos until
                  you save at least one image URL.
                </span>
              ) : null}

              {brandingError ? (
                <p className="text-sm text-[var(--danger)]">{brandingError}</p>
              ) : null}
              {brandingSaved ? (
                <p className="text-sm text-[var(--success,#22c55e)]">Saved.</p>
              ) : null}

              <div className="flex flex-wrap gap-3 pt-2">
                <PrimaryButton
                  type="submit"
                  disabled={!canWrite || brandingMutation.isPending}
                >
                  {brandingMutation.isPending ? "Saving…" : "Save to platform"}
                </PrimaryButton>
              </div>
            </form>
          )}
        </PanelCard>
      ) : mainTab === "messages" ? (
        <CmsMessagesPanel canWrite={canWrite} />
      ) : (
        <PanelCard className="p-6">
          <h3 className="text-sm font-semibold uppercase tracking-wide">
            Player site info pages
          </h3>
          <p className="mt-1 text-xs text-[var(--muted)]">
            FAQ uses question/answer pairs. Contact rows need an https logo URL,
            social name, and link. Plain text pages preserve line breaks. All
            categories save together.
          </p>

          {infoQuery.isLoading ? (
            <p className="mt-4 text-sm text-[var(--muted)]">Loading...</p>
          ) : infoQuery.isError ? (
            <p className="mt-4 text-sm text-[var(--danger)]">
              {infoQuery.error?.message || "Failed to load info pages"}
            </p>
          ) : (
            <form onSubmit={handleSaveInfo} className="mt-4 space-y-4">
              <input
                ref={contactLogoRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleContactLogoFile}
                disabled={!canWrite || contactUploadingIdx !== null}
              />

              <div className="flex flex-wrap gap-1 border-b border-[var(--border)] pb-2">
                {INFO_PAGE_DEFS.map((def) => (
                  <button
                    key={def.id}
                    type="button"
                    onClick={() => setInfoTabId(def.id)}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                      infoTabId === def.id
                        ? "bg-[var(--accent)] text-white"
                        : "text-[var(--muted)] hover:bg-[var(--panel-2)]"
                    }`}
                  >
                    {def.label}
                  </button>
                ))}
              </div>

              {infoTabId === FAQ_PAGE_ID ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <PrimaryButton
                      type="button"
                      disabled={!canWrite}
                      onClick={addFaqRow}
                    >
                      Add question
                    </PrimaryButton>
                    <span className="text-xs text-[var(--muted)]">
                      Empty pairs are omitted on save. Each saved pair requires
                      both fields.
                    </span>
                  </div>
                  {(draftPages.faq?.items ?? []).length === 0 ? (
                    <p className="text-sm text-[var(--muted)]">
                      No FAQ rows yet.
                    </p>
                  ) : (
                    <ul className="space-y-4">
                      {(draftPages.faq?.items ?? []).map((row, idx) => (
                        <li
                          key={`faq-${idx}`}
                          className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-4"
                        >
                          <div className="mb-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={!canWrite || idx === 0}
                              className="text-xs font-semibold uppercase tracking-wide text-[var(--accent)] disabled:opacity-40"
                              onClick={() => moveFaqRow(idx, -1)}
                            >
                              Up
                            </button>
                            <button
                              type="button"
                              disabled={
                                !canWrite ||
                                idx === (draftPages.faq?.items ?? []).length - 1
                              }
                              className="text-xs font-semibold uppercase tracking-wide text-[var(--accent)] disabled:opacity-40"
                              onClick={() => moveFaqRow(idx, 1)}
                            >
                              Down
                            </button>
                            <button
                              type="button"
                              disabled={!canWrite}
                              className="text-xs font-semibold uppercase tracking-wide text-[var(--danger)] disabled:opacity-40"
                              onClick={() => removeFaqRow(idx)}
                            >
                              Remove
                            </button>
                          </div>
                          <label className="mb-3 block">
                            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                              Question
                            </span>
                            <input
                              type="text"
                              value={row.question}
                              onChange={(e) =>
                                updateFaqItem(idx, { question: e.target.value })
                              }
                              disabled={!canWrite}
                              className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
                            />
                          </label>
                          <label className="block">
                            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                              Answer
                            </span>
                            <textarea
                              value={row.answer}
                              onChange={(e) =>
                                updateFaqItem(idx, { answer: e.target.value })
                              }
                              disabled={!canWrite}
                              rows={5}
                              className="w-full resize-y rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 font-mono text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
                            />
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : infoTabId === CONTACT_PAGE_ID ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <PrimaryButton
                      type="button"
                      disabled={!canWrite}
                      onClick={addContactRow}
                    >
                      Add social link
                    </PrimaryButton>
                    <span className="text-xs text-[var(--muted)]">
                      Logo uploads use the image CDN (https URL). Rows need all
                      three fields to save.
                    </span>
                  </div>
                  {(draftPages[CONTACT_PAGE_ID]?.entries ?? []).length === 0 ? (
                    <p className="text-sm text-[var(--muted)]">
                      No contacts yet.
                    </p>
                  ) : (
                    <ul className="space-y-4">
                      {(draftPages[CONTACT_PAGE_ID]?.entries ?? []).map(
                        (row, idx) => (
                          <li
                            key={`ct-${idx}`}
                            className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-4"
                          >
                            <div className="mb-3 flex flex-wrap gap-3">
                              {row.logo ? (
                                <img
                                  src={row.logo}
                                  alt=""
                                  className="h-14 w-14 shrink-0 rounded object-cover ring-1 ring-[var(--border)]"
                                />
                              ) : (
                                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded bg-[var(--surface)] text-[10px] text-[var(--muted)] ring-1 ring-[var(--border)]">
                                  No logo
                                </div>
                              )}
                              <PrimaryButton
                                type="button"
                                disabled={
                                  !canWrite || contactUploadingIdx !== null
                                }
                                onClick={() => pickContactLogoRow(idx)}
                              >
                                {contactUploadingIdx === idx
                                  ? "Uploading…"
                                  : "Upload logo"}
                              </PrimaryButton>
                              <button
                                type="button"
                                disabled={!canWrite}
                                className="self-center text-xs font-semibold uppercase tracking-wide text-[var(--danger)] disabled:opacity-40"
                                onClick={() => removeContactRow(idx)}
                              >
                                Remove row
                              </button>
                            </div>
                            <label className="mb-3 block">
                              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                                Logo URL (https)
                              </span>
                              <input
                                type="url"
                                value={row.logo}
                                onChange={(e) =>
                                  updateContactEntry(idx, {
                                    logo: e.target.value,
                                  })
                                }
                                disabled={!canWrite}
                                placeholder="https://…"
                                className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
                              />
                            </label>
                            <label className="mb-3 block">
                              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                                Social / platform name
                              </span>
                              <input
                                type="text"
                                value={row.name}
                                onChange={(e) =>
                                  updateContactEntry(idx, {
                                    name: e.target.value,
                                  })
                                }
                                disabled={!canWrite}
                                className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
                              />
                            </label>
                            <label className="block">
                              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                                Link (https)
                              </span>
                              <input
                                type="url"
                                value={row.link}
                                onChange={(e) =>
                                  updateContactEntry(idx, {
                                    link: e.target.value,
                                  })
                                }
                                disabled={!canWrite}
                                placeholder="https://…"
                                className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
                              />
                            </label>
                          </li>
                        ),
                      )}
                    </ul>
                  )}
                </div>
              ) : (
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                    Content —{" "}
                    {INFO_PAGE_DEFS.find((d) => d.id === infoTabId)?.label}
                  </span>
                  <textarea
                    value={draftPages[infoTabId]?.body ?? ""}
                    onChange={(e) => setDraftBody(infoTabId, e.target.value)}
                    disabled={!canWrite}
                    rows={16}
                    className="w-full resize-y rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 font-mono text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
                    placeholder="Enter text for this page…"
                  />
                </label>
              )}
              {infoError ? (
                <p className="text-sm text-[var(--danger)]">{infoError}</p>
              ) : null}
              {infoSaved ? (
                <p className="text-sm text-[var(--success,#22c55e)]">Saved.</p>
              ) : null}

              <div className="flex flex-wrap gap-3 pt-2">
                <PrimaryButton
                  type="submit"
                  disabled={!canWrite || infoMutation.isPending}
                >
                  {infoMutation.isPending ? "Saving…" : "Save all pages"}
                </PrimaryButton>
              </div>
            </form>
          )}
        </PanelCard>
      )}
    </AdminShell>
  );
}
