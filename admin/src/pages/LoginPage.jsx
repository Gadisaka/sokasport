import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import AuthLayout from "../components/layout/AuthLayout";
import PanelCard from "../components/ui/PanelCard";
import TextInput from "../components/ui/TextInput";
import PrimaryButton from "../components/ui/PrimaryButton";
import { getDeviceFingerprint } from "../lib/deviceFingerprint";

export default function LoginPage() {
  const { login, isLoggingIn } = useAuth();
  const navigate = useNavigate();

  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [devicePending, setDevicePending] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setDevicePending(null);

    try {
      const fingerprint = await getDeviceFingerprint();
      const loggedInUser = await login(phone.trim(), password, fingerprint);
      navigate(loggedInUser?.role === "CASHIER" ? "/tickets" : "/", {
        replace: true,
      });
    } catch (err) {
      if (err.code === "DEVICE_APPROVAL_REQUIRED") {
        setDevicePending({
          message: err.message,
          cashierName: err.details?.cashierName,
          cashierPhone: err.details?.cashierPhone,
          pendingId: err.details?.pendingId,
        });
        return;
      }
      setError(err.message || "Login failed");
    }
  }

  if (devicePending) {
    return (
      <AuthLayout>
        <PanelCard className="p-7">
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-bold tracking-tight">
              Device Approval Required
            </h1>
            <p className="mt-3 text-sm text-[var(--muted)]">
              {devicePending.message ||
                "Login from a new device requires admin approval."}
            </p>
          </div>

          <div className="space-y-2 rounded-sm border border-[var(--border)] bg-[var(--surfaceMuted)] px-4 py-3 text-sm">
            {devicePending.cashierName && (
              <p>
                <span className="text-[var(--muted)]">Cashier:</span>{" "}
                {devicePending.cashierName}
              </p>
            )}
            {devicePending.cashierPhone && (
              <p>
                <span className="text-[var(--muted)]">Phone:</span>{" "}
                {devicePending.cashierPhone}
              </p>
            )}
            {devicePending.pendingId && (
              <p>
                <span className="text-[var(--muted)]">Request ID:</span>{" "}
                {devicePending.pendingId}
              </p>
            )}
          </div>

          <p className="mt-4 text-sm text-[var(--muted)]">
            An administrator has been notified. Try signing in again after your
            device is approved.
          </p>

          <PrimaryButton
            type="button"
            className="mt-6 w-full"
            onClick={() => setDevicePending(null)}
          >
            Back to Sign In
          </PrimaryButton>
        </PanelCard>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <form className="space-y-5" onSubmit={handleSubmit}>
        <PanelCard className="p-7">
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-bold tracking-tight">Sokasport</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">Admin Portal</p>
          </div>

          {error && (
            <div className="mb-4 rounded-sm border border-[color:var(--dangerSoft)] bg-[color:var(--dangerSurface)] px-3 py-2 text-sm text-[var(--danger)]">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <TextInput
              label="Phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Enter phone number"
              required
              autoFocus
            />
            <TextInput
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              required
              passwordToggle
              autoComplete="current-password"
            />
            <PrimaryButton type="submit" disabled={isLoggingIn}>
              {isLoggingIn ? "Signing in..." : "Sign In"}
            </PrimaryButton>
          </div>
        </PanelCard>
      </form>
    </AuthLayout>
  );
}
