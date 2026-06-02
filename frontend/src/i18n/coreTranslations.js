/** @typedef {'en' | 'am'} AppLanguage */

export const LANGUAGE_STORAGE_KEY = "sokasport_ui_lang";

export const SUPPORTED_LANGUAGES = /** @type {const} */ (["en", "am"]);

/**
 * @param {unknown} value
 * @returns {value is AppLanguage}
 */
export function isAppLanguage(value) {
  return value === "en" || value === "am";
}

/**
 * Nested translation maps for core UI (EN / አማርኛ).
 * Keys use dot notation in `t('segment.key')`.
 */
export const translations = Object.freeze({
  en: Object.freeze({
    nav: Object.freeze({
      home: "HOME",
      live: "LIVE",
      games: "GAMES",
    }),
    header: Object.freeze({
      searchPlaceholder: "Search events",
      searchAria: "Search",
      deposit: "DEPOSIT",
      login: "LOGIN",
      register: "REGISTER",
      telegram: "Telegram",
      languageMenu: "Language",
      langEnglish: "English — United Kingdom",
      langAmharic: "አማርኛ — Ethiopia",
      notifications: "Notifications",
    }),
    notifications: Object.freeze({
      title: "Notifications",
      loading: "Loading…",
      empty: "No notifications yet.",
      markAllRead: "Mark all read",
      new: "New",
    }),
    common: Object.freeze({
      close: "Close",
      closeMenu: "Close menu",
      accountMenu: "Account menu",
      helpLegalNav: "Help and legal",
      clear: "Clear",
      goToNextDay: "Show fixtures for",
    }),
    matches: Object.freeze({
      prev: "Previous",
      next: "Next",
      pageOf: "Page {page} of {total}",
    }),
    menu: Object.freeze({
      title: "Menu",
      accountTitle: "Account",
      betHistory: "Bet history",
      deposit: "Deposit",
      withdraw: "Withdraw",
      transactionHistory: "Transaction history",
      checkTicket: "Check ticket",
      profile: "Profile",
      signOut: "Sign out",
      messages: "Messages",
      myProfile: "My profile",
      myBets: "My bets",
      balance: "Balance",
      transaction: "Transaction",
    }),
    mobileBar: Object.freeze({
      home: "Home",
      virtual: "Virtual",
      slip: "Slip",
      promotion: "Promotion",
      contact: "Contact Us",
    }),
    sidebar: Object.freeze({
      infoSection: "Info",
      searchClubsPlaceholder: "Search clubs…",
      searchButton: "Search",
      searchClubsAria: "Search by club name",
      filterByTime: "Filter by time",
      dateWithGames: "Date (with games)",
      pickDate: "Pick date",
      pickDateAria: "Select a day from the list",
      noFixtures: "No fixtures",
      selectDay: "Select day…",
    }),
    time: Object.freeze({
      today: "Today",
      tomorrow: "Tomorrow",
      hour1h: "1H",
      hour3h: "3H",
      hour12h: "12H",
    }),
    days: Object.freeze({
      sun: "Sun",
      mon: "Mon",
      tue: "Tue",
      wed: "Wed",
      thu: "Thu",
      fri: "Fri",
      sat: "Sat",
    }),
    infoPage: Object.freeze({
      faq: "FAQ",
      "how-to-play": "How to play",
      "privacy-policy": "Privacy Policy",
      "terms-and-conditions": "Terms and conditions",
      "contact-us": "Contact Us",
    }),
    article: Object.freeze({
      backHome: "Back to home",
      loading: "Loading…",
      emptyTopic: "No content published yet for this topic.",
    }),
  }),
  am: Object.freeze({
    nav: Object.freeze({
      home: "መነሻ",
      live: "ቀጥታ",
      games: "ጨዋታዎች",
    }),
    header: Object.freeze({
      searchPlaceholder: "ክስተቶችን ፈልግ",
      searchAria: "ፈልግ",
      deposit: "ዲፖዚት",
      login: "ግባ",
      register: "ይመዝገቡ",
      telegram: "ቴሌግራም",
      languageMenu: "ቋንቋ",
      langEnglish: "እንግሊዝኛ — ዩናይትድ ኪንግደም",
      langAmharic: "አማርኛ — ኢትዮጵያ",
      notifications: "ማሳወቂያዎች",
    }),
    notifications: Object.freeze({
      title: "ማሳወቂያዎች",
      loading: "በመጫን ላይ…",
      empty: "እስካሁን ማሳወቂያ የለም።",
      markAllRead: "ሁሉንም እንደተነበበ ምልክት አድርግ",
      new: "አዲስ",
    }),
    common: Object.freeze({
      close: "ዝጋ",
      closeMenu: "ምናሌ ዝጋ",
      accountMenu: "መለያ ምናሌ",
      helpLegalNav: "እገዛ እና ህጎች",
      clear: "አጽዳ",
      goToNextDay: "ለዚህ ቀን ጨዋታዎችን አሳይ",
    }),
    matches: Object.freeze({
      prev: "ቀዳሚ",
      next: "ቀጣይ",
      pageOf: "ገጽ {page} ከ {total}",
    }),
    menu: Object.freeze({
      title: "ምናሌ",
      accountTitle: "መለያ",
      betHistory: "የውርርዶች ታሪክ",
      deposit: "ዲፖዚት",
      withdraw: "ገንዘብ ማማውጣት",
      transactionHistory: "ግብይት ታሪክ",
      checkTicket: "ቲኬት ይፈትሹ",
      profile: "መገለጫ",
      signOut: "ውጣ",
      messages: "መልዕክቶች",
      myProfile: "የእኔ መገለጫ",
      myBets: "የእኔ ውርርዶች",
      balance: "ባላንስ",
      transaction: "ግብይት",
    }),
    mobileBar: Object.freeze({
      home: "መነሻ",
      virtual: "ቨርቹዋል",
      slip: "ቁራጭ",
      promotion: "ማስተዋወቂያ",
      contact: "እኛን ያግኙ",
    }),
    sidebar: Object.freeze({
      infoSection: "መረጃ",
      searchClubsPlaceholder: "ክለቦችን ፈልግ…",
      searchButton: "ፈልግ",
      searchClubsAria: "በክለብ ስም ፈልግ",
      filterByTime: "ጊዜ ማጣሪያ",
      dateWithGames: "ቀን (ጨዋታ ያለበት)",
      noFixtures: "ጨዋታ የለም",
      selectDay: "ቀን ይምረጡ…",
    }),
    time: Object.freeze({
      today: "ዛሬ",
      tomorrow: "ነገ",
      hour1h: "1H",
      hour3h: "3H",
      hour12h: "12H",
    }),
    days: Object.freeze({
      sun: "እሑድ",
      mon: "ሰኞ",
      tue: "ማክሰኞ",
      wed: "ረቡዕ",
      thu: "ሐሙስ",
      fri: "አርብ",
      sat: "ቅዳሜ",
    }),
    infoPage: Object.freeze({
      faq: "ተደጋጋሚ ጥያቄዎች",
      "how-to-play": "እንዴት ይጫወታል",
      "privacy-policy": "የግላዊነት ፖሊሲ",
      "terms-and-conditions": "ውሎች እና ሁኔታዎች",
      "contact-us": "እኛን ያግኙ",
    }),
    article: Object.freeze({
      backHome: "ወደ መነሻ ተመለስ",
      loading: "በመጫን ላይ…",
      emptyTopic: "ለዚህ ርዕስ እስካሁን ይዘት የለም።",
    }),
  }),
});

/**
 * Label for sportsbook time/calendar options (see `labelKey` from `buildSportsbookTimeOptions`).
 *
 * @param {{ label?: string, labelKey?: string | null }} [option]
 * @param {(path: string, fallback?: string) => string} t
 * @returns {string}
 */
export function timeOptionDisplayLabel(option, t) {
  if (!option) return "";
  if (option.labelKey) return t(option.labelKey, option.label ?? "");
  return option.label ?? "";
}

/**
 * @param {Record<string, unknown>} obj
 * @param {string} path dot-separated
 * @returns {string | undefined}
 */
function getByPath(obj, path) {
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object" || !(p in cur)) return undefined;
    cur = /** @type {Record<string, unknown>} */ (cur)[p];
  }
  return typeof cur === "string" ? cur : undefined;
}

/**
 * @param {AppLanguage} lang
 * @param {string} path
 * @param {string} [fallback]
 * @returns {string}
 */
export function translate(lang, path, fallback = path) {
  const map = translations[lang];
  const enMap = translations.en;
  return getByPath(map, path) ?? getByPath(enMap, path) ?? fallback;
}
