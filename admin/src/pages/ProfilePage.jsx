import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import AdminShell from "../components/layout/AdminShell";
import PanelCard from "../components/ui/PanelCard";
import TextInput from "../components/ui/TextInput";
import PrimaryButton from "../components/ui/PrimaryButton";
import { apiRequest } from "../hook/useApiRequest";
import { PROFILE_CONTACT_EDIT_ROLES } from "../constants/auth";

export default function ProfilePage() {
  const { user, logout, replaceAccessToken } = useAuth();
  const queryClient = useQueryClient();
  const canEditContact = Boolean(
    user && PROFILE_CONTACT_EDIT_ROLES.includes(user.role),
  );

  const [fullname, setFullname] = useState("");
  const [phone, setPhone] = useState("");
  const [contactErr, setContactErr] = useState(null);
  const [contactMsg, setContactMsg] = useState(null);
  const [contactSaving, setContactSaving] = useState(false);

  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwdErr, setPwdErr] = useState(null);
  const [pwdMsg, setPwdMsg] = useState(null);
  const [pwdSaving, setPwdSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    setFullname(user.fullname ?? "");
    setPhone(user.phone ?? "");
    setContactErr(null);
    setContactMsg(null);
  }, [user?.id, user?.fullname, user?.phone]);

  async function handleSaveContact(e) {
    e.preventDefault();
    if (!canEditContact) return;
    setContactErr(null);
    setContactMsg(null);
    setContactSaving(true);
    try {
      const data = await apiRequest("/auth/profile", {
        method: "PATCH",
        body: JSON.stringify({ fullname, phone }),
      });
      if (data.accessToken) {
        replaceAccessToken(data.accessToken);
      } else {
        await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      }
      setContactMsg("Saved.");
    } catch (err) {
      setContactErr(err.message || "Failed to save");
    } finally {
      setContactSaving(false);
    }
  }

  async function handleChangePassword(e) {
    e.preventDefault();
    setPwdErr(null);
    setPwdMsg(null);
    if (!oldPassword || !newPassword || !confirmPassword) {
      setPwdErr("All fields are required.");
      return;
    }
    if (newPassword.length < 6) {
      setPwdErr("New password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwdErr("Passwords do not match.");
      return;
    }
    setPwdSaving(true);
    try {
      await apiRequest("/auth/change-password", {
        method: "PATCH",
        body: JSON.stringify({
          oldPassword,
          newPassword,
          confirmPassword,
        }),
      });
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPwdMsg("Password updated.");
    } catch (err) {
      setPwdErr(err.message || "Failed to change password");
    } finally {
      setPwdSaving(false);
    }
  }

  return (
    <AdminShell user={user} onLogout={logout}>
      <div className="mx-auto max-w-md">
        <h2 className="mb-6 text-xl font-semibold">Your profile</h2>
        <PanelCard className="p-6">
          <div className="space-y-6">
            <form onSubmit={handleSaveContact} className="space-y-4">
              <TextInput
                label="Username"
                value={user?.username ?? ""}
                readOnly
                disabled
              />
              <TextInput
                label="Full name"
                value={fullname}
                onChange={(e) => setFullname(e.target.value)}
                readOnly={!canEditContact}
                disabled={!canEditContact}
              />
              <TextInput
                label="Phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                readOnly={!canEditContact}
                disabled={!canEditContact}
              />
              {contactErr && (
                <div className="rounded-sm border border-[color:var(--dangerSoft)] bg-[color:var(--dangerSurface)] px-3 py-2 text-sm text-[var(--danger)]">
                  {contactErr}
                </div>
              )}
              {contactMsg && (
                <p className="text-sm text-[var(--muted)]">{contactMsg}</p>
              )}
              {canEditContact && (
                <PrimaryButton type="submit" disabled={contactSaving}>
                  {contactSaving ? "Saving…" : "Save name & phone"}
                </PrimaryButton>
              )}
            </form>

            <div className="border-t border-[var(--border)] pt-6">
              <h3 className="mb-4 text-sm font-semibold text-[var(--text)]">
                Change password
              </h3>
              <form onSubmit={handleChangePassword} className="space-y-4">
                <TextInput
                  label="Current password"
                  type="password"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  autoComplete="current-password"
                />
                <TextInput
                  label="New password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                />
                <TextInput
                  label="Confirm new password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                />
                {pwdErr && (
                  <div className="rounded-sm border border-[color:var(--dangerSoft)] bg-[color:var(--dangerSurface)] px-3 py-2 text-sm text-[var(--danger)]">
                    {pwdErr}
                  </div>
                )}
                {pwdMsg && (
                  <p className="text-sm text-[var(--muted)]">{pwdMsg}</p>
                )}
                <PrimaryButton type="submit" disabled={pwdSaving}>
                  {pwdSaving ? "Updating…" : "Update password"}
                </PrimaryButton>
              </form>
            </div>
          </div>
        </PanelCard>
      </div>
    </AdminShell>
  );
}
