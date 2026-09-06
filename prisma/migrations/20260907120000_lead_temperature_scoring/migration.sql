-- ============================================================
-- Temperatura do lead POR FORMULÁRIO Meta Ads (Anúncios Meta)
-- Admin atribui nota inteira a cada resposta de cada pergunta;
-- o sistema soma as notas e classifica frio/morno/quente pelos
-- limiares warmMin/hotMin do PRÓPRIO formulário.
-- Idempotente (IF NOT EXISTS) — pode rerodar com segurança.
-- Rollback: DROP TABLE "lead_form_scorings";
--           DROP INDEX "clients_metaFormId_idx"; etc. + DROP COLUMN.
-- ============================================================

-- 1) Clients: rastreio da origem/respostas + resultado da pontuação
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "metaFormId" TEXT;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "metaFormData" TEXT;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "metaScore" INTEGER;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "metaTemperature" TEXT;

CREATE INDEX IF NOT EXISTS "clients_metaFormId_idx" ON "clients"("metaFormId");
CREATE INDEX IF NOT EXISTS "clients_metaTemperature_idx" ON "clients"("metaTemperature");
CREATE INDEX IF NOT EXISTS "clients_metaScore_idx" ON "clients"("metaScore");

-- 2) Config de pontuação por formulário (uma por formId)
CREATE TABLE IF NOT EXISTS "lead_form_scorings" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "formName" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "warmMin" INTEGER NOT NULL DEFAULT 5,
    "hotMin" INTEGER NOT NULL DEFAULT 10,
    "config" TEXT,
    "reclassifiedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_form_scorings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "lead_form_scorings_formId_key" ON "lead_form_scorings"("formId");
CREATE INDEX IF NOT EXISTS "lead_form_scorings_enabled_idx" ON "lead_form_scorings"("enabled");
