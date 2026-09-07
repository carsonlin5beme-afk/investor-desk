import {
  AssetClass,
  OptionRight,
  OrderType,
  Side,
  TargetMode,
} from "@prisma/client";
import { z } from "zod";

export const createPortfolioSchema = z.object({
  name: z.string().trim().min(1).max(80),
  startingCash: z.number().finite().min(0).max(1e12).multipleOf(0.01),
  baseCurrency: z.literal("USD").default("USD"),
});

export const cashAdjustSchema = z.object({
  type: z.enum(["DEPOSIT", "WITHDRAWAL"]),
  amount: z.number().finite().positive().max(1e12).multipleOf(0.01),
  note: z.string().max(240).optional(),
});

export const orderTicketSchema = z
  .object({
    clientOrderId: z.string().uuid().optional(),
    portfolioId: z.string().min(1),
    assetClass: z.nativeEnum(AssetClass),
    symbol: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z][A-Z0-9.\-]{0,9}$/),
    side: z.nativeEnum(Side),
    orderType: z.nativeEnum(OrderType),
    quantity: z.number().finite().positive().max(1e9).multipleOf(0.000001),
    limitPrice: z.number().positive().optional(),
    optionContractSymbol: z.string().optional(),
    optionRight: z.nativeEnum(OptionRight).optional(),
    optionStrike: z.number().positive().optional(),
    optionExpiration: z.coerce.date().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.orderType === OrderType.LIMIT && !value.limitPrice) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["limitPrice"],
        message: "limitPrice is required for LIMIT orders",
      });
    }

    if (value.assetClass === AssetClass.OPTION) {
      if (!Number.isInteger(value.quantity))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["quantity"],
          message: "Options require whole contracts",
        });
      if (!value.optionContractSymbol) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["optionContractSymbol"],
          message: "optionContractSymbol is required for options orders",
        });
      }
      if (!value.optionRight) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["optionRight"],
          message: "optionRight is required for options orders",
        });
      }
      if (!value.optionStrike) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["optionStrike"],
          message: "optionStrike is required for options orders",
        });
      }
      if (!value.optionExpiration) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["optionExpiration"],
          message: "optionExpiration is required for options orders",
        });
      }
    }
  });

export const targetScenarioSchema = z
  .object({
    targetMode: z.nativeEnum(TargetMode),
    targetPrice: z.number().finite().min(0).max(1e12).optional(),
    targetMarketCap: z.number().positive().optional(),
    sharesOutstandingManual: z.number().positive().optional(),
    useManualShares: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.targetMode === TargetMode.PRICE && value.targetPrice == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetPrice"],
        message: "targetPrice is required when targetMode=PRICE",
      });
    }

    if (value.targetMode === TargetMode.MARKET_CAP && !value.targetMarketCap) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetMarketCap"],
        message: "targetMarketCap is required when targetMode=MARKET_CAP",
      });
    }
  });
