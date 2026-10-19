export function searchExpression(query) {
  // Treat input as literal terms, never as executable FTS syntax.
  const terms = [
    ...new Set(
      String(query)
        .normalize("NFC")
        .match(/[\p{L}\p{N}_]+/gu) || [],
    ),
  ].slice(0, 12);
  return terms.map((term) => `"${term}"`).join(" AND ");
}

export function boundedInteger(raw, fallback, maximum) {
  if (raw === null || raw === undefined || raw === "") return fallback;
  const number = Number(raw);
  return Number.isFinite(number)
    ? Math.min(maximum, Math.max(0, Math.floor(number)))
    : fallback;
}
