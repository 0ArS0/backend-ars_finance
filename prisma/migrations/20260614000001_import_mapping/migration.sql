CREATE TYPE "ImportMatchType" AS ENUM ('contains', 'starts_with', 'document');

ALTER TABLE "Transaction" ADD COLUMN "externalId" TEXT;
CREATE UNIQUE INDEX "Transaction_externalId_key" ON "Transaction"("externalId");

CREATE TABLE "ImportMappingRule" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "matchType" "ImportMatchType" NOT NULL DEFAULT 'contains',
    "beneficiaryId" TEXT,
    "categoryId" TEXT,
    "incomeKind" "IncomeKind",
    "skip" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportMappingRule_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ImportMappingRule" ADD CONSTRAINT "ImportMappingRule_beneficiaryId_fkey" FOREIGN KEY ("beneficiaryId") REFERENCES "Beneficiary"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ImportMappingRule" ADD CONSTRAINT "ImportMappingRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
