// Bound provider bodies before parsing; never include their contents in errors.
export async function readSchwabJson(response, maxBytes = 8 * 1024 * 1024) {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) {
    await response.body?.cancel();
    throw new Error("Schwab: provider response exceeded the size limit.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Schwab: invalid provider response.");
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("oversized");
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    await reader.cancel().catch(() => {});
    throw new Error("Schwab: invalid or oversized provider response.");
  } finally {
    reader.releaseLock();
  }
}
