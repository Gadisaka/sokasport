import { useAuth } from "../context/AuthContext";
import AdminShell from "../components/layout/AdminShell";
import PanelCard from "../components/ui/PanelCard";

export default function PlaceholderPage({ title, description }) {
  const { user, logout } = useAuth();

  return (
    <AdminShell user={user} onLogout={logout}>
      <div className="mb-6">
        <h2 className="text-xl font-semibold">{title}</h2>
        {description && (
          <p className="mt-1 text-sm text-[var(--muted)]">{description}</p>
        )}
      </div>
      <PanelCard className="px-6 py-16 text-center">
        <p className="text-sm font-medium text-[var(--muted)]">
          This module is under development.
        </p>
      </PanelCard>
    </AdminShell>
  );
}
