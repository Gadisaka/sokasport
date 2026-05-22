import { Navigate } from "react-router-dom";

/** @deprecated Use Settings → Payments tab. */
export default function OnlineDepositReceiversPage() {
  return <Navigate to="/settings?tab=payments" replace />;
}
