-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('SUPPORT', 'FINANCE', 'COMPLIANCE', 'SUPER_ADMIN');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "staffRole" "StaffRole";
