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

function Register() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    username: "",
    phone: "",
    password: "",
    confirmPassword: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(`${getApiOrigin()}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.username.trim(),
          phone: form.phone.trim(),
          password: form.password,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.message || data.error || "Registration failed");
        return;
      }

      const token = data.accessToken ?? data.token;
      if (!token) {
        setError("Invalid response from server");
        return;
      }

      sessionStorage.setItem("token", token);
      sessionStorage.setItem("user", JSON.stringify(data.user));
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
              Join the action
            </p>
            <h1 className="m-0 text-2xl font-black tracking-tight text-[#ffffff] sm:text-3xl">
              Register
            </h1>
          </div>
        </header>

        <SoftPanel className="animate-deposit-panel">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <label className="block">
              <span className="mb-2 block text-xs font-semibold text-[rgba(255,255,255,0.72)]">
                Username
              </span>
              <input
                type="text"
                value={form.username}
                onChange={(e) => update("username", e.target.value)}
                required
                autoComplete="username"
                className={accountInputCls}
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold text-[rgba(255,255,255,0.72)]">
                Phone number
              </span>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => update("phone", e.target.value)}
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
                value={form.password}
                onChange={(e) => update("password", e.target.value)}
                required
                autoComplete="new-password"
                className={accountInputCls}
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold text-[rgba(255,255,255,0.72)]">
                Confirm password
              </span>
              <input
                type="password"
                value={form.confirmPassword}
                onChange={(e) => update("confirmPassword", e.target.value)}
                required
                autoComplete="new-password"
                className={accountInputCls}
              />
            </label>

            {error ? (
              <p className="rounded-2xl bg-[#3a1515]/90 px-4 py-3 text-center text-sm font-semibold text-[#ff6b6b] ring-1 ring-red-900/30">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={loading}
              className={`${accountPrimaryBtn} mt-1`}
            >
              {loading ? "Creating account…" : "Register"}
            </button>

            <div className="relative py-2">
              <div
                className="absolute inset-x-0 top-1/2 h-px bg-[#019052]/80"
                aria-hidden
              />
              <p className="relative mx-auto w-fit bg-(--sb-bg-2) px-3 text-center text-[11px] font-extrabold uppercase tracking-wider text-[rgba(255,255,255,0.5)]">
                Have an account?
              </p>
            </div>

            <Link to="/login" className={`${accountOutlineBtn} no-underline`}>
              Log in instead
            </Link>
          </form>
        </SoftPanel>
      </div>

      <SiteFooter />
    </PageContainer>
  );
}

export default Register;
