-- CreateEnum
CREATE TYPE "KycTier" AS ENUM ('TIER_0', 'TIER_1');

-- CreateEnum
CREATE TYPE "KycIdType" AS ENUM ('BVN', 'NIN');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "kycTier" "KycTier" NOT NULL DEFAULT 'TIER_0';

-- CreateTable
CREATE TABLE "KycVerification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "idType" "KycIdType" NOT NULL,
    "valueHash" TEXT NOT NULL,
    "matched" BOOLEAN NOT NULL,
    "provider" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KycVerification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KycVerification_userId_idx" ON "KycVerification"("userId");

-- AddForeignKey
ALTER TABLE "KycVerification" ADD CONSTRAINT "KycVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
