#!/usr/bin/env bash
# Valida o DDL da migration 20260913_traffic_insights contra o diff
# canônico gerado pelo Prisma (provider postgresql, from-empty).
# Não conecta em banco nenhum (regra 2 do prompt).
set -euo pipefail
cd /home/z/my-project

TMPDIR_SCHEMA=/tmp/schema-pg-check-traffic-insights
rm -rf "$TMPDIR_SCHEMA"
mkdir -p "$TMPDIR_SCHEMA"

# 1. Cópia do schema com provider postgresql (variante de produção —
#    mesma conversão feita pelo GUARD B do push-to-main.sh)
sed 's/^  provider = "sqlite"/  provider = "postgresql"/' prisma/schema.prisma \
  > "$TMPDIR_SCHEMA/schema.prisma"
grep -q 'provider = "postgresql"' "$TMPDIR_SCHEMA/schema.prisma" \
  || { echo "✖ provider postgresql não aplicado na cópia"; exit 1; }

# 2. Diff canônico from-empty → datamodel
DATABASE_URL="postgresql://u:p@localhost:5432/db" \
  npx prisma migrate diff \
    --from-empty \
    --to-schema-datamodel "$TMPDIR_SCHEMA/schema.prisma" \
    --script > "$TMPDIR_SCHEMA/canonical.sql" 2> "$TMPDIR_SCHEMA/diff.err" \
  || { echo "✖ migrate diff falhou:"; cat "$TMPDIR_SCHEMA/diff.err"; exit 1; }

# Normalização: IF NOT EXISTS fora, comentários fora, espaços colapsados,
# linhas vazias fora — MESMA função aplicada aos DOIS lados.
norm() {
  sed -e 's/ IF NOT EXISTS//g' \
      -e 's/--.*//' \
      -e 's/[[:space:]]\+/ /g' \
      -e 's/^ //' -e 's/ $//' \
      -e '/^$/d' "$1"
}

# 3. Extrai do canônico os blocos desta migration — do canônico JÁ
#    NORMALIZADO (sem linhas vazias), para janelas -A simétricas com a
#    parte "mine":
norm "$TMPDIR_SCHEMA/canonical.sql" > "$TMPDIR_SCHEMA/canonical.norm"
{
  grep -A19 'CREATE TABLE "meta_ad_insight_daily"' "$TMPDIR_SCHEMA/canonical.norm" || true
  echo ""
  grep -A9 'CREATE TABLE "meta_ads_sync_state"' "$TMPDIR_SCHEMA/canonical.norm" || true
  echo ""
  grep 'meta_ad_insight_daily_adAccountId_level_entityId_date_key\|meta_ad_insight_daily_level_date_idx\|meta_ad_insight_daily_campaignId_idx\|meta_ads_sync_state_adAccountId_key' "$TMPDIR_SCHEMA/canonical.norm" | grep -i 'CREATE.*INDEX' || true
} > "$TMPDIR_SCHEMA/canonical-blocks.raw"
norm "$TMPDIR_SCHEMA/canonical-blocks.raw" > "$TMPDIR_SCHEMA/canonical-blocks.norm"

# 4. Parte "mine": mesma normalização + mesmas janelas de extração
norm prisma/migrations/20260913_traffic_insights/migration.sql \
  > "$TMPDIR_SCHEMA/mine.norm"
{
  grep -v '^--' "$TMPDIR_SCHEMA/mine.norm" | grep -A19 'CREATE TABLE "meta_ad_insight_daily"' || true
  echo ""
  grep -v '^--' "$TMPDIR_SCHEMA/mine.norm" | grep -A9 'CREATE TABLE "meta_ads_sync_state"' || true
  echo ""
  grep 'meta_ad_insight_daily_adAccountId_level_entityId_date_key\|meta_ad_insight_daily_level_date_idx\|meta_ad_insight_daily_campaignId_idx\|meta_ads_sync_state_adAccountId_key' "$TMPDIR_SCHEMA/mine.norm" || true
} > "$TMPDIR_SCHEMA/mine-blocks.raw"

# A parte "mine" também passa pelo MESMO normalizador do canônico
# (separadores vazios e resíduos saem — comparação simétrica)
norm "$TMPDIR_SCHEMA/mine-blocks.raw" > "$TMPDIR_SCHEMA/mine-blocks.norm"

# 5. Confirma que os 6 objetos estão presentes na migration
for obj in \
  'CREATE TABLE "meta_ad_insight_daily"' \
  'CREATE TABLE "meta_ads_sync_state"' \
  'CREATE UNIQUE INDEX "meta_ad_insight_daily_adAccountId_level_entityId_date_key"' \
  'CREATE INDEX "meta_ad_insight_daily_level_date_idx"' \
  'CREATE INDEX "meta_ad_insight_daily_campaignId_idx"' \
  'CREATE UNIQUE INDEX "meta_ads_sync_state_adAccountId_key"'; do
  grep -qF "$obj" "$TMPDIR_SCHEMA/mine.norm" \
    || { echo "✖ Objeto ausente na migration: $obj"; exit 1; }
done

# 6. Compara blocos normalizados (tabelas + índices) — precisa ser 1:1
if diff -u "$TMPDIR_SCHEMA/canonical-blocks.norm" "$TMPDIR_SCHEMA/mine-blocks.norm" > "$TMPDIR_SCHEMA/block-diff.txt"; then
  echo "✔ DDL da migration == canônico Prisma (2 tabelas + 4 índices, escopado)"
else
  echo "✖ Divergência entre migration e canônico:"
  cat "$TMPDIR_SCHEMA/block-diff.txt"
  exit 1
fi

# 7. Asserções de schema: models declarados com mapa/unique corretos
grep -q 'model MetaAdInsightDaily' prisma/schema.prisma \
  || { echo "✖ model MetaAdInsightDaily ausente no schema"; exit 1; }
grep -q 'model MetaAdsSyncState' prisma/schema.prisma \
  || { echo "✖ model MetaAdsSyncState ausente no schema"; exit 1; }
grep -q '@@map("meta_ad_insight_daily")' prisma/schema.prisma \
  || { echo "✖ @@map meta_ad_insight_daily ausente"; exit 1; }
grep -q '@@map("meta_ads_sync_state")' prisma/schema.prisma \
  || { echo "✖ @@map meta_ads_sync_state ausente"; exit 1; }
grep -q '@@unique(\[adAccountId, level, entityId, date\])' prisma/schema.prisma \
  || { echo "✖ @@unique composto ausente"; exit 1; }
grep -Eq 'adAccountId +String +@unique @map\("adAccountId"\)' prisma/schema.prisma \
  || { echo "✖ adAccountId UNIQUE do sync state ausente"; exit 1; }

echo "✔ Migration 20260913_traffic_insights validada contra o canônico"
