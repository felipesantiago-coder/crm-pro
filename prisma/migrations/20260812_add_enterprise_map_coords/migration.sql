-- AlterTable: add map coordinates to enterprises
ALTER TABLE "enterprises" ADD COLUMN IF NOT EXISTS "mapLatitude" DOUBLE PRECISION;
ALTER TABLE "enterprises" ADD COLUMN IF NOT EXISTS "mapLongitude" DOUBLE PRECISION;
