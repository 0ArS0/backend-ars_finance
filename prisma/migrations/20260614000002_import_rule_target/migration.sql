ALTER TABLE "ImportMappingRule" ADD COLUMN "targetAccountId" TEXT;

ALTER TABLE "ImportMappingRule" ADD CONSTRAINT "ImportMappingRule_targetAccountId_fkey" FOREIGN KEY ("targetAccountId") REFERENCES "FinancialAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
