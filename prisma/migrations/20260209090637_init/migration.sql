-- CreateEnum
CREATE TYPE "AssetClass" AS ENUM ('EQUITY', 'OPTION');

-- CreateEnum
CREATE TYPE "CashEntryType" AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'BUY', 'SELL');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('MARKET', 'LIMIT');

-- CreateEnum
CREATE TYPE "Side" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'FILLED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OptionRight" AS ENUM ('CALL', 'PUT');

-- CreateEnum
CREATE TYPE "TargetMode" AS ENUM ('PRICE', 'MARKET_CAP');

-- CreateTable
CREATE TABLE "Portfolio" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseCurrency" TEXT NOT NULL DEFAULT 'USD',
    "startingCash" DECIMAL(18,2) NOT NULL,
    "cashBalance" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Portfolio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashLedgerEntry" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "type" "CashEntryType" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "assetClass" "AssetClass" NOT NULL,
    "symbol" TEXT NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,
    "avgCost" DECIMAL(20,6) NOT NULL,
    "marketValue" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "unrealizedPnL" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OptionPositionDetails" (
    "positionId" TEXT NOT NULL,
    "underlying" TEXT NOT NULL,
    "optionSymbol" TEXT NOT NULL,
    "right" "OptionRight" NOT NULL,
    "strike" DECIMAL(20,6) NOT NULL,
    "expiration" TIMESTAMP(3) NOT NULL,
    "contracts" INTEGER NOT NULL,
    "multiplier" INTEGER NOT NULL DEFAULT 100,
    "entryPremium" DECIMAL(20,6) NOT NULL,

    CONSTRAINT "OptionPositionDetails_pkey" PRIMARY KEY ("positionId")
);

-- CreateTable
CREATE TABLE "TargetScenario" (
    "positionId" TEXT NOT NULL,
    "targetMode" "TargetMode" NOT NULL,
    "targetPrice" DECIMAL(20,6),
    "targetMarketCap" DECIMAL(20,6),
    "sharesOutstandingLive" DECIMAL(30,6),
    "sharesOutstandingManual" DECIMAL(30,6),
    "useManualShares" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TargetScenario_pkey" PRIMARY KEY ("positionId")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "assetClass" "AssetClass" NOT NULL,
    "symbol" TEXT NOT NULL,
    "orderType" "OrderType" NOT NULL,
    "side" "Side" NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,
    "limitPrice" DECIMAL(20,6),
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "optionContractSymbol" TEXT,
    "optionRight" "OptionRight",
    "optionStrike" DECIMAL(20,6),
    "optionExpiration" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "filledAt" TIMESTAMP(3),

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fill" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "positionId" TEXT,
    "side" "Side" NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,
    "price" DECIMAL(20,6) NOT NULL,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Fill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteCache" (
    "symbol" TEXT NOT NULL,
    "assetClass" "AssetClass" NOT NULL,
    "bid" DECIMAL(20,6),
    "ask" DECIMAL(20,6),
    "last" DECIMAL(20,6),
    "mark" DECIMAL(20,6),
    "source" TEXT NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuoteCache_pkey" PRIMARY KEY ("symbol","assetClass")
);

-- CreateIndex
CREATE INDEX "CashLedgerEntry_portfolioId_createdAt_idx" ON "CashLedgerEntry"("portfolioId", "createdAt");

-- CreateIndex
CREATE INDEX "Position_portfolioId_idx" ON "Position"("portfolioId");

-- CreateIndex
CREATE UNIQUE INDEX "Position_portfolioId_symbol_assetClass_key" ON "Position"("portfolioId", "symbol", "assetClass");

-- CreateIndex
CREATE UNIQUE INDEX "OptionPositionDetails_optionSymbol_key" ON "OptionPositionDetails"("optionSymbol");

-- CreateIndex
CREATE INDEX "OptionPositionDetails_underlying_idx" ON "OptionPositionDetails"("underlying");

-- CreateIndex
CREATE INDEX "Order_portfolioId_submittedAt_idx" ON "Order"("portfolioId", "submittedAt");

-- CreateIndex
CREATE INDEX "Fill_orderId_idx" ON "Fill"("orderId");

-- CreateIndex
CREATE INDEX "Fill_positionId_idx" ON "Fill"("positionId");

-- AddForeignKey
ALTER TABLE "CashLedgerEntry" ADD CONSTRAINT "CashLedgerEntry_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OptionPositionDetails" ADD CONSTRAINT "OptionPositionDetails_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TargetScenario" ADD CONSTRAINT "TargetScenario_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fill" ADD CONSTRAINT "Fill_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fill" ADD CONSTRAINT "Fill_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;
