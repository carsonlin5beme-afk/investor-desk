import { Prisma } from "@prisma/client";

export const toDecimal = (
  value: number | string | Prisma.Decimal,
): Prisma.Decimal =>
  value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);

export const toNumber = (
  value: Prisma.Decimal | number | null | undefined,
): number => {
  if (value == null) {
    return 0;
  }
  return value instanceof Prisma.Decimal ? value.toNumber() : value;
};

export const roundCurrency = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;
