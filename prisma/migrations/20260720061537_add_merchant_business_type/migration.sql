/*
  Warnings:

  - The values [REGISTERED_COMPANY] on the enum `BusinessType` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "BusinessType_new" AS ENUM ('INDIVIDUAL_TRADER', 'SOLE_PROPRIETORSHIP', 'PARTNERSHIP', 'LIMITED_LIABILITY', 'INCORPORATED_TRUSTEES');
ALTER TABLE "merchants" ALTER COLUMN "businessType" DROP DEFAULT;
ALTER TABLE "merchants" ALTER COLUMN "businessType" TYPE "BusinessType_new" USING ("businessType"::text::"BusinessType_new");
ALTER TYPE "BusinessType" RENAME TO "BusinessType_old";
ALTER TYPE "BusinessType_new" RENAME TO "BusinessType";
DROP TYPE "BusinessType_old";
ALTER TABLE "merchants" ALTER COLUMN "businessType" SET DEFAULT 'SOLE_PROPRIETORSHIP';
COMMIT;
