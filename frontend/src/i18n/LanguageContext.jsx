import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  isAppLanguage,
  LANGUAGE_STORAGE_KEY,
  SUPPORTED_LANGUAGES,
  translate,
} from "./coreTranslations";

/** @typedef {import('./coreTranslations').AppLanguage} AppLanguage */

/** @type {import('react').Context<null | { language: AppLanguage; setLanguage: (l: AppLanguage) => void; toggleLanguage: () => void }>} */
const LanguageContext = createContext(null);

/**
 * @param {{ children: import('react').ReactNode }} props
 */
export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(/** @type {AppLanguage} */ ("en"));

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LANGUAGE_STORAGE_KEY);
      if (raw != null && isAppLanguage(raw)) {
        setLanguageState(raw);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      document.documentElement.lang = language === "am" ? "am" : "en";
    } catch {
      /* ignore */
    }
  }, [language]);

  const setLanguage = useCallback((next) => {
    if (!SUPPORTED_LANGUAGES.includes(next)) return;
    setLanguageState(next);
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguageState((prev) => {
      const next = prev === "en" ? "am" : "en";
      try {
        localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ language, setLanguage, toggleLanguage }),
    [language, setLanguage, toggleLanguage],
  );

  return (
    <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error("useLanguage must be used within LanguageProvider");
  }
  return ctx;
}

/**
 * @returns {{ t: (path: string, fallback?: string) => string; language: AppLanguage }}
 */
export function useTranslation() {
  const { language } = useLanguage();
  const t = useCallback(
    (path, fallback) => translate(language, path, fallback),
    [language],
  );
  return { t, language };
}
