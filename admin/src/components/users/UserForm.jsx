import { useState, useMemo } from "react";
import TextInput from "../ui/TextInput";
import SelectInput from "../ui/SelectInput";
import PrimaryButton from "../ui/PrimaryButton";
import { HIDDEN_ROLES_FOR_CREATE, SUPER_ADMIN_ONLY_ROLES } from "../../lib/permissions";

const ROLES_NEEDING_BRANCH = ["CASHIER"];
const ROLES_NEEDING_AGENT_CASHIERS = ["AGENT"];

export default function UserForm({ meta, initialValues, onSubmit, isPending, submitLabel, currentUserRole }) {
  const isEdit = Boolean(initialValues);

  const [name, setName] = useState(initialValues?.name ?? "");
  const [email, setEmail] = useState(initialValues?.email ?? "");
  const [phone, setPhone] = useState(initialValues?.phone ?? "");
  const [password, setPassword] = useState("");
  const [roleId, setRoleId] = useState(initialValues?.roleId ?? "");
  const [status, setStatus] = useState(initialValues?.status ?? true);
  const [branchName, setBranchName] = useState(
    initialValues?.cashier?.branchName ?? "",
  );
  const [branchLocation, setBranchLocation] = useState(
    initialValues?.cashier?.branchLocation ?? "",
  );
  const [agentCashierIds, setAgentCashierIds] = useState(
    initialValues?.agentCashiers?.map((ac) => ac.cashierProfileId) ?? [],
  );
  const [error, setError] = useState("");

  const selectedRoleName = useMemo(
    () => meta?.roles?.find((r) => r.id === roleId)?.name,
    [meta, roleId],
  );

  const roleOptions = useMemo(() => {
    return (meta?.roles ?? [])
      .filter((r) => {
        if (HIDDEN_ROLES_FOR_CREATE.includes(r.name)) return false;
        if (SUPER_ADMIN_ONLY_ROLES.includes(r.name) && currentUserRole !== "SUPER_ADMIN") return false;
        return true;
      })
      .map((r) => ({ value: r.id, label: r.name }));
  }, [meta, currentUserRole]);

  function toggleAgentCashier(id) {
    setAgentCashierIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    const body = { name, email, phone, roleId, status };
    if (!isEdit || password) body.password = password;
    if (ROLES_NEEDING_BRANCH.includes(selectedRoleName)) {
      body.branchName = branchName;
      body.branchLocation = branchLocation;
    }
    if (ROLES_NEEDING_AGENT_CASHIERS.includes(selectedRoleName)) {
      body.agentCashierIds = agentCashierIds;
    }

    try {
      await onSubmit(body);
    } catch (err) {
      setError(err.message || "Something went wrong");
    }
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
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required={!isEdit}
      />

      <SelectInput label="Role" value={roleId} onChange={(e) => setRoleId(e.target.value)} options={roleOptions} required />

      <SelectInput
        label="Status"
        value={status ? "active" : "disabled"}
        onChange={(e) => setStatus(e.target.value === "active")}
        options={[
          { value: "active", label: "Active" },
          { value: "disabled", label: "Disabled" },
        ]}
      />

      {selectedRoleName && ROLES_NEEDING_BRANCH.includes(selectedRoleName) && (
        <div className="grid grid-cols-2 gap-3">
          <TextInput
            label="Branch name"
            value={branchName}
            onChange={(e) => setBranchName(e.target.value)}
            required
            placeholder="e.g. Main Street Shop"
          />
          <TextInput
            label="Branch location"
            value={branchLocation}
            onChange={(e) => setBranchLocation(e.target.value)}
            required
            placeholder="e.g. Addis Ababa"
          />
        </div>
      )}

      {selectedRoleName && ROLES_NEEDING_AGENT_CASHIERS.includes(selectedRoleName) && (
        <fieldset>
          <legend className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            Assigned cashiers
          </legend>
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-sm border border-[var(--border)] bg-[var(--surfaceMuted)] p-2">
            {(meta?.cashiers ?? []).map((c) => (
              <label key={c.cashierProfileId} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={agentCashierIds.includes(c.cashierProfileId)}
                  onChange={() => toggleAgentCashier(c.cashierProfileId)}
                />
                {c.name} — {c.branchName} ({c.branchLocation})
              </label>
            ))}
            {(!meta?.cashiers || meta.cashiers.length === 0) && (
              <p className="text-xs text-[var(--muted)]">No cashiers configured.</p>
            )}
          </div>
        </fieldset>
      )}

      <PrimaryButton type="submit" disabled={isPending}>
        {isPending ? "Saving..." : submitLabel}
      </PrimaryButton>
    </form>
  );
}
