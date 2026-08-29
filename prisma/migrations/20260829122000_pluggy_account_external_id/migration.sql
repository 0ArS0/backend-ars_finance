ALTER TABLE "FinancialAccount" ADD COLUMN "externalId" TEXT;

CREATE UNIQUE INDEX "FinancialAccount_externalId_key" ON "FinancialAccount"("externalId");
