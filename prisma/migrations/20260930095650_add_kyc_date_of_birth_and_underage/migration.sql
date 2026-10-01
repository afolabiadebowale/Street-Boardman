-- AlterTable
ALTER TABLE "KycVerification" ADD COLUMN     "dateOfBirth" TIMESTAMP(3),
ADD COLUMN     "underage" BOOLEAN NOT NULL DEFAULT false;
