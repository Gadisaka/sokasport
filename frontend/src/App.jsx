import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { enforcePlayerSession } from './utils/authSession'
import Home from './pages/Home'
import { LanguageProvider } from './i18n/LanguageContext.jsx'

const Live = lazy(() => import('./pages/Live'))
const Login = lazy(() => import('./pages/Login'))
const Register = lazy(() => import('./pages/Register'))
const BetHistory = lazy(() => import('./pages/BetHistory'))
const Profile = lazy(() => import('./pages/Profile'))
const Withdraw = lazy(() => import('./pages/Withdraw'))
const Deposit = lazy(() => import('./pages/Deposit'))
const Transactions = lazy(() => import('./pages/Transactions'))
const CheckTicket = lazy(() => import('./pages/CheckTicket'))
const InfoArticlePage = lazy(() => import('./pages/InfoArticlePage'))

function RouteFallback() {
  return (
    <div
      className="flex min-h-[40vh] items-center justify-center text-sm text-white/70"
      role="status"
      aria-live="polite"
    >
      Loading…
    </div>
  )
}

function App() {
  useEffect(() => {
    enforcePlayerSession()
  }, [])

  return (
    <LanguageProvider>
    <Suspense fallback={<RouteFallback />}>
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/live" element={<Live />} />
      <Route path="/matchdetail/:id" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/bets" element={<BetHistory />} />
      <Route path="/profile" element={<Profile />} />
      <Route path="/withdraw" element={<Withdraw />} />
      <Route path="/deposit" element={<Deposit />} />
      <Route path="/transactions" element={<Transactions />} />
      <Route path="/check-ticket" element={<CheckTicket />} />
      <Route path="/info/:slug" element={<InfoArticlePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
    </LanguageProvider>
  )
}

export default App
