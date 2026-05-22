export const ADMIN_ALLOWED_ROLES = [
  "SUPER_ADMIN",
  "ADMIN",
  "FINANCIAL_SUPPORT",
  "AGENT",
  "CASHIER",
];

/** Roles that may edit their own name and phone in the admin portal. */
export const PROFILE_CONTACT_EDIT_ROLES = ["ADMIN", "SUPER_ADMIN"];

export const ROLE_LABELS = {
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Admin",
  FINANCIAL_SUPPORT: "Financial Support",
  AGENT: "Agent",
  CASHIER: "Cashier",
};

export const ROLE_DASHBOARD_TEXT = {
  SUPER_ADMIN: "superadmin DashboardPage",
  ADMIN: "admin DashboardPage",
  FINANCIAL_SUPPORT: "financial support DashboardPage",
  AGENT: "agent DashboardPage",
  CASHIER: "cashier DashboardPage",
};
