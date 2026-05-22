import { Link } from "react-router-dom";
import AuthLayout from "../components/layout/AuthLayout";
import PanelCard from "../components/ui/PanelCard";
import PrimaryButton from "../components/ui/PrimaryButton";

export default function UnauthorizedPage() {
  return (
    <AuthLayout>
      <PanelCard className="p-8 text-center">
        <h1 className="mb-2 text-5xl font-bold">403</h1>
        <p className="mb-6 text-sm text-[var(--muted)]">
          You do not have permission to access this page.
        </p>
        <Link to="/login" className="block no-underline">
          <PrimaryButton>Back to Login</PrimaryButton>
        </Link>
      </PanelCard>
    </AuthLayout>
  );
}
