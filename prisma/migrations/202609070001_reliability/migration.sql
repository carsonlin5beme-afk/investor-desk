DROP INDEX IF EXISTS "OptionPositionDetails_optionSymbol_key";
ALTER TABLE "Order" ADD COLUMN "clientOrderId" TEXT, ADD COLUMN "quoteSource" TEXT;
CREATE UNIQUE INDEX "Order_clientOrderId_key" ON "Order"("clientOrderId");
ALTER TABLE "Fill" ADD COLUMN "realizedPnL" DECIMAL(20,6) NOT NULL DEFAULT 0;
ALTER TABLE "QuoteCache" ADD COLUMN "impliedVolatility" DOUBLE PRECISION;
