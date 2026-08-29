CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Session" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

ALTER TABLE "Session"
ADD CONSTRAINT "Session_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FinancialAccount" ADD COLUMN "userId" TEXT;
ALTER TABLE "AppSetting" ADD COLUMN "userId" TEXT;
ALTER TABLE "Category" ADD COLUMN "userId" TEXT;
ALTER TABLE "Payee" ADD COLUMN "userId" TEXT;
ALTER TABLE "ImportMappingRule" ADD COLUMN "userId" TEXT;
ALTER TABLE "Beneficiary" ADD COLUMN "userId" TEXT;
ALTER TABLE "Goal" ADD COLUMN "userId" TEXT;
ALTER TABLE "InvestmentAccount" ADD COLUMN "userId" TEXT;

CREATE UNIQUE INDEX "AppSetting_userId_key" ON "AppSetting"("userId");
CREATE INDEX "FinancialAccount_userId_idx" ON "FinancialAccount"("userId");
CREATE INDEX "Category_userId_idx" ON "Category"("userId");
CREATE INDEX "Payee_userId_idx" ON "Payee"("userId");
CREATE INDEX "ImportMappingRule_userId_idx" ON "ImportMappingRule"("userId");
CREATE INDEX "Beneficiary_userId_idx" ON "Beneficiary"("userId");
CREATE INDEX "Goal_userId_idx" ON "Goal"("userId");
CREATE INDEX "InvestmentAccount_userId_idx" ON "InvestmentAccount"("userId");

ALTER TABLE "FinancialAccount"
ADD CONSTRAINT "FinancialAccount_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AppSetting"
ADD CONSTRAINT "AppSetting_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Category"
ADD CONSTRAINT "Category_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Payee"
ADD CONSTRAINT "Payee_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ImportMappingRule"
ADD CONSTRAINT "ImportMappingRule_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Beneficiary"
ADD CONSTRAINT "Beneficiary_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Goal"
ADD CONSTRAINT "Goal_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InvestmentAccount"
ADD CONSTRAINT "InvestmentAccount_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
