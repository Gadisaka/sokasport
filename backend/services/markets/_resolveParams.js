/**
 * Resolve a selection's settlement params using a market module's OWN
 * `validate()` as the single parser/normalizer — the Phase-1 label fallback.
 *
 * Contract:
 *   1. If the stored `market_params` validate on their own (no label needed),
 *      they are returned AS-IS. This makes settlement byte-identical to the old
 *      "read market_params directly" path whenever valid params are present —
 *      the label is never consulted.
 *   2. Only when the stored params are missing/incomplete (validate throws
 *      without a label) do we re-parse from the human label
 *      (`selection.selection`) via the SAME `validate`. Explicit params still
 *      win over the label inside validate, so a partial param set is completed
 *      from the label, never overridden by it.
 *   3. If neither yields valid params, returns null → caller VOIDs.
 *
 * Because the SAME `validate` runs at placement and here, evaluate() can never
 * derive a different param set than placement did. No second parser exists.
 *
 * @param {object} selection  persisted TicketSelection-like row
 * @param {(params: object, ctx: object) => object} validate  the module's validate
 * @returns {object|null} normalized params, or null when unresolvable
 */
export function resolveParamsViaValidate(selection, validate) {
  const stored =
    selection && typeof selection.market_params === "object" && selection.market_params
      ? selection.market_params
      : {};

  // 1. Valid stored params → use as-is (label never consulted).
  try {
    return validate(stored, {});
  } catch {
    // fall through: missing/incomplete → re-parse from the label
  }

  // 2. Re-parse from the human label via the same validator.
  try {
    return validate(stored, { label: selection?.selection });
  } catch {
    return null;
  }
}
