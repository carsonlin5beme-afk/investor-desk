const eastern = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
function parts(ms: number) {
  return Object.fromEntries(
    eastern.formatToParts(ms).map((part) => [part.type, part.value]),
  );
}
export function easternDate(ms: number) {
  const p = parts(ms);
  return `${p.year}-${p.month}-${p.day}`;
}
/** Convert an Eastern market session wall time, including DST, to UTC. */
export function sessionTime(date: unknown, time: unknown): number {
  if (
    typeof date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    typeof time !== "string" ||
    !/^\d{2}:\d{2}$/.test(time)
  )
    throw new Error("Invalid session");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if (hour > 23 || minute > 59) throw new Error("Invalid session");
  const probe = Date.UTC(year, month - 1, day, hour, minute);
  const p = parts(probe);
  const offset =
    Date.UTC(
      Number(p.year),
      Number(p.month) - 1,
      Number(p.day),
      Number(p.hour),
      Number(p.minute),
      Number(p.second),
    ) - probe;
  const result = probe - offset;
  const actual = parts(result);
  if (
    easternDate(result) !== date ||
    `${actual.hour}:${actual.minute}` !== time
  )
    throw new Error("Invalid session");
  return result;
}
