import { useAuth } from "../context/AuthContext";
import AdminDashboardPage from "./admin/DashboardPage";
import FinancialSupportDashboardPage from "./financial_support/DashboardPage";
import AgentDashboardPage from "./agent/DashboardPage";
import CashierDashboardPage from "./cashier/DashboardPage";

const DASHBOARD_BY_ROLE = {
  SUPER_ADMIN: AdminDashboardPage,
  ADMIN: AdminDashboardPage,
  FINANCIAL_SUPPORT: FinancialSupportDashboardPage,
  AGENT: AgentDashboardPage,
  CASHIER: CashierDashboardPage,
};

export default function RoleDashboardPage() {
  const { user } = useAuth();
  const DashboardComponent = DASHBOARD_BY_ROLE[user?.role] || AdminDashboardPage;

  return <DashboardComponent />;
}
