-- ============================================================
-- Migration 20260911_enterprise_public_snapshot — Fase 7
-- (páginas públicas, imagens e PDF — otimização Vercel)
--
-- O que esta migration faz:
--   Tabela enterprise_public_snapshots — snapshot público versionado
--   da landing por (slug, locale) com payload pré-composto e
--   "impressão digital de frescor" (baseUpdatedAt = Enterprise.updatedAt
--   na captura + version = publishedVersion na captura). Publish,
--   unpublish/troca/remoção de base e qualquer mutação do empreendimento
--   divergem a digital (@updatedAt do Prisma) → recomposição imediata no
--   request seguinte — invalidação por construção, sem tocar N rotas.
--
-- Idempotente (IF NOT EXISTS em tudo) — pode rodar antes ou depois do
-- deploy do código: se a tabela estiver ausente (P2021/P2022), a lib de
-- snapshot degrada automaticamente para a composição dinâmica atual
-- (comportamento pré-Fase 7) com WARN único.
--
-- ROLLBACK (reverter esta migration):
--   DROP TABLE IF EXISTS "enterprise_public_snapshots";
--   (cache puro e reconstruível — nenhum dado de negócio; com a tabela
--    ausente o código cai para a composição dinâmica automaticamente.
--    Reversão instantânea sem SQL: PUBLIC_SNAPSHOT_V2=legacy + redeploy.)
--
-- EXPLAIN no release: leitura do caminho feliz é 1 findUnique por
-- (slug, locale) — UNIQUE index cobre; sem consulta nova de dashboard.
-- scripts/explain-public-snapshot.sql (Bloco 3 do pacote SQL Editor)
-- documenta Q1 (hit por PK única) e Q2 (invalidação por enterpriseId).
-- ============================================================

-- ── 1. Tabela do snapshot público ──
-- UMA linha por (slug, locale); payload é o JSON final que a landing SSR
-- e a API pública consomem (mesma shape do initialData), SEM pdfContent,
-- draft, PII de contato ou dados de fila.
CREATE TABLE IF NOT EXISTS "enterprise_public_snapshots" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "baseUpdatedAt" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enterprise_public_snapshots_pkey" PRIMARY KEY ("id")
);

-- ── 2. Invalidação em massa por empreendimento ──
-- deleteMany({ enterpriseId }) nas mutações de tabelas filhas
-- (imagens/plantas/formFields/slug) — índice simples.
CREATE INDEX IF NOT EXISTS "enterprise_public_snapshots_enterpriseId_idx" ON "enterprise_public_snapshots"("enterpriseId");

-- ── 3. Chave de leitura (UNIQUE slug+locale) ──
-- Caminho feliz do request público: 1 freshness (enterprises.slug unique)
-- + 1 findUnique por (slug, locale) — ambos por índice único.
CREATE UNIQUE INDEX IF NOT EXISTS "enterprise_public_snapshots_slug_locale_key" ON "enterprise_public_snapshots"("slug", "locale");

-- ── 4. FK para enterprises (cascade) ──
-- Idempotente: ADD CONSTRAINT não tem IF NOT EXISTS no Postgres.
-- Empreendimento removido → snapshots morrem junto (cache sem dono não
-- tem motivo para existir).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'enterprise_public_snapshots_enterpriseId_fkey'
  ) THEN
    ALTER TABLE "enterprise_public_snapshots"
      ADD CONSTRAINT "enterprise_public_snapshots_enterpriseId_fkey"
      FOREIGN KEY ("enterpriseId") REFERENCES "enterprises"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
