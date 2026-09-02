-- Roteamento multi-anúncio: filas de atendimento dedicadas por formulário/config
-- Aditivo e não destrutivo (colunas nullable + índice).

-- AlterTable
ALTER TABLE "meta_cap_configs" ADD COLUMN "queueId" TEXT;

-- AlterTable
ALTER TABLE "lead_form_mappings" ADD COLUMN "queueId" TEXT;

-- CreateIndex
CREATE INDEX "lead_form_mappings_queueId_idx" ON "lead_form_mappings"("queueId");

-- AddForeignKey
ALTER TABLE "meta_cap_configs" ADD CONSTRAINT "meta_cap_configs_queueId_fkey" FOREIGN KEY ("queueId") REFERENCES "lead_queues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_form_mappings" ADD CONSTRAINT "lead_form_mappings_queueId_fkey" FOREIGN KEY ("queueId") REFERENCES "lead_queues"("id") ON DELETE SET NULL ON UPDATE CASCADE;
