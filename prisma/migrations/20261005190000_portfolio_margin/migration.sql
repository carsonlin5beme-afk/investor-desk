-- Add existing margin-liability assumptions without changing cash or holdings.
ALTER TABLE "Portfolio"
  ADD COLUMN "marginDebt" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "marginAprPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "marginMaintenancePercent" DOUBLE PRECISION NOT NULL DEFAULT 25,
  ADD COLUMN "marginDayCountBasis" INTEGER NOT NULL DEFAULT 360;

ALTER TABLE "Portfolio"
  ADD CONSTRAINT "Portfolio_marginDebt_nonnegative"
    CHECK ("marginDebt" >= 0 AND "marginDebt" <> 'NaN'::numeric),
  ADD CONSTRAINT "Portfolio_marginAprPercent_finite_nonnegative"
    CHECK ("marginAprPercent" >= 0 AND "marginAprPercent" < 'Infinity'::double precision),
  ADD CONSTRAINT "Portfolio_marginMaintenancePercent_range"
    CHECK ("marginMaintenancePercent" >= 25 AND "marginMaintenancePercent" <= 100),
  ADD CONSTRAINT "Portfolio_marginDayCountBasis_supported"
    CHECK ("marginDayCountBasis" IN (360, 365));
