// Fresh delayed/unconfirmed Schwab responses may be displayed, but never renamed
// into the configured real-time source. Cache reuse remains exact-source only.
export function acceptsQuoteSource(expected: string, actual: string): boolean {
  if (expected === actual) return true;
  return (
    (expected === "schwab-equity" || expected === "schwab-option") &&
    (actual === `${expected}-delayed` || actual === `${expected}-indicative`)
  );
}
