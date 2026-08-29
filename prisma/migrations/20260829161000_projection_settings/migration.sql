CREATE TABLE "AppSetting" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "monthlyIncome" DECIMAL(12,2),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("id")
);
