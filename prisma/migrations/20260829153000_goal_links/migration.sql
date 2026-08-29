CREATE TABLE "GoalLink" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "title" TEXT,
    "url" TEXT NOT NULL,
    "context" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GoalLink_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GoalLink_goalId_idx" ON "GoalLink"("goalId");

ALTER TABLE "GoalLink"
ADD CONSTRAINT "GoalLink_goalId_fkey"
FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
