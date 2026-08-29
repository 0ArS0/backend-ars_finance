-- Drop old schema
DROP TABLE IF EXISTS "Transaction" CASCADE;
DROP TYPE IF EXISTS "TransactionType" CASCADE;
DROP TYPE IF EXISTS "TransactionCategory" CASCADE;
DROP TYPE IF EXISTS "TransactionAccount" CASCADE;

-- CreateEnum
CREATE TYPE "AccountKind" AS ENUM ('checking', 'savings', 'cash', 'credit_card', 'investment', 'wallet');
CREATE TYPE "LegalContext" AS ENUM ('pf', 'pj');
CREATE TYPE "TransactionDirection" AS ENUM ('inflow', 'outflow');
CREATE TYPE "PaymentMethod" AS ENUM ('debit', 'credit', 'cash', 'pix', 'transfer', 'boleto', 'investment');
CREATE TYPE "IncomeKind" AS ENUM ('salary', 'reimbursement', 'gift', 'bonus', 'freelance', 'other');
CREATE TYPE "CategoryKind" AS ENUM ('expense', 'income', 'transfer');
CREATE TYPE "BudgetType" AS ENUM ('fixed', 'variable', 'discretionary');
CREATE TYPE "RecurrenceFrequency" AS ENUM ('daily', 'weekly', 'monthly', 'yearly');
CREATE TYPE "InvestmentTransactionType" AS ENUM ('buy', 'sell', 'dividend', 'contribution');

-- CreateTable
CREATE TABLE "FinancialAccount" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "AccountKind" NOT NULL,
    "legalContext" "LegalContext" NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "openingBalance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "creditLimit" DECIMAL(12,2),
    "closingDay" INTEGER,
    "dueDay" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FinancialAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "kind" "CategoryKind" NOT NULL,
    "budgetType" "BudgetType",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Payee" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Payee_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Beneficiary" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Beneficiary_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CreditCardStatement" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "referenceMonth" DATE NOT NULL,
    "closingDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreditCardStatement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecurringRule" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "direction" "TransactionDirection" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "description" TEXT NOT NULL,
    "frequency" "RecurrenceFrequency" NOT NULL,
    "dayOfMonth" INTEGER,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "categoryId" TEXT,
    "beneficiaryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecurringRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "direction" "TransactionDirection" NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "description" VARCHAR(120) NOT NULL,
    "notes" TEXT,
    "transactionDate" DATE NOT NULL,
    "postedDate" DATE,
    "dueDate" DATE,
    "incomeKind" "IncomeKind",
    "categoryId" TEXT,
    "payeeId" TEXT,
    "beneficiaryId" TEXT,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "recurringRuleId" TEXT,
    "installmentN" INTEGER,
    "installmentTotal" INTEGER,
    "parentId" TEXT,
    "statementId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Goal" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "targetAmount" DECIMAL(12,2) NOT NULL,
    "targetDate" DATE,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GoalAllocation" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "transactionId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "allocatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GoalAllocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InvestmentAccount" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalContext" "LegalContext" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InvestmentAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InvestmentHolding" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "assetSymbol" TEXT NOT NULL,
    "assetName" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "avgPrice" DECIMAL(12,2) NOT NULL,
    CONSTRAINT "InvestmentHolding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InvestmentTransaction" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" "InvestmentTransactionType" NOT NULL,
    "assetSymbol" TEXT NOT NULL,
    "assetName" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "occurredAt" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InvestmentTransaction_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "CreditCardStatement_accountId_referenceMonth_idx" ON "CreditCardStatement"("accountId", "referenceMonth");
CREATE INDEX "Transaction_transactionDate_idx" ON "Transaction"("transactionDate");
CREATE INDEX "Transaction_accountId_idx" ON "Transaction"("accountId");
CREATE INDEX "Transaction_statementId_idx" ON "Transaction"("statementId");
CREATE UNIQUE INDEX "Beneficiary_slug_key" ON "Beneficiary"("slug");
CREATE UNIQUE INDEX "InvestmentHolding_accountId_assetSymbol_key" ON "InvestmentHolding"("accountId", "assetSymbol");

-- ForeignKeys
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CreditCardStatement" ADD CONSTRAINT "CreditCardStatement_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FinancialAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecurringRule" ADD CONSTRAINT "RecurringRule_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FinancialAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecurringRule" ADD CONSTRAINT "RecurringRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RecurringRule" ADD CONSTRAINT "RecurringRule_beneficiaryId_fkey" FOREIGN KEY ("beneficiaryId") REFERENCES "Beneficiary"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FinancialAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_payeeId_fkey" FOREIGN KEY ("payeeId") REFERENCES "Payee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_beneficiaryId_fkey" FOREIGN KEY ("beneficiaryId") REFERENCES "Beneficiary"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_recurringRuleId_fkey" FOREIGN KEY ("recurringRuleId") REFERENCES "RecurringRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "CreditCardStatement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GoalAllocation" ADD CONSTRAINT "GoalAllocation_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GoalAllocation" ADD CONSTRAINT "GoalAllocation_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InvestmentHolding" ADD CONSTRAINT "InvestmentHolding_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "InvestmentAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InvestmentTransaction" ADD CONSTRAINT "InvestmentTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "InvestmentAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
