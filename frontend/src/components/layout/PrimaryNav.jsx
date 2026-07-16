import AppIcon from "../common/AppIcon";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "../../i18n/LanguageContext.jsx";

function PrimaryNav({ items }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const launchParam = new URLSearchParams(location.search).get("launch");

  return (
    <nav className="flex w-full items-center justify-center overflow-x-auto border-b border-white/8 bg-(--sb-bg-page) px-1 md:gap-2 max-sm:justify-start">
      {items.map((item) => {
        let isActive = false;
        if (item.launch) {
          isActive =
            location.pathname === "/casino" && launchParam === item.launch;
        } else if (item.id === "games") {
          isActive = location.pathname === "/casino" && !launchParam;
        } else {
          isActive = Boolean(item.path) && location.pathname === item.path;
        }

        return (
          <button
            key={item.id}
            type="button"
            className={`my-2 flex min-w-[78px] shrink-0 cursor-pointer items-center justify-center gap-1 rounded-[14px] border border-transparent bg-transparent px-2 py-1 text-[12px] font-semibold transition-colors ${
              isActive
                ? "text-(--sb-accent-fill)"
                : "text-[rgba(255,255,255,0.72)] hover:text-white"
            }`.trim()}
            onClick={() => {
              if (item.path) navigate(item.path);
            }}
          >
            <span
              className={`inline-flex items-center justify-center ${
                isActive
                  ? "text-(--sb-accent-fill)"
                  : "text-[rgba(255,255,255,0.72)]"
              }`}
            >
              <AppIcon name={item.icon} size={14} />
            </span>
            <span>{t(`nav.${item.id}`)}</span>
          </button>
        );
      })}
    </nav>
  );
}

export default PrimaryNav;
