-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "WithdrawalStatus" ADD VALUE 'PROCESSING';
ALTER TYPE "WithdrawalStatus" ADD VALUE 'FAILED';

-- AlterTable
ALTER TABLE "Withdrawal" ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "transferCode" TEXT,
ADD COLUMN     "transferInitiatedAt" TIMESTAMP(3),
ADD COLUMN     "transferReference" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Withdrawal_transferReference_key" ON "Withdrawal"("transferReference");

