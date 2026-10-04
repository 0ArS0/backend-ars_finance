ALTER TABLE "InvestmentHolding" ADD COLUMN "investedAmount" DECIMAL(14,2);
UPDATE "InvestmentHolding" SET "investedAmount" = ROUND(("quantity" * "avgPrice")::numeric, 2) WHERE "investedAmount" IS NULL;
