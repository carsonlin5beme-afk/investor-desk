import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { discardGuest, getGuest, lockGuest } from "./store";
import { GuestError } from "./portfolio";
export async function importGuest(key: string, userId: string) {
  return lockGuest(key, async () => {
    const receipt = await prisma.guestImport.findUnique({
      where: { tokenHash: key },
    });
    if (receipt) {
      if (receipt.userId !== userId)
        throw new GuestError(
          "This guest workspace was already saved to a different profile.",
          409,
        );
      discardGuest(key);
      return { portfolioIds: receipt.portfolioIds, alreadySaved: true };
    }
    const state = getGuest(key);
    if (!state)
      throw new GuestError(
        "Your temporary guest session expired or the server restarted before it could be saved. No saved account portfolios were changed.",
        410,
      );
    if (state.imported)
      throw new GuestError(
        "This workspace was already transferred. Refresh your account.",
        409,
      );
    const ids = state.portfolios.map((p) => p.id);
    // The receipt and every portfolio/history row commit together; a retry cannot duplicate them.
    await prisma.$transaction(
      async (tx) => {
        const entries = Object.values(state.entries ?? {});
        const savedKeys = entries.length
          ? new Set(
              (
                await tx.workspaceEntry.findMany({
                  where: { userId },
                  select: { key: true },
                })
              ).map((entry) => entry.key),
            )
          : new Set<string>();
        const newEntries = entries.filter(
          (entry) =>
            entry.key !== "preferences" || !savedKeys.has("preferences"),
        );
        if (savedKeys.size + newEntries.length > 300)
          throw new GuestError(
            "Your saved workspace is full. Remove older saved scenarios or notes, then retry. Your guest work remains available.",
            409,
          );
        for (const p of state.portfolios) {
          const { positions, orders, cashLedgerEntries, ...portfolio } = p;
          await tx.portfolio.create({ data: { ...portfolio, userId } });
          for (const position of positions) {
            const { optionDetails, targetScenario, ...record } = position;
            await tx.position.create({ data: record });
            if (optionDetails)
              await tx.optionPositionDetails.create({ data: optionDetails });
            if (targetScenario)
              await tx.targetScenario.create({ data: targetScenario });
          }
          if (cashLedgerEntries.length)
            await tx.cashLedgerEntry.createMany({ data: cashLedgerEntries });
          for (const order of orders) {
            const { fills, ...record } = order;
            // Guest client retry keys are session-scoped; saved retry keys must be globally unique.
            await tx.order.create({
              data: {
                ...record,
                clientOrderId: record.clientOrderId ? randomUUID() : null,
              },
            });
            if (fills.length) await tx.fill.createMany({ data: fills });
          }
        }
        for (const entry of entries) {
          // Existing appearance preferences win. Research collisions are copied under
          // fresh IDs, so neither the saved nor guest draft can be silently lost.
          if (entry.key === "preferences" && savedKeys.has(entry.key)) continue;
          let key = entry.key,
            value = entry.value;
          if (savedKeys.has(key) && "id" in value) {
            const id = randomUUID();
            key = `${key.split(":")[0]}:${id}`;
            value = { ...value, id };
          }
          await tx.workspaceEntry.create({
            data: {
              userId,
              key,
              value: JSON.parse(JSON.stringify(value)),
              version: entry.version,
              updatedAt: new Date(entry.updatedAt),
            },
          });
          savedKeys.add(key);
        }
        await tx.guestImport.create({
          data: { tokenHash: key, userId, portfolioIds: ids },
        });
      },
      {
        maxWait: 15000,
        timeout: 60000,
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
    state.imported = true;
    state.portfolios = [];
    discardGuest(key);
    return { portfolioIds: ids, alreadySaved: false };
  });
}
