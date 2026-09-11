-- ============================================================
-- EXPLAIN das consultas críticas da Fase 6 (tracking/relatórios)
-- Executar UMA vez no release, contra o Postgres de produção
-- (SQL Editor do Supabase ou psql com DIRECT_DATABASE_URL 5432)
-- — regra 8 do prompt: índice só entra/permanece validado por EXPLAIN.
--
-- Expectativas (com dados):
--   Q1: Index Scan using tracking_events_siteId_createdAt_idx
--       (kpis/chart/breakdowns com siteId + janela)
--   Q2: Index Scan using tracking_events_siteId_eventType_createdAt_idx
--       (consultas por eventType: scroll/form/CTA/whatsapp/web_vital)
--   Q3: Index Scan using tracking_visitors_siteId_lastSeenAt_idx
--       (top países/cidades/dispositivos)
--   Q4: GROUPING SETS — UMA varredura produzindo os 5 breakdowns UTM
--       (antes: 5 varreduras); sem erro de sintaxe no PG do Supabase
--   Q5: plano do upsert do rate limit (EXPLAIN SEM ANALYZE — NÃO
--       escreve; com ANALYZE ele gravaria a linha de teste)
--   Q6: journey do report — teto por visitante via ROW_NUMBER
--
-- Com as tabelas vazias/pouco populadas o planner pode escolher Seq
-- Scan — normal no release; o essencial é (a) sem erro e (b) os
-- índices existem (Bloco de verificação do pacote SQL Editor).
-- Re-execute após os primeiros dias de tracking real.
-- ============================================================

SELECT '── Q1: siteId + janela (índice composto novo) ──' AS secao;
EXPLAIN (ANALYZE, BUFFERS)
SELECT
  COUNT(DISTINCT e."visitorId")::bigint AS visitors,
  COUNT(*) FILTER (WHERE e."eventType" = 'pageview')::bigint AS pageviews
FROM tracking_events e
WHERE e."createdAt" >= now() - interval '30 days'
  AND e."siteId" = 'QA_SITE_001';

SELECT '── Q2: siteId + eventType + janela (índice composto novo) ──' AS secao;
EXPLAIN (ANALYZE, BUFFERS)
SELECT COUNT(*)::bigint AS count
FROM tracking_events e
WHERE e."eventType" = 'whatsapp_click'
  AND e."createdAt" >= now() - interval '30 days'
  AND e."siteId" = 'QA_SITE_001';

SELECT '── Q3: visitors por siteId + lastSeenAt (índice composto novo) ──' AS secao;
EXPLAIN (ANALYZE, BUFFERS)
SELECT COALESCE(v."country", '(desconhecido)') AS country, COUNT(*)::bigint
FROM tracking_visitors v
WHERE v."lastSeenAt" >= now() - interval '30 days'
  AND v."siteId" = 'QA_SITE_001'
GROUP BY 1
ORDER BY 2 DESC
LIMIT 10;

SELECT '── Q4: GROUPING SETS dos breakdowns UTM (1 scan → 5 breakdowns) ──' AS secao;
EXPLAIN (ANALYZE, BUFFERS)
SELECT
  CASE
    WHEN GROUPING(e."utmCampaign") = 0 THEN 'campaign'
    WHEN GROUPING(e."utmSource") = 0 THEN 'source'
    WHEN GROUPING(e."utmContent") = 0 THEN 'content'
    WHEN GROUPING(e."utmMedium") = 0 THEN 'medium'
    ELSE 'term'
  END AS dimension,
  COUNT(DISTINCT e."visitorId")::bigint AS visitors
FROM tracking_events e
WHERE e."createdAt" >= now() - interval '30 days'
  AND e."siteId" = 'QA_SITE_001'
GROUP BY GROUPING SETS (
  (e."utmCampaign"), (e."utmSource"), (e."utmContent"), (e."utmMedium"), (e."utmTerm")
);

SELECT '── Q5: upsert do rate limit distribuído (EXPLAIN puro — NÃO escreve) ──' AS secao;
EXPLAIN
INSERT INTO "tracking_rate_limit" ("key", "windowStart", "count", "updatedAt")
VALUES ('QA_IP_EXPLAIN', now(), 1, now())
ON CONFLICT ("key") DO UPDATE SET
  "count" = CASE
    WHEN "tracking_rate_limit"."windowStart" < now() - interval '60 seconds'
    THEN 1
    ELSE "tracking_rate_limit"."count" + 1
  END,
  "windowStart" = CASE
    WHEN "tracking_rate_limit"."windowStart" < now() - interval '60 seconds'
    THEN now()
    ELSE "tracking_rate_limit"."windowStart"
  END,
  "updatedAt" = now()
RETURNING "count" AS count;

SELECT '── Q6: journey do report (teto por visitante ROW_NUMBER + LIMIT global) ──' AS secao;
EXPLAIN
SELECT j."visitorId", j."eventType", j."pageUrl", j."createdAt"
FROM (
  SELECT e."visitorId", e."eventType", e."pageUrl", e."createdAt",
         ROW_NUMBER() OVER (PARTITION BY e."visitorId" ORDER BY e."createdAt") AS rn
  FROM tracking_events e
  WHERE e."visitorId" IN (
    SELECT DISTINCT v."visitorId"
    FROM tracking_visitors v
    WHERE v."leadId" IS NOT NULL
      AND v."lastSeenAt" >= now() - interval '30 days'
      AND v."siteId" = 'QA_SITE_001'
  )
    AND e."createdAt" >= now() - interval '30 days'
) j
WHERE j.rn <= 200
ORDER BY j."visitorId", j."createdAt" ASC
LIMIT 5001;
