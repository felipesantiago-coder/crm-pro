-- CreateTable: meta_cap_configs
CREATE TABLE "meta_cap_configs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "formIds" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meta_cap_configs_pkey" PRIMARY KEY ("id")
);

-- AlterTable: clients
ALTER TABLE "clients" ADD COLUMN "metaCapConfigId" TEXT;

-- CreateIndex: clients_metaCapConfigId_index
CREATE INDEX "clients_metaCapConfigId_index" ON "clients" ("metaCapConfigId");

-- AddForeignKey: clients_metaCapConfigId_fkey
ALTER TABLE "clients" ADD CONSTRAINT "clients_metaCapConfigId_fkey" FOREIGN KEY ("metaCapConfigId") REFERENCES "meta_cap_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
