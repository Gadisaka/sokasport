import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import LoginPage from "./pages/LoginPage";
import RoleDashboardPage from "./pages/RoleDashboardPage";
import UsersPage from "./pages/admin/UsersPage";
import SettingsPage from "./pages/admin/SettingsPage";
import OnlineDepositReceiversRedirect from "./pages/admin/OnlineDepositReceiversPage";
import ApiConfigPage from "./pages/admin/ApiConfigPage";
import CashierSettingsPage from "./pages/cashier/SettingsPage";
import CashierWithdrawDepositPage from "./pages/cashier/WithdrawDepositPage";
import AgentsCashiersPage from "./pages/admin/AgentsCashiersPage";
import WalletsPage from "./pages/admin/WalletsPage";
import AuditLogPage from "./pages/admin/AuditLogPage";
import AgentCashiersPage from "./pages/agent/CashiersPage";
import CashierTicketsPage from "./pages/cashier/TicketsPage";
import AgentTicketsPage from "./pages/agent/TicketsPage";
import AgentGamesPage from "./pages/agent/GamesPage";
import AgentReportsPage from "./pages/agent/ReportsPage";
import FinancialSupportReportsPage from "./pages/financial_support/ReportsPage";
import AdminTicketsPage from "./pages/admin/TicketsPage";
import AdminReportsPage from "./pages/admin/ReportsPage";
import AgentDepositWithdrawPage from "./pages/agent/DepositWithdrawPage";
import PlaceholderPage from "./pages/PlaceholderPage";
import CmsPage from "./pages/admin/CmsPage";
import CasinoPage from "./pages/admin/CasinoPage";
import ValidationOpsPage from "./pages/admin/ValidationOpsPage";
import FixtureOpsPage from "./pages/admin/FixtureOpsPage";
import CashierDevicesPage from "./pages/admin/CashierDevicesPage";
import UnauthorizedPage from "./pages/UnauthorizedPage";
import ProfilePage from "./pages/ProfilePage";
import FullPageState from "./components/ui/FullPageState";
import { ADMIN_ALLOWED_ROLES } from "./constants/auth";

const ADMIN_UP = ["SUPER_ADMIN", "ADMIN"];
const SUPER_ONLY = ["SUPER_ADMIN"];

function GuestRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <FullPageState text="Checking session..." />;
  if (user) {
    const to = user.role === "CASHIER" ? "/tickets" : "/";
    return <Navigate to={to} replace />;
  }
  return children;
}

function RoleSettingsPage() {
  const { user } = useAuth();
  if (user?.role === "CASHIER") return <CashierSettingsPage />;
  return <SettingsPage />;
}

function RoleTicketsPage() {
  const { user } = useAuth();
  if (user?.role === "CASHIER") return <CashierTicketsPage />;
  if (user?.role === "AGENT") return <AgentTicketsPage />;
  if (user?.role === "ADMIN" || user?.role === "SUPER_ADMIN")
    return <AdminTicketsPage />;
  return (
    <PlaceholderPage
      title="Tickets"
      description="Search, void, cancel, and payout tickets."
    />
  );
}

function RoleGamesPage() {
  const { user } = useAuth();
  if (user?.role === "AGENT") return <AgentGamesPage />;
  return (
    <PlaceholderPage
      title="Games"
      description="Sports, matches, markets, and odds management."
    />
  );
}

function RoleReportsPage() {
  const { user } = useAuth();
  if (user?.role === "AGENT") return <AgentReportsPage />;
  if (user?.role === "FINANCIAL_SUPPORT")
    return <FinancialSupportReportsPage />;
  if (user?.role === "ADMIN" || user?.role === "SUPER_ADMIN")
    return <AdminReportsPage />;
  return (
    <PlaceholderPage
      title="Reports"
      description="Financial and operational reporting."
    />
  );
}

function RoleDepositWithdrawPage() {
  const { user } = useAuth();
  if (user?.role === "CASHIER") return <CashierWithdrawDepositPage />;
  if (user?.role === "AGENT") return <AgentDepositWithdrawPage />;
  return (
    <PlaceholderPage
      title="Deposit / Withdraw"
      description="Cashier wallet movements."
    />
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route
            path="/login"
            element={
              <GuestRoute>
                <LoginPage />
              </GuestRoute>
            }
          />
          <Route path="/unauthorized" element={<UnauthorizedPage />} />

          {/* Dashboard — all staff */}
          <Route
            path="/"
            element={
              <ProtectedRoute allowedRoles={ADMIN_ALLOWED_ROLES}>
                <RoleDashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile"
            element={
              <ProtectedRoute allowedRoles={ADMIN_ALLOWED_ROLES}>
                <ProfilePage />
              </ProtectedRoute>
            }
          />

          {/* Management */}
          <Route
            path="/users"
            element={
              <ProtectedRoute allowedRoles={ADMIN_UP}>
                <UsersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/agents-cashiers"
            element={
              <ProtectedRoute allowedRoles={ADMIN_UP}>
                <AgentsCashiersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/cashiers"
            element={
              <ProtectedRoute allowedRoles={["AGENT"]}>
                <AgentCashiersPage />
              </ProtectedRoute>
            }
          />

          {/* Operations */}
          <Route
            path="/games"
            element={
              <ProtectedRoute allowedRoles={ADMIN_ALLOWED_ROLES}>
                <RoleGamesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/tickets"
            element={
              <ProtectedRoute allowedRoles={ADMIN_ALLOWED_ROLES}>
                <RoleTicketsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/casino"
            element={
              <ProtectedRoute allowedRoles={ADMIN_UP}>
                <CasinoPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/wallets"
            element={
              <ProtectedRoute
                allowedRoles={["SUPER_ADMIN", "ADMIN", "FINANCIAL_SUPPORT"]}
              >
                <WalletsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/withdraw-deposit"
            element={
              <ProtectedRoute allowedRoles={["CASHIER", "AGENT"]}>
                <RoleDepositWithdrawPage />
              </ProtectedRoute>
            }
          />

          {/* Insights */}
          <Route
            path="/reports"
            element={
              <ProtectedRoute
                allowedRoles={[
                  "SUPER_ADMIN",
                  "ADMIN",
                  "FINANCIAL_SUPPORT",
                  "AGENT",
                ]}
              >
                <RoleReportsPage />
              </ProtectedRoute>
            }
          />

          {/* Content */}
          <Route
            path="/cms"
            element={
              <ProtectedRoute allowedRoles={ADMIN_UP}>
                <CmsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/validation-ops"
            element={
              <ProtectedRoute allowedRoles={ADMIN_UP}>
                <ValidationOpsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/fixture-ops"
            element={
              <ProtectedRoute allowedRoles={ADMIN_UP}>
                <FixtureOpsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/cashier-devices"
            element={
              <ProtectedRoute allowedRoles={ADMIN_UP}>
                <CashierDevicesPage />
              </ProtectedRoute>
            }
          />

          {/* System */}
          <Route
            path="/settings/online-deposit-receivers"
            element={
              <ProtectedRoute allowedRoles={ADMIN_UP}>
                <OnlineDepositReceiversRedirect />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute allowedRoles={[...ADMIN_UP, "CASHIER"]}>
                <RoleSettingsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/api-config"
            element={
              <ProtectedRoute allowedRoles={SUPER_ONLY}>
                <ApiConfigPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/audit-log"
            element={
              <ProtectedRoute allowedRoles={ADMIN_UP}>
                <AuditLogPage />
              </ProtectedRoute>
            }
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
