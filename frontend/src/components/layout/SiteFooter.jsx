import { useState } from "react";
import AppIcon from "../common/AppIcon";

const footerLinks = [
  "About US",
  "Contacts",
  "Rules",
  "Privacy Policy",
  "Cookies Policy",
  "Account Rules",
];

function SiteFooter() {
  const [open, setOpen] = useState(false);

  return (
    <footer className="mt-2 border-t border-white/10 bg-(--sb-bg-page) max-lg:hidden">
      <div className="flex h-2 w-full items-center justify-center bg-(--sb-bg-page)">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="flex h-6 w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-t-md border border-transparent bg-(--sb-bg-2) text-[rgba(255,255,255,0.72)] transition-transform duration-200 hover:scale-110"
        >
          <AppIcon
            name={open ? "chevronDown" : "chevronUp"}
            size={18}
            strokeWidth={2.5}
          />
        </button>
      </div>

      <div
        className={`overflow-hidden bg-(--sb-bg-page) transition-all duration-400 ease-in-out ${
          open ? "max-h-[300px] opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <div className="flex flex-col items-center gap-4 px-4 py-6">
          <div className="flex items-center gap-6">
            <div className="inline-flex flex-col justify-center rounded bg-(--sb-bg-page) px-2 py-1 leading-none">
              <strong className="text-[16px] tracking-[-0.5px] text-(--sb-positive)">
                Sokasport
              </strong>
              <span className="-mt-px text-[15px] font-bold text-(--sb-accent-text-on-dark)">
                Bet
              </span>
            </div>

            <div className="flex flex-col items-center gap-1">
              <h3 className="m-0 text-[15px] font-extrabold text-[#ffffff]">
                Follow Us
              </h3>
              <a
                href="https://t.me/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-[#229ED9] text-white transition-transform duration-200 hover:scale-125"
              >
                <AppIcon name="send" size={16} strokeWidth={2} />
              </a>
            </div>
          </div>

          <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            {footerLinks.map((link) => (
              <a
                key={link}
                href="#"
                className="text-sm font-semibold text-[rgba(255,255,255,0.72)] no-underline transition-colors duration-200 hover:text-[#ffffff]"
              >
                {link}
              </a>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  );
}

export default SiteFooter;
