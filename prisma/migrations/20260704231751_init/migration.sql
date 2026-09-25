-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'MERCHANT', 'ADMIN');

-- CreateEnum
CREATE TYPE "UserKycStatus" AS ENUM ('PENDING', 'INITIATED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "MerchantKycStatus" AS ENUM ('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "MerchantStatus" AS ENUM ('PENDING', 'VERIFIED', 'ACTIVE', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "KycLevel" AS ENUM ('TIER_1', 'TIER_2', 'TIER_3');

-- CreateEnum
CREATE TYPE "BusinessType" AS ENUM ('SOLE_PROPRIETORSHIP', 'REGISTERED_COMPANY', 'INDIVIDUAL_TRADER');

-- CreateEnum
CREATE TYPE "QrType" AS ENUM ('STATIC', 'DYNAMIC');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "kycStatus" "UserKycStatus" NOT NULL DEFAULT 'PENDING',
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_registrations" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "emailOtp" TEXT NOT NULL,
    "mobileOtp" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchants" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bvn" TEXT,
    "nin" TEXT,
    "cacNumber" TEXT,
    "tin" TEXT,
    "kycLevel" "KycLevel" NOT NULL DEFAULT 'TIER_1',
    "kycStatus" "MerchantKycStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "nibssId" TEXT,
    "monnifyReference" TEXT,
    "paystackSubaccountCode" TEXT,
    "businessName" TEXT NOT NULL,
    "businessType" "BusinessType" NOT NULL DEFAULT 'SOLE_PROPRIETORSHIP',
    "description" TEXT,
    "ownerName" TEXT NOT NULL,
    "ownerDob" TIMESTAMP(3),
    "email" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL DEFAULT 'Not Provided',
    "addressLine2" TEXT,
    "addressCity" TEXT NOT NULL DEFAULT 'Lagos',
    "addressState" TEXT NOT NULL DEFAULT 'Lagos',
    "addressZip" TEXT,
    "addressCountry" TEXT NOT NULL DEFAULT 'Nigeria',
    "bankCode" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "status" "MerchantStatus" NOT NULL DEFAULT 'PENDING',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_virtual_accounts" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchant_virtual_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qr_codes" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "type" "QrType" NOT NULL,
    "rawData" TEXT NOT NULL,
    "imageUrl" TEXT,
    "amount" DECIMAL(12,2),
    "reference" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "qr_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_links" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "amount" DECIMAL(12,2),
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_mobile_key" ON "users"("mobile");

-- CreateIndex
CREATE UNIQUE INDEX "pending_registrations_email_key" ON "pending_registrations"("email");

-- CreateIndex
CREATE UNIQUE INDEX "pending_registrations_mobile_key" ON "pending_registrations"("mobile");

-- CreateIndex
CREATE UNIQUE INDEX "merchants_userId_key" ON "merchants"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "merchants_bvn_key" ON "merchants"("bvn");

-- CreateIndex
CREATE UNIQUE INDEX "merchants_nin_key" ON "merchants"("nin");

-- CreateIndex
CREATE UNIQUE INDEX "merchants_cacNumber_key" ON "merchants"("cacNumber");

-- CreateIndex
CREATE UNIQUE INDEX "merchants_tin_key" ON "merchants"("tin");

-- CreateIndex
CREATE UNIQUE INDEX "merchants_nibssId_key" ON "merchants"("nibssId");

-- CreateIndex
CREATE UNIQUE INDEX "merchants_monnifyReference_key" ON "merchants"("monnifyReference");

-- CreateIndex
CREATE UNIQUE INDEX "merchants_paystackSubaccountCode_key" ON "merchants"("paystackSubaccountCode");

-- CreateIndex
CREATE UNIQUE INDEX "merchants_email_key" ON "merchants"("email");

-- CreateIndex
CREATE UNIQUE INDEX "merchants_mobile_key" ON "merchants"("mobile");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_virtual_accounts_accountNumber_key" ON "merchant_virtual_accounts"("accountNumber");

-- CreateIndex
CREATE UNIQUE INDEX "qr_codes_reference_key" ON "qr_codes"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "payment_links_url_key" ON "payment_links"("url");

-- AddForeignKey
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_virtual_accounts" ADD CONSTRAINT "merchant_virtual_accounts_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
