-- CreateTable
CREATE TABLE "GuestImport" (
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "portfolioIds" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestImport_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateIndex
CREATE INDEX "GuestImport_userId_idx" ON "GuestImport"("userId");

-- AddForeignKey
ALTER TABLE "GuestImport" ADD CONSTRAINT "GuestImport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

