-- AlterTable
ALTER TABLE "Bet" ADD COLUMN     "shareToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Bet_shareToken_key" ON "Bet"("shareToken");

