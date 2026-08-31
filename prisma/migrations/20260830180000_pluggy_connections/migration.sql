CREATE TABLE "PluggyConnection" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "label" TEXT,
  "legalContext" "LegalContext" NOT NULL DEFAULT 'pf',
  "lastUpdatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PluggyConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PluggyConnection_userId_itemId_key"
ON "PluggyConnection"("userId", "itemId");

CREATE INDEX "PluggyConnection_userId_idx"
ON "PluggyConnection"("userId");

ALTER TABLE "PluggyConnection"
ADD CONSTRAINT "PluggyConnection_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
