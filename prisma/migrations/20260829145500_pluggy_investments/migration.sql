ALTER TABLE "InvestmentAccount" ADD COLUMN "externalId" TEXT;
CREATE UNIQUE INDEX "InvestmentAccount_externalId_key" ON "InvestmentAccount"("externalId");
ALTER TABLE "InvestmentHolding" ADD COLUMN "currentValue" DECIMAL(14, 2);
