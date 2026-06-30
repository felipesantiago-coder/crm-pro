-- ============================================================
-- MIGRAÇÃO: Tracking Pixel — Tabelas de Visitantes e Eventos
-- Execute no SQL Editor do Supabase (https://supabase.com/dashboard)
-- ============================================================

-- 1. Tabela de Visitantes rastreados
CREATE TABLE IF NOT EXISTS "tracking_visitors" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "visitorId" TEXT NOT NULL UNIQUE,
  "siteId" TEXT NOT NULL,
  "leadId" TEXT,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "ip" TEXT,
  "userAgent" TEXT,
  "country" TEXT,
  "city" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW()
);

-- 2. Tabela de Eventos de tracking
CREATE TABLE IF NOT EXISTS "tracking_events" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "visitorId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "eventName" TEXT,
  "pageUrl" TEXT,
  "referrer" TEXT,
  "utmSource" TEXT,
  "utmMedium" TEXT,
  "utmCampaign" TEXT,
  "utmContent" TEXT,
  "utmTerm" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  CONSTRAINT "tracking_events_visitorId_fkey" 
    FOREIGN KEY ("visitorId") REFERENCES "tracking_visitors"("visitorId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- 3. Índices para performance
CREATE INDEX IF NOT EXISTS "tracking_visitors_siteId_idx" ON "tracking_visitors"("siteId");
CREATE INDEX IF NOT EXISTS "tracking_visitors_leadId_idx" ON "tracking_visitors"("leadId");
CREATE INDEX IF NOT EXISTS "tracking_visitors_lastSeenAt_idx" ON "tracking_visitors"("lastSeenAt");

CREATE INDEX IF NOT EXISTS "tracking_events_siteId_eventType_idx" ON "tracking_events"("siteId", "eventType");
CREATE INDEX IF NOT EXISTS "tracking_events_siteId_utmCampaign_idx" ON "tracking_events"("siteId", "utmCampaign");
CREATE INDEX IF NOT EXISTS "tracking_events_visitorId_idx" ON "tracking_events"("visitorId");
CREATE INDEX IF NOT EXISTS "tracking_events_sessionId_idx" ON "tracking_events"("sessionId");
CREATE INDEX IF NOT EXISTS "tracking_events_createdAt_idx" ON "tracking_events"("createdAt");

-- 4. Trigger para atualizar lastSeenAt automaticamente
CREATE OR REPLACE FUNCTION "update_tracking_visitor_last_seen"()
RETURNS TRIGGER AS $$
BEGIN
  NEW."lastSeenAt" = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "tracking_visitor_last_seen_trigger" ON "tracking_visitors";
CREATE TRIGGER "tracking_visitor_last_seen_trigger"
  BEFORE UPDATE ON "tracking_visitors"
  FOR EACH ROW
  EXECUTE FUNCTION "update_tracking_visitor_last_seen"();

-- 5. Habilitar RLS (Row Level Security) — opcional mas recomendado
ALTER TABLE "tracking_visitors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tracking_events" ENABLE ROW LEVEL SECURITY;

-- Política: permitir INSERT sem autenticação (pixel público)
CREATE POLICY "tracking_visitors_allow_insert" ON "tracking_visitors"
  FOR INSERT WITH CHECK (true);

CREATE POLICY "tracking_events_allow_insert" ON "tracking_events"
  FOR INSERT WITH CHECK (true);

-- Política: permitir SELECT para usuários autenticados (dashboard)
CREATE POLICY "tracking_visitors_allow_select" ON "tracking_visitors"
  FOR SELECT USING (true);

CREATE POLICY "tracking_events_allow_select" ON "tracking_events"
  FOR SELECT USING (true);

-- Política: permitir UPDATE para vincular leadId
CREATE POLICY "tracking_visitors_allow_update" ON "tracking_visitors"
  FOR UPDATE USING (true) WITH CHECK (true);