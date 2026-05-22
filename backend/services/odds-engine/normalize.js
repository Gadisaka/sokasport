function normalizeFixtureId(value) {
  const id = Number.parseInt(value, 10);
  return Number.isFinite(id) ? id : null;
}

export function normalizePlacementSelections(
  rawSelections = [],
  { allowAnyOdds = false } = {},
) {
  if (!Array.isArray(rawSelections)) return [];
  return rawSelections
    .map((item, index) => ({
      index,
      apiFixtureId: normalizeFixtureId(item?.apiFixtureId),
      matchName: String(item?.matchName || "").trim(),
      marketLabel: String(item?.marketLabel || "").trim(),
      marketCode: item?.marketCode
        ? String(item.marketCode).toUpperCase().trim()
        : null,
      marketParams:
        item?.marketParams && typeof item.marketParams === "object"
          ? item.marketParams
          : null,
      label: String(item?.label || "").trim(),
      submittedOdds: Number(item?.odds),
      submittedMarketVersion: Number(
        item?.acceptedMarketVersion ?? item?.marketVersion ?? item?.serverMarketVersion,
      ),
    }))
    .filter(
      (item) =>
        item.apiFixtureId &&
        item.label &&
        Number.isFinite(item.submittedOdds) &&
        (allowAnyOdds || item.submittedOdds > 1),
    );
}
