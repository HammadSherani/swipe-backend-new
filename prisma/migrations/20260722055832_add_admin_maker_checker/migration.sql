-- AlterTable
ALTER TABLE "merchants" ADD COLUMN     "decidedAt" TIMESTAMP(3),
ADD COLUMN     "decidedByAdminId" TEXT,
ADD COLUMN     "reviewNotes" TEXT,
ADD COLUMN     "reviewRecommendation" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedByAdminId" TEXT;
