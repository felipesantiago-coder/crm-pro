-- CreateTable: enterprise_floor_plans
CREATE TABLE "enterprise_floor_plans" (
    "id" TEXT NOT NULL,
    "url" TEXT,
    "altText" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "enterpriseId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Plant metadata fields
    "name" TEXT,
    "area" TEXT,
    "bedrooms" INTEGER,
    "suites" INTEGER NOT NULL DEFAULT 0,
    "hasBalcony" BOOLEAN NOT NULL DEFAULT false,
    "isGarden" BOOLEAN NOT NULL DEFAULT false,
    "isPenthouse" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,

    CONSTRAINT "enterprise_floor_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: enterprise_floor_plans_enterpriseId_idx
CREATE INDEX "enterprise_floor_plans_enterpriseId_idx" ON "enterprise_floor_plans"("enterpriseId");

-- AddForeignKey: enterprise_floor_plans_enterpriseId_fkey
ALTER TABLE "enterprise_floor_plans" ADD CONSTRAINT "enterprise_floor_plans_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "enterprises"("id") ON DELETE CASCADE ON UPDATE CASCADE;
