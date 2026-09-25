-- CreateEnum
CREATE TYPE "CheckStatus" AS ENUM ('PENDING', 'VERIFIED', 'FAILED', 'MANUAL_REVIEW');

-- AlterTable
ALTER TABLE "merchants" ADD COLUMN     "bvnAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "bvnConsentAt" TIMESTAMP(3),
ADD COLUMN     "bvnConsentIp" TEXT,
ADD COLUMN     "bvnStatus" "CheckStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "faceAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "faceMatchConfidence" DOUBLE PRECISION,
ADD COLUMN     "faceMatchStatus" "CheckStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "ninAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ninStatus" "CheckStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "verifiedName" TEXT;

-- CreateTable
CREATE TABLE "kyc_audit_logs" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "result" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kyc_audit_logs_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "kyc_audit_logs" ADD CONSTRAINT "kyc_audit_logs_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
