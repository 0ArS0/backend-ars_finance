ALTER TABLE "RecurringRule"
ADD COLUMN "budgetType" "BudgetType" NOT NULL DEFAULT 'variable';

UPDATE "RecurringRule" AS rule
SET "budgetType" = category."budgetType"
FROM "Category" AS category
WHERE rule."categoryId" = category."id"
  AND category."budgetType" IN ('fixed', 'variable');
