-- CreateEnum
CREATE TYPE "PersonRole" AS ENUM ('DIRECTOR', 'SHAREHOLDER_UBO');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MerchantStatus" ADD VALUE 'IN_PROGRESS';
ALTER TYPE "MerchantStatus" ADD VALUE 'PENDING_REVIEW';

-- AlterTable
ALTER TABLE "merchants" ADD COLUMN     "addressLga" TEXT,
ADD COLUMN     "addressProofSubmittedAt" TIMESTAMP(3),
ADD COLUMN     "cacStatus" "CheckStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "cacVerifiedStatus" TEXT,
ADD COLUMN     "expectedMonthlyVolume" DECIMAL(14,2),
ADD COLUMN     "mcc" TEXT,
ADD COLUMN     "mccCategory" TEXT,
ADD COLUMN     "nubanStatus" "CheckStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "privacyConsentAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "scumlNumber" TEXT,
ADD COLUMN     "sectorLicenseNumber" TEXT,
ADD COLUMN     "socialHandles" JSONB,
ADD COLUMN     "termsAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "tradeName" TEXT;

-- CreateTable
CREATE TABLE "merchant_persons" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "personRole" "PersonRole" NOT NULL,
    "fullName" TEXT NOT NULL,
    "bvn" TEXT,
    "nin" TEXT,
    "ownershipPercent" DOUBLE PRECISION,
    "bvnStatus" "CheckStatus" NOT NULL DEFAULT 'PENDING',
    "ninStatus" "CheckStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchant_persons_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "merchant_persons" ADD CONSTRAINT "merchant_persons_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
