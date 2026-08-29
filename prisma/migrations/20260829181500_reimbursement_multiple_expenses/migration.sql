CREATE TABLE "ReimbursementExpense" (
  "id" TEXT NOT NULL,
  "reimbursementId" TEXT NOT NULL,
  "expenseId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReimbursementExpense_pkey" PRIMARY KEY ("id")
);

INSERT INTO "ReimbursementExpense" ("id", "reimbursementId", "expenseId")
SELECT gen_random_uuid()::text, "id", "reimbursementOfId"
FROM "Transaction"
WHERE "reimbursementOfId" IS NOT NULL;

ALTER TABLE "ReimbursementExpense"
ADD CONSTRAINT "ReimbursementExpense_reimbursementId_fkey"
FOREIGN KEY ("reimbursementId") REFERENCES "Transaction"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReimbursementExpense"
ADD CONSTRAINT "ReimbursementExpense_expenseId_fkey"
FOREIGN KEY ("expenseId") REFERENCES "Transaction"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "ReimbursementExpense_reimbursementId_expenseId_key"
ON "ReimbursementExpense"("reimbursementId", "expenseId");

CREATE INDEX "ReimbursementExpense_reimbursementId_idx"
ON "ReimbursementExpense"("reimbursementId");

CREATE INDEX "ReimbursementExpense_expenseId_idx"
ON "ReimbursementExpense"("expenseId");
