export const isQuoteStale = (
  asOf: Date,
  staleSeconds: number,
  now: Date = new Date(),
): boolean => {
  const ageMs = now.getTime() - asOf.getTime();
  return ageMs > staleSeconds * 1000;
};
