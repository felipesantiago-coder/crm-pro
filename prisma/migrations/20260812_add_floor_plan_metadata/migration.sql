-- AlterTable: make url nullable
ALTER TABLE "enterprise_floor_plans" ALTER COLUMN "url" DROP NOT NULL;

-- Add new metadata columns
ALTER TABLE "enterprise_floor_plans" ADD COLUMN "name" TEXT;
ALTER TABLE "enterprise_floor_plans" ADD COLUMN "area" TEXT;
ALTER TABLE "enterprise_floor_plans" ADD COLUMN "bedrooms" INTEGER;
ALTER TABLE "enterprise_floor_plans" ADD COLUMN "suites" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "enterprise_floor_plans" ADD COLUMN "hasBalcony" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "enterprise_floor_plans" ADD COLUMN "isGarden" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "enterprise_floor_plans" ADD COLUMN "isPenthouse" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "enterprise_floor_plans" ADD COLUMN "description" TEXT;
