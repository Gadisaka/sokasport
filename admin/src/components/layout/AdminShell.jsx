import { useState, useRef, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import ThemeToggleButton from "../ui/ThemeToggleButton";
import Tag from "../ui/Tag";
import { ROLE_LABELS } from "../../constants/auth";
import { hasPermission } from "../../lib/permissions";

// ─── Sidebar navigation config ──────────────────────────────────────────────
const NAV_SECTIONS = [
  {
    label: null,
    items: [
      {
        to: "/",
        label: "Dashboard",
        icon: DashboardIcon,
        permission: "dashboard:read",
      },
    ],
  },
  {
    label: "Management",
    items: [
      {
        to: "/users",
        label: "Users",
        icon: UsersIcon,
        permission: "users:read",
      },
      {
        to: "/agents-cashiers",
        label: "Agents & Cashiers",
        icon: AgentCashierIcon,
        permission: "agents-cashiers:read",
      },
      {
        to: "/cashiers",
        label: "Cashiers",
        icon: AgentCashierIcon,
        permission: "cashiers:read",
        excludeRoles: ["SUPER_ADMIN"],
      },
    ],
  },
  {
    label: "Operations",
    items: [
      {
        to: "/games",
        label: "Games",
        icon: GamesIcon,
        permission: "games:read",
      },
      {
        to: "/tickets",
        label: "Tickets",
        icon: TicketsIcon,
        permission: "tickets:read",
      },
      {
        to: "/casino",
        label: "Casino Games",
        icon: GamesIcon,
        permission: "casino:read",
      },
      {
        to: "/withdraw-deposit",
        label: "Deposit/Withdraw",
        icon: WalletsIcon,
        permission: "cashiers:read",
        excludeRoles: ["SUPER_ADMIN"],
      },
      {
        to: "/wallets",
        label: "Wallets",
        icon: WalletsIcon,
        permission: "wallets:read",
      },
    ],
  },
  {
    label: "Insights",
    items: [
      {
        to: "/reports",
        label: "Reports",
        icon: ReportsIcon,
        permission: "reports:read",
      },
      {
        to: "/validation-ops",
        label: "Validation Ops",
        icon: ReportsIcon,
        permission: "tickets:read",
      },
      {
        to: "/fixture-ops",
        label: "Fixture Ops",
        icon: GamesIcon,
        permission: "games:read",
      },
      {
        to: "/cashier-devices",
        label: "Cashier Devices",
        icon: SettingsIcon,
        permission: "devices:pending",
      },
    ],
  },
  {
    label: "Content",
    items: [
      { to: "/cms", label: "CMS", icon: CmsIcon, permission: "cms:read" },
    ],
  },
  {
    label: "System",
    items: [
      {
        to: "/settings",
        label: "Settings",
        icon: SettingsIcon,
        permission: "settings:read",
      },
      {
        to: "/api-config",
        label: "API Config",
        icon: ApiConfigIcon,
        permission: "api-config:read",
      },
      {
        to: "/audit-log",
        label: "Audit Log",
        icon: AuditLogIcon,
        permission: "audit-log:read",
      },
    ],
  },
];

// ─── Component ──────────────────────────────────────────────────────────────
export default function AdminShell({ user, onLogout, children }) {
  const { pathname } = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef(null);

  useEffect(() => {
    function onClick(e) {
      if (profileRef.current && !profileRef.current.contains(e.target)) {
        setProfileOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  let filteredSections = [];
  if (user?.role === "CASHIER") {
    filteredSections = [
      {
        label: null,
        items: [
          { to: "/tickets", label: "Tickets", icon: TicketsIcon },
          {
            to: "/withdraw-deposit",
            label: "Withdraw/Deposit",
            icon: WalletsIcon,
          },
          { to: "/", label: "Dashboard", icon: DashboardIcon },
          { to: "/settings", label: "Settings", icon: SettingsIcon },
          { action: onLogout, label: "Logout", icon: LogoutIcon },
        ],
      },
    ];
  } else {
    filteredSections = NAV_SECTIONS.map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if (
          item.includeRoles?.length &&
          !item.includeRoles.includes(user?.role)
        )
          return false;
        if (item.excludeRoles?.includes(user?.role)) return false;
        return !item.permission || hasPermission(user?.role, item.permission);
      }),
    })).filter((section) => section.items.length > 0);
  }

  function isActive(to) {
    return to === "/" ? pathname === "/" : pathname.startsWith(to);
  }

  return (
    <div className="flex min-h-dvh bg-[var(--bgApp)] text-[var(--text)]">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-[var(--border)] bg-[var(--surface)] transition-transform duration-200 lg:static lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-[var(--border)] px-5">
          <span className="text-base font-bold tracking-tight">Sokasport</span>
          <span className="text-[0.65rem] font-semibold uppercase tracking-widest text-[var(--muted)]">
            Admin
          </span>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {filteredSections.map((section, si) => (
            <div key={si} className={si > 0 ? "mt-5" : ""}>
              {section.label && (
                <p className="mb-1.5 px-2 text-[0.65rem] font-semibold uppercase tracking-widest text-[var(--muted)]">
                  {section.label}
                </p>
              )}
              {section.items.map((item) => {
                const Icon = item.icon;
                if (item.action) {
                  return (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => {
                        setSidebarOpen(false);
                        item.action();
                      }}
                      className="mt-1 flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm font-medium transition-colors text-[var(--danger)] hover:bg-[var(--surfaceMuted)]"
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {item.label}
                    </button>
                  );
                }

                const active = isActive(item.to);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setSidebarOpen(false)}
                    className={`mt-1 flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors ${
                      active
                        ? "bg-[var(--accent)]/10 text-[var(--accent)]"
                        : "text-[var(--muted)] hover:bg-[var(--surfaceMuted)] hover:text-[var(--text)]"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>

      {/* Main column */}
      <div className="flex flex-1 flex-col">
        {/* Top bar */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-4 lg:px-6">
          {/* Left: hamburger (mobile) */}
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="rounded-sm p-1.5 text-[var(--muted)] lg:hidden"
            aria-label="Open menu"
          >
            <HamburgerIcon className="h-5 w-5" />
          </button>

          {/* Spacer so right side stays right on desktop */}
          <div className="hidden lg:block" />

          {/* Right: role tag, theme, profile */}
          <div className="flex items-center gap-2.5">
            <Tag>{ROLE_LABELS[user?.role] || user?.role}</Tag>
            <ThemeToggleButton />

            {/* Profile dropdown */}
            <div ref={profileRef} className="relative">
              <button
                type="button"
                onClick={() => setProfileOpen((v) => !v)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-bold text-white"
                aria-label="Profile menu"
              >
                {(user?.fullname || user?.username || "?")[0].toUpperCase()}
              </button>

              {profileOpen && (
                <div className="absolute right-0 top-full z-50 mt-1.5 w-52 rounded-sm border border-[var(--border)] bg-[var(--surface)] py-1 shadow-lg">
                  <div className="border-b border-[var(--border)] px-4 py-2.5">
                    <p className="text-sm font-medium">{user?.fullname || user?.username}</p>
                    <p className="text-xs text-[var(--muted)]">
                      {ROLE_LABELS[user?.role] || user?.role}
                    </p>
                  </div>
                  <Link
                    to="/profile"
                    onClick={() => setProfileOpen(false)}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-[var(--surfaceMuted)]"
                  >
                    Profile
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      setProfileOpen(false);
                      onLogout();
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--danger)] hover:bg-[var(--surfaceMuted)]"
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto px-4 py-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}

// ─── Icons (inline SVG, 24×24 viewBox, stroke-based) ────────────────────────

function HamburgerIcon({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function DashboardIcon({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </svg>
  );
}

function UsersIcon({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function AgentCashierIcon({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function GamesIcon({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  );
}

function TicketsIcon({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
      <path d="M13 5v2M13 17v2M13 11v2" />
    </svg>
  );
}

function WalletsIcon({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
      <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
    </svg>
  );
}

function ReportsIcon({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 3v18h18" />
      <path d="M18 17V9M13 17V5M8 17v-3" />
    </svg>
  );
}

function CmsIcon({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M2 15s1.5-2 3.5-2 3.5 2 3.5 2" />
      <path d="M2 19s1.5-2 3.5-2 3.5 2 3.5 2" />
    </svg>
  );
}

function SettingsIcon({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function ApiConfigIcon({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 17V7l7-4 7 4v10l-7 4Z" />
      <path d="M11 3v8l7-4" />
      <path d="M11 11l7 4" />
    </svg>
  );
}

function AuditLogIcon({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M16 13H8M16 17H8M10 9H8" />
    </svg>
  );
}

function LogoutIcon({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}
