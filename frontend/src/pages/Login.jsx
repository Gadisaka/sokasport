import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import PageContainer from "../components/layout/PageContainer";
import TopHeader from "../components/layout/TopHeader";
import PrimaryNav from "../components/layout/PrimaryNav";
import SiteFooter from "../components/layout/SiteFooter";
import AppIcon from "../components/common/AppIcon";
import SoftPanel from "../components/common/SoftPanel";
import {
  accountInputCls,
  accountOutlineBtn,
  accountPrimaryBtn,
} from "../components/common/accountFormClasses";
import { topHeaderData, topNavItems } from "../data/homepageData";
import { getApiOrigin } from "../services/api";
import {
  isPlayerUser,
  saveAuthSession,
} from "../utils/authSession";

function Login() {
  const navigate = useNavigate();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch(`${getApiOrigin()}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: phone.trim(),
          password,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.message || data.error || "Login failed");
        return;
      }

      const token = data.accessToken ?? data.token;
      if (!token) {
        setError("Invalid response from server");
        return;
      }

      if (!isPlayerUser(data.user)) {
        setError("Only player accounts can sign in here.");
        return;
      }

      saveAuthSession({ token, user: data.user, remember });
      navigate("/");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <PageContainer>
      <div className="sticky top-0 z-50">
        <TopHeader data={topHeaderData} />
        <PrimaryNav items={topNavItems} />
      </div>

      <div className="relative mx-auto w-full max-w-lg px-4 pb-16 pt-2 sm:px-5 sm:pt-6">
        <div
          className="pointer-events-none absolute -top-4 left-1/2 h-64 w-[min(100%,28rem)] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(1,144,82,0.14),transparent_68%)] blur-xl"
          aria-hidden
        />

        <header className="relative mb-8 flex items-center gap-4">
          <Link
            to="/"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-(--sb-bg-2)/90 text-[#ffffff] no-underline shadow-lg shadow-black/20  transition-transform duration-300 hover:scale-105 hover:bg-(--sb-bg-2) hover:ring-(--sb-accent-fill)/30 active:scale-95"
          >
            <AppIcon name="chevronDown" size={18} className="rotate-90" />
          </Link>
          <div>
            <p className="m-0 text-[11px] font-extrabold uppercase tracking-[0.2em] text-[rgba(255,255,255,0.72)]">
              Welcome back
            </p>
            <h1 className="m-0 text-2xl font-black tracking-tight text-[#ffffff] sm:text-3xl">
              Log in
            </h1>
          </div>
        </header>

        <SoftPanel className="animate-deposit-panel">
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <label className="block">
              <span className="mb-2 block text-xs font-semibold text-[rgba(255,255,255,0.72)]">
                Phone number
              </span>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                autoComplete="tel"
                className={accountInputCls}
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold text-[rgba(255,255,255,0.72)]">
                Password
              </span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className={accountInputCls}
              />
            </label>

            <div className="flex items-center justify-between rounded-2xl bg-(--sb-accent-surface-deep)/45 px-4 py-3 ">
              <span className="text-sm font-semibold text-[#ffffff]">
                Remember me
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={remember}
                onClick={() => setRemember((p) => !p)}
                className={`relative h-[26px] w-[46px] shrink-0 cursor-pointer rounded-full border-0 transition-all duration-300 ${
                  remember ? "bg-(--sb-accent-fill)" : "bg-[#019052]"
                }`}
              >
                <span
                  className={`absolute top-[4px] h-[18px] w-[18px] rounded-full bg-white shadow-md transition-all duration-300 ease-out ${
                    remember ? "left-[24px]" : "left-[4px]"
                  }`}
                />
              </button>
            </div>

            {error ? (
              <p className="rounded-2xl bg-[#3a1515]/90 px-4 py-3 text-center text-sm font-semibold text-[#ff6b6b] ring-1 ring-red-900/30">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={loading}
              className={accountPrimaryBtn}
            >
              {loading ? "Signing in…" : "Log in"}
            </button>

            <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-xs">
              <a
                href="#"
                className="font-bold text-[#ffffff] no-underline transition-opacity hover:opacity-80"
              >
                Restore password
              </a>
              <span className="text-[rgba(255,255,255,0.5)]">·</span>
              <a
                href="#"
                className="font-bold text-[#ffffff] no-underline transition-opacity hover:opacity-80"
              >
                Contact us
              </a>
            </div>

            <div className="relative py-2">
              <div
                className="absolute inset-x-0 top-1/2 h-px bg-[#019052]/80"
                aria-hidden
              />
              <p className="relative mx-auto w-fit bg-(--sb-bg-2) px-3 text-center text-[11px] font-extrabold uppercase tracking-wider text-[rgba(255,255,255,0.5)]">
                New here?
              </p>
            </div>

            <Link to="/register" className={`${accountOutlineBtn} no-underline`}>
              Create account
            </Link>
          </form>
        </SoftPanel>
      </div>

      <SiteFooter />
    </PageContainer>
  );
}

export default Login;
