import { useState } from "react";
import TextInput from "../ui/TextInput";
import SelectInput from "../ui/SelectInput";
import PrimaryButton from "../ui/PrimaryButton";

export default function CashierForm({ initialValues, onSubmit, isPending }) {
  const isEdit = Boolean(initialValues);

  const [name, setName] = useState(initialValues?.name ?? "");
  const [email, setEmail] = useState(initialValues?.email ?? "");
  const [phone, setPhone] = useState(initialValues?.phone ?? "");
  const [password, setPassword] = useState("");
  const [branchName, setBranchName] = useState(initialValues?.branch?.name ?? "");
  const [branchLocation, setBranchLocation] = useState(initialValues?.branch?.location ?? "");
  const [status, setStatus] = useState(initialValues?.status ?? true);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    const body = { name, email, phone, branchName, branchLocation, status };
    if (!isEdit || password) body.password = password;
    try { await onSubmit(body); }
    catch (err) { setError(err.message || "Something went wrong"); }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="rounded-sm border border-[color:var(--dangerSoft)] bg-[color:var(--dangerSurface)] px-3 py-2 text-sm text-[var(--danger)]">
          {error}
        </div>
      )}
      <TextInput label="Full name" value={name} onChange={(e) => setName(e.target.value)} required />
      <TextInput label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <TextInput label="Phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <TextInput
        label={isEdit ? "New password (leave blank to keep)" : "Password"}
        type="password" value={password} onChange={(e) => setPassword(e.target.value)} required={!isEdit}
      />
      <div className="grid grid-cols-2 gap-3">
        <TextInput label="Branch name" value={branchName} onChange={(e) => setBranchName(e.target.value)} required placeholder="e.g. Main Street Shop" />
        <TextInput label="Branch location" value={branchLocation} onChange={(e) => setBranchLocation(e.target.value)} required placeholder="e.g. Addis Ababa" />
      </div>
      <SelectInput
        label="Status"
        value={status ? "active" : "disabled"}
        onChange={(e) => setStatus(e.target.value === "active")}
        options={[{ value: "active", label: "Active" }, { value: "disabled", label: "Disabled" }]}
      />
      <PrimaryButton type="submit" disabled={isPending}>
        {isPending ? "Saving..." : isEdit ? "Save changes" : "Create cashier"}
      </PrimaryButton>
    </form>
  );
}
