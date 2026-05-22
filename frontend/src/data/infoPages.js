/**
 * Player site sidebar /info/:slug entries — must match backend `PLAYER_INFO_PAGE_IDS`
 * order: FAQ → How to play → Privacy Policy → Terms and conditions → Contact Us.
 */
export const INFO_PAGE_SLUG_ORDER = [
  "faq",
  "how-to-play",
  "privacy-policy",
  "terms-and-conditions",
  "contact-us",
];

const LABEL_BY_SLUG = Object.freeze({
  faq: "FAQ",
  "how-to-play": "How to play",
  "privacy-policy": "Privacy Policy",
  "terms-and-conditions": "Terms and conditions",
  "contact-us": "Contact Us",
});

export const INFO_PAGES = INFO_PAGE_SLUG_ORDER.map((slug) => ({
  slug,
  label: LABEL_BY_SLUG[slug],
}));

const SLUG_SET = new Set(INFO_PAGE_SLUG_ORDER);

export function isValidInfoPageSlug(slug) {
  return typeof slug === "string" && SLUG_SET.has(slug);
}

export function infoPageLabelForSlug(slug) {
  return (typeof slug === "string" && LABEL_BY_SLUG[slug]) || "Info";
}

export const FAQ_PAGE_SLUG = "faq";
export const CONTACT_PAGE_SLUG = "contact-us";
