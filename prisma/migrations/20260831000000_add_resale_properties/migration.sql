-- CreateTable
CREATE TABLE "resale_properties" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT,
    "region" TEXT,
    "category" TEXT NOT NULL DEFAULT 'Outro',
    "typology" TEXT,
    "bedrooms" INTEGER,
    "area" DOUBLE PRECISION,
    "address" TEXT,
    "captor" TEXT,
    "appointment" TEXT,
    "phone" TEXT,
    "phoneDigits" TEXT,
    "price" DOUBLE PRECISION,
    "condo" DOUBLE PRECISION,
    "iptu" DOUBLE PRECISION,
    "notes" TEXT,
    "acceptsFinancing" BOOLEAN NOT NULL DEFAULT false,
    "acceptsFgts" BOOLEAN NOT NULL DEFAULT false,
    "url" TEXT,
    "dataNote" TEXT,
    "sourcePage" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "resale_properties_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "resale_properties_enterpriseId_idx" ON "resale_properties"("enterpriseId");

-- CreateIndex
CREATE INDEX "resale_properties_region_idx" ON "resale_properties"("region");

-- CreateIndex
CREATE INDEX "resale_properties_category_idx" ON "resale_properties"("category");

-- CreateIndex
CREATE INDEX "resale_properties_price_idx" ON "resale_properties"("price");

-- CreateIndex
CREATE INDEX "resale_properties_bedrooms_idx" ON "resale_properties"("bedrooms");

-- CreateIndex
CREATE UNIQUE INDEX "resale_properties_enterpriseId_code_key" ON "resale_properties"("enterpriseId", "code");

-- AddForeignKey
ALTER TABLE "resale_properties" ADD CONSTRAINT "resale_properties_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "enterprises"("id") ON DELETE CASCADE ON UPDATE CASCADE;
