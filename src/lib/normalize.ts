export function normName(s?: string | null) {
  if (!s) return "";
  return s
    .toLowerCase()
    .replace(/[,\.]/g, " ")
    .replace(/\b(inc|llc|ltd|co|corp|corporation|company)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normTracking(s?: string | null) {
  if (!s) return "";
  return s.toUpperCase().replace(/\s|-/g, "").trim();
}
