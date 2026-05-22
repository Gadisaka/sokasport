import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { enforcePlayerSession } from './utils/authSession'
import Home from './pages/Home'
import Live from './pages/Live'
import Login from './pages/Login'
import Register from './pages/Register'
import BetHistory from './pages/BetHistory'
import Profile from './pages/Profile'
import Withdraw from './pages/Withdraw'
import Deposit from './pages/Deposit'
import Transactions from './pages/Transactions'
import CheckTicket from './pages/CheckTicket'
import InfoArticlePage from './pages/InfoArticlePage'
import { LanguageProvider } from './i18n/LanguageContext.jsx'

function App() {
  useEffect(() => {
    enforcePlayerSession()
  }, [])

  return (
    <LanguageProvider>
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
    </LanguageProvider>
  )
}

export default App
