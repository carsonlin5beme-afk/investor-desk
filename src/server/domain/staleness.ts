export const isQuoteStale = (
  asOf: Date,
  staleSeconds: number,
  now: Date = new Date(),
): boolean => {
  const ageMs = now.getTime() - asOf.getTime();
  return (
    !Number.isFinite(ageMs) || ageMs < -5000 || ageMs > staleSeconds * 1000
  );
};
