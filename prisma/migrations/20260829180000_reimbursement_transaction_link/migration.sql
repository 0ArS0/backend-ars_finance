ALTER TABLE "Transaction"
ADD COLUMN "reimbursementOfId" TEXT;

ALTER TABLE "Transaction"
ADD CONSTRAINT "Transaction_reimbursementOfId_fkey"
FOREIGN KEY ("reimbursementOfId") REFERENCES "Transaction"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Transaction_reimbursementOfId_idx"
ON "Transaction"("reimbursementOfId");
