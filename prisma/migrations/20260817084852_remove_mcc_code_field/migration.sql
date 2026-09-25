-- Drop unused numeric MCC code column. Merchants only ever pick a
-- human-readable category (mccCategory) from a fixed dropdown; the raw
-- code was never read anywhere in the codebase.
ALTER TABLE "merchants" DROP COLUMN "mcc";
