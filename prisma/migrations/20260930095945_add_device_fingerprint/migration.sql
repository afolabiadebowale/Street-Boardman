-- AlterTable
ALTER TABLE "User" ADD COLUMN     "deviceFingerprint" TEXT;

-- CreateIndex
CREATE INDEX "User_deviceFingerprint_idx" ON "User"("deviceFingerprint");
