import { useState } from "react";
import TextInput from "../ui/TextInput";
import SelectInput from "../ui/SelectInput";
import PrimaryButton from "../ui/PrimaryButton";

export default function AgentForm({ initialValues, onSubmit, isPending }) {
  const isEdit = Boolean(initialValues);

  const [username, setUsername] = useState(initialValues?.username ?? "");
  const [fullname, setFullname] = useState(initialValues?.fullname ?? "");
  const [email, setEmail] = useState(initialValues?.email ?? "");
  const [phone, setPhone] = useState(initialValues?.phone ?? "");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState(initialValues?.status ?? true);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    const body = { username: username.trim(), fullname, email, phone, status };
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
      <TextInput
        label="Username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        required={!isEdit}
        placeholder="Login username"
        autoComplete="username"
      />
      <TextInput label="Full name" value={fullname} onChange={(e) => setFullname(e.target.value)} required />
      <TextInput label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <TextInput label="Phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <TextInput
        label={isEdit ? "New password (leave blank to keep)" : "Password"}
        type="password" value={password} onChange={(e) => setPassword(e.target.value)} required={!isEdit}
      />
      <SelectInput
        label="Status"
        value={status ? "active" : "disabled"}
        onChange={(e) => setStatus(e.target.value === "active")}
        options={[{ value: "active", label: "Active" }, { value: "disabled", label: "Disabled" }]}
      />
      <PrimaryButton type="submit" disabled={isPending}>
        {isPending ? "Saving..." : isEdit ? "Save changes" : "Create agent"}
      </PrimaryButton>
    </form>
  );
}
