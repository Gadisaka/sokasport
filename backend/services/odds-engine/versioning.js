function fnv1a32(input) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function buildPrematchMarketVersion({
  fixtureId,
  marketLabel,
  selectionLabel,
  odd,
  bookmakerApiId,
}) {
  const material = [
    String(fixtureId || ""),
    String(marketLabel || ""),
    String(selectionLabel || ""),
    String(odd || ""),
    String(bookmakerApiId || ""),
  ].join("|");
  return fnv1a32(material);
}

export function bumpMarketVersion(previousVersion, fallbackSeed = Date.now()) {
  const numeric = Number(previousVersion);
  if (Number.isFinite(numeric) && numeric >= 0) {
    return numeric + 1;
  }
  const seed = Number(fallbackSeed);
  return Number.isFinite(seed) ? Math.max(1, seed) : 1;
}

