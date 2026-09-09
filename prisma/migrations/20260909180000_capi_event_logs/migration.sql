-- CAPI Event Log — trilha de auditoria dos envios à Conversions API
-- (sendLeadConversionEvent). Torna visíveis no painel falhas de envio
-- que antes eram apenas console.error silencioso no servidor.
-- Sem foreign keys: snapshots denormalizados (capiConfigName/clientName)
-- sobrevivem à exclusão do config CAPI ou do cliente.
-- Rollback: DROP TABLE "capi_event_logs";

CREATE TABLE IF NOT EXISTS "capi_event_logs" (
    "id" TEXT NOT NULL,
    "capiConfigId" TEXT,
    "capiConfigName" TEXT,
    "clientId" TEXT,
    "clientName" TEXT,
    "eventName" TEXT,
    "stage" TEXT,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "metaResponse" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "capi_event_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "capi_event_logs_capiConfigId_createdAt_idx" ON "capi_event_logs"("capiConfigId", "createdAt");

CREATE INDEX IF NOT EXISTS "capi_event_logs_status_createdAt_idx" ON "capi_event_logs"("status", "createdAt");

CREATE INDEX IF NOT EXISTS "capi_event_logs_createdAt_idx" ON "capi_event_logs"("createdAt");
