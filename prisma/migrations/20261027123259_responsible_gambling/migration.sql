-- CreateEnum
CREATE TYPE "GamblingLimitKind" AS ENUM ('DEPOSIT', 'STAKE');

-- CreateEnum
CREATE TYPE "GamblingLimitPeriod" AS ENUM ('DAY', 'WEEK', 'MONTH');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "coolingOffUntil" TIMESTAMP(3),
ADD COLUMN     "selfExcludedPermanent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "selfExcludedUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "GamblingLimit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "GamblingLimitKind" NOT NULL,
    "period" "GamblingLimitPeriod" NOT NULL,
    "amount" DECIMAL(14,2),
    "pendingAmount" DECIMAL(14,2),
    "pendingEffectiveAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GamblingLimit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GamblingLimit_userId_kind_period_key" ON "GamblingLimit"("userId", "kind", "period");

-- AddForeignKey
ALTER TABLE "GamblingLimit" ADD CONSTRAINT "GamblingLimit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
