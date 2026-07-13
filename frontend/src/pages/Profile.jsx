import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import PageContainer from "../components/layout/PageContainer";
import TopHeader from "../components/layout/TopHeader";
import PrimaryNav from "../components/layout/PrimaryNav";
import MobileBottomBar from "../components/layout/MobileBottomBar";
import AppIcon from "../components/common/AppIcon";
import SoftPanel from "../components/common/SoftPanel";
import {
  accountInputCls,
  accountOutlineBtn,
  accountPrimaryBtn,
} from "../components/common/accountFormClasses";
import { topHeaderData, topNavItems } from "../data/homepageData";
import {
  fetchProfile,
  fetchPlayerWallet,
  updateProfile,
  changeAccountPassword,
} from "../services/api";

const insetRow =
  "flex items-center justify-between gap-3 rounded-2xl bg-(--sb-accent-surface-deep)/55 px-4 py-3  transition-colors duration-300";

function Profile() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [balance, setBalance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [fullname, setFullname] = useState("");
  const [phone, setPhone] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState(null);
  const [profileErr, setProfileErr] = useState(null);

  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdMsg, setPwdMsg] = useState(null);
  const [pwdErr, setPwdErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [me, wallet] = await Promise.all([
          fetchProfile(),
          fetchPlayerWallet(),
        ]);
        if (cancelled) return;
        setProfile(me);
        setFullname(me.fullname ?? "");
        setPhone(me.phone ?? "");
        setBalance(wallet === null ? null : Number(wallet.balance ?? 0));
      } catch (e) {
        if (cancelled) return;
        if (e.message === "NOT_LOGGED_IN") {
          navigate("/login");
          return;
        }
        setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const isPlayer = profile?.role === "PLAYER";

  async function handleSaveProfile(e) {
    e.preventDefault();
    setProfileErr(null);
    setProfileMsg(null);
    setProfileSaving(true);
    try {
      const payload = {};
      if (fullname.trim() !== (profile?.fullname ?? "")) payload.fullname = fullname.trim();
      if (isPlayer && phone.trim() !== (profile?.phone ?? "")) {
        payload.phone = phone.trim();
      }
      if (Object.keys(payload).length === 0) {
        setProfileMsg("No changes to save.");
        return;
      }
      const { user } = await updateProfile(payload);
      setProfile(user);
      setFullname(user.fullname ?? "");
      setPhone(user.phone ?? "");
      setProfileMsg("Profile updated.");
    } catch (err) {
      setProfileErr(err.message);
    } finally {
      setProfileSaving(false);
    }
  }

  async function handleChangePassword(e) {
    e.preventDefault();
    setPwdErr(null);
    setPwdMsg(null);
    setPwdSaving(true);
    try {
      await changeAccountPassword({
        oldPassword,
        newPassword,
        confirmPassword,
      });
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPwdMsg("Password updated.");
    } catch (err) {
      setPwdErr(err.message);
    } finally {
      setPwdSaving(false);
    }
  }

  function handleSignOut() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    sessionStorage.removeItem("token");
    sessionStorage.removeItem("user");
    navigate("/login");
  }

  const memberSince =
    profile?.createdAt != null
      ? new Date(profile.createdAt).toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })
      : "—";

  const quickLinks = [
    { to: "/bets", label: "Bet history" },
    { to: "/deposit", label: "Deposit" },
    { to: "/withdraw", label: "Withdraw" },
  ];

  return (
    <PageContainer>
      <div className="sticky top-0 z-50">
        <TopHeader data={topHeaderData} />
        <PrimaryNav items={topNavItems} />
      </div>

      <div className="relative mx-auto w-full max-w-lg px-4 pb-28 pt-2 sm:px-5 sm:pt-4">
        <div
          className="pointer-events-none absolute -top-4 left-1/2 h-64 w-[min(100%,28rem)] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(1,144,82,0.14),transparent_68%)] blur-xl"
          aria-hidden
        />

        <header className="relative mb-8 flex items-center gap-4">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-(--sb-bg-2)/90 text-[#ffffff] shadow-lg shadow-black/20  transition-transform duration-300 hover:scale-105 hover:bg-(--sb-bg-2) hover:ring-(--sb-accent-fill)/30 active:scale-95"
          >
            <AppIcon name="chevronDown" size={18} className="rotate-90" />
          </button>
          <div>
            <p className="m-0 text-[11px] font-extrabold uppercase tracking-[0.2em] text-[rgba(255,255,255,0.72)]">
              Account
            </p>
            <h1 className="m-0 text-2xl font-black tracking-tight text-[#ffffff] sm:text-3xl">
              My profile
            </h1>
          </div>
        </header>

        {loading ? (
          <div className="flex flex-col items-center justify-center gap-4 py-24 text-[rgba(255,255,255,0.72)]">
            <div className="relative h-14 w-14">
              <div className="absolute inset-0 animate-ping rounded-full bg-(--sb-accent-fill)/25" />
              <div className="relative flex h-14 w-14 items-center justify-center rounded-full bg-(--sb-bg-2) ring-2 ring-(--sb-accent-fill)/40">
                <div className="h-7 w-7 animate-spin rounded-full border-2 border-[#019052] border-t-(--sb-accent-fill)" />
              </div>
            </div>
            <span className="text-sm font-semibold">Loading profile…</span>
          </div>
        ) : error ? (
          <SoftPanel className="animate-deposit-panel ring-red-900/30">
            <p className="m-0 text-sm font-semibold text-[#ff6b6b]">{error}</p>
          </SoftPanel>
        ) : (
          <div className="flex flex-col gap-4">
            <SoftPanel className="animate-deposit-panel">
              <p className="mb-4 text-center text-xs font-extrabold uppercase tracking-[0.18em] text-[rgba(255,255,255,0.72)]">
                Overview
              </p>
              <div className="flex flex-col gap-2.5">
                <div className={insetRow}>
                  <span className="text-sm text-[rgba(255,255,255,0.72)]">Wallet</span>
                  <span className="text-lg font-black tabular-nums text-(--sb-positive)">
                    {balance === null ? "—" : `${balance.toLocaleString()} ETB`}
                  </span>
                </div>
                <div className={insetRow}>
                  <span className="text-sm text-[rgba(255,255,255,0.72)]">Member since</span>
                  <span className="text-sm font-bold text-[#ffffff]">
                    {memberSince}
                  </span>
                </div>
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                {quickLinks.map((l) => (
                  <Link
                    key={l.to}
                    to={l.to}
                    className="inline-flex items-center gap-1.5 rounded-full bg-(--sb-accent-surface-deep)/70 px-4 py-2 text-xs font-extrabold text-[#ffffff] no-underline transition-all duration-300 hover:scale-[1.03] hover:bg-(--sb-accent-surface)/35"
                  >
                    {l.label}
                    <AppIcon
                      name="chevronDown"
                      size={12}
                      className="-rotate-90 opacity-70"
                    />
                  </Link>
                ))}
              </div>
            </SoftPanel>

            <form
              onSubmit={handleSaveProfile}
              className="animate-deposit-panel"
            >
              <SoftPanel>
                <p className="mb-5 text-center text-xs font-extrabold uppercase tracking-[0.18em] text-[rgba(255,255,255,0.72)]">
                  Profile details
                </p>
                <div className="flex flex-col gap-4">
                  <label className="block">
                    <span className="mb-2 block text-xs font-semibold text-[rgba(255,255,255,0.72)]">
                      Display name
                    </span>
                    <input
                      type="text"
                      value={fullname}
                      onChange={(e) => setFullname(e.target.value)}
                      required
                      className={accountInputCls}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-xs font-semibold text-[rgba(255,255,255,0.72)]">
                      Phone {isPlayer ? "(login)" : ""}
                    </span>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      readOnly={!isPlayer}
                      title={
                        isPlayer
                          ? ""
                          : "Contact support to change your phone number"
                      }
                      className={`${accountInputCls} ${
                        !isPlayer ? "cursor-not-allowed opacity-70" : ""
                      }`}
                    />
                    {!isPlayer && (
                      <p className="mt-2 text-[11px] leading-relaxed text-[rgba(255,255,255,0.5)]">
                        Phone changes are limited to player accounts on this
                        site.
                      </p>
                    )}
                  </label>
                </div>
                {profileErr && (
                  <p className="mt-4 rounded-2xl bg-[#3a1515]/90 px-4 py-3 text-center text-sm font-semibold text-[#ff6b6b] ring-1 ring-red-900/30">
                    {profileErr}
                  </p>
                )}
                {profileMsg && (
                  <p className="mt-4 rounded-2xl bg-(--sb-accent-surface)/40 px-4 py-3 text-center text-sm font-semibold text-[#ffffff] ring-1 ring-(--sb-accent-fill)/25">
                    {profileMsg}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={profileSaving}
                  className={`${accountPrimaryBtn} mt-6`}
                >
                  {profileSaving ? "Saving…" : "Save profile"}
                </button>
              </SoftPanel>
            </form>

            <form
              onSubmit={handleChangePassword}
              className="animate-deposit-panel"
            >
              <SoftPanel>
                <p className="mb-5 text-center text-xs font-extrabold uppercase tracking-[0.18em] text-[rgba(255,255,255,0.72)]">
                  Change password
                </p>
                <div className="flex flex-col gap-3">
                  <input
                    type="password"
                    autoComplete="current-password"
                    placeholder="Current password"
                    value={oldPassword}
                    onChange={(e) => setOldPassword(e.target.value)}
                    required
                    className={accountInputCls}
                  />
                  <input
                    type="password"
                    autoComplete="new-password"
                    placeholder="New password (min 6 characters)"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    minLength={6}
                    className={accountInputCls}
                  />
                  <input
                    type="password"
                    autoComplete="new-password"
                    placeholder="Confirm new password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    className={accountInputCls}
                  />
                </div>
                {pwdErr && (
                  <p className="mt-4 rounded-2xl bg-[#3a1515]/90 px-4 py-3 text-center text-sm font-semibold text-[#ff6b6b] ring-1 ring-red-900/30">
                    {pwdErr}
                  </p>
                )}
                {pwdMsg && (
                  <p className="mt-4 rounded-2xl bg-(--sb-accent-surface)/40 px-4 py-3 text-center text-sm font-semibold text-[#ffffff] ring-1 ring-(--sb-accent-fill)/25">
                    {pwdMsg}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={pwdSaving}
                  className={`${accountOutlineBtn} mt-6`}
                >
                  {pwdSaving ? "Updating…" : "Update password"}
                </button>
              </SoftPanel>
            </form>

            <button
              type="button"
              onClick={handleSignOut}
              className="animate-deposit-panel rounded-2xl bg-(--sb-accent-surface-deep)/60 px-5 py-4 text-sm font-extrabold text-[#ffffff] transition-all duration-300 hover:bg-[#2a1a1f]/80 hover:text-[#ff9a9a]"
            >
              Sign out
            </button>
          </div>
        )}
      </div>

      <MobileBottomBar
        selections={[]}
        onRemoveSelection={() => {}}
        onClearSelections={() => {}}
      />
      <div className="h-16 lg:hidden" />
    </PageContainer>
  );
}

export default Profile;
