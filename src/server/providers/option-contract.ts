import { decodeContract } from "./demo";
import type { OptionContract } from "./interfaces";
import { optionExpirationDate } from "@/lib/option-expiration";

/** A response must identify the exact standard contract whose price is used. */
export function isStandardOptionContract(
  symbol: string,
  contract: OptionContract,
): boolean {
  try {
    const meta = decodeContract(symbol);
    return (
      /^[A-Z][A-Z.]{0,9}$/.test(meta.underlying) &&
      contract.contractSymbol === symbol &&
      contract.underlying === meta.underlying &&
      contract.right === meta.right &&
      Number.isFinite(meta.strike) &&
      meta.strike > 0 &&
      contract.strike === meta.strike &&
      contract.multiplier === 100 &&
      optionExpirationDate(contract.expiration) ===
        optionExpirationDate(meta.expiration)
    );
  } catch {
    return false;
  }
}
