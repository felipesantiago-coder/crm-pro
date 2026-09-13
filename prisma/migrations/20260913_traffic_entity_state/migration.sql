-- ============================================================
-- Fase 8.2 (gestor de tráfego — estado de entrega/orçamento)
-- 20260913_traffic_entity_state
-- Espelho PONTUAL de /campaigns e /adsets: daily_budget, status,
-- effective_status e learning_stage_info por entidade. PURAMENTE
-- ADITIVO: nenhuma tabela/coluna existente é alterada ou removida.
-- Idempotente: pode ser re-executado sem erro (IF NOT EXISTS).
-- Ordem dos statements espelha o diff canônico do Prisma
-- (validate-traffic-entity-state.sh compara 1:1 normalizado).
-- ============================================================

-- 1. Estado de entrega/orçamento por (conta, nível, entidade)
CREATE TABLE IF NOT EXISTS "meta_ad_entity_state" (
    "id" TEXT NOT NULL,
    "adAccountId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityName" TEXT,
    "campaignId" TEXT,
    "dailyBudgetMinor" INTEGER,
    "lifetimeBudgetMinor" INTEGER,
    "status" TEXT,
    "effectiveStatus" TEXT,
    "learningStage" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meta_ad_entity_state_pkey" PRIMARY KEY ("id")
);

-- 2. Índices e chaves (ordem = emissão do diff canônico do Prisma:
--    @@index antes de @@unique)
-- UNIQUE composta = rede de segurança do snapshot-replace por conta.
CREATE INDEX IF NOT EXISTS "meta_ad_entity_state_campaignId_idx" ON "meta_ad_entity_state"("campaignId");
CREATE UNIQUE INDEX IF NOT EXISTS "meta_ad_entity_state_adAccountId_level_entityId_key" ON "meta_ad_entity_state"("adAccountId", "level", "entityId");
