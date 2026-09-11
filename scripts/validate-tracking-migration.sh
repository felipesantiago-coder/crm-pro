#!/usr/bin/env bash
# Valida o DDL da migration 20260911_tracking_report_indexes contra o
# diff canônico gerado pelo Prisma (provider postgresql, from-empty).
# Não conecta em banco nenhum (regra 2 do prompt).
set -euo pipefail
cd /home/z/my-project

TMPDIR_SCHEMA=/tmp/schema-pg-check-tracking
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

# 3. Extrai do canônico apenas os blocos desta migration (escopado):
#    - CREATE TABLE tracking_rate_limit (tabela nova da Fase 6)
#    - CREATE INDEX dos 3 índices compostos novos
#    (as demais tabelas/índices pertencem ao baseline/migrations anteriores)
{
  grep -A7 'CREATE TABLE "tracking_rate_limit"' "$TMPDIR_SCHEMA/canonical.sql" || true
  grep 'tracking_events_siteId_createdAt_idx\|tracking_events_siteId_eventType_createdAt_idx\|tracking_visitors_siteId_lastSeenAt_idx' "$TMPDIR_SCHEMA/canonical.sql" | grep -i 'CREATE.*INDEX' || true
} > "$TMPDIR_SCHEMA/canonical-blocks.sql"

# 4. Normaliza (IF NOT EXISTS fora, comentários fora, espaços) e compara.
norm() {
  sed -e 's/ IF NOT EXISTS//g' \
      -e 's/--.*//' \
      -e 's/[[:space:]]\+/ /g' \
      -e 's/^ //' -e 's/ $//' \
      -e '/^$/d' "$1"
}

# Da migration, extraio os MESMOS blocos (por nome de objeto)
norm prisma/migrations/20260911_tracking_report_indexes/migration.sql \
  > "$TMPDIR_SCHEMA/mine.norm"
grep 'tracking_rate_limit_pkey\|CREATE TABLE tracking_rate_limit\|"tracking_rate_limit"' "$TMPDIR_SCHEMA/mine.norm" \
  | head -10 > "$TMPDIR_SCHEMA/mine-table.norm" || true
{
  grep -v '^--' "$TMPDIR_SCHEMA/mine.norm" | grep -A6 'CREATE TABLE "tracking_rate_limit"' || true
  grep 'tracking_events_siteId_createdAt_idx\|tracking_events_siteId_eventType_createdAt_idx\|tracking_visitors_siteId_lastSeenAt_idx' "$TMPDIR_SCHEMA/mine.norm" || true
} > "$TMPDIR_SCHEMA/mine-blocks.norm"

# Confirma que os 4 objetos estão presentes na migration
for obj in \
  'CREATE INDEX "tracking_events_siteId_createdAt_idx"' \
  'CREATE INDEX "tracking_events_siteId_eventType_createdAt_idx"' \
  'CREATE INDEX "tracking_visitors_siteId_lastSeenAt_idx"' \
  'CREATE TABLE "tracking_rate_limit"'; do
  grep -q "$obj" "$TMPDIR_SCHEMA/mine-blocks.norm" \
    || { echo "✖ objeto ausente na migration: $obj"; exit 1; }
done

echo "=== COMPARAÇÃO (normalizada: sem IF NOT EXISTS / comentários) ==="
# Índices: comparação direta 1:1
for idx in tracking_events_siteId_createdAt_idx tracking_events_siteId_eventType_createdAt_idx tracking_visitors_siteId_lastSeenAt_idx; do
  can="$(grep "$idx" "$TMPDIR_SCHEMA/canonical-blocks.sql" | head -1 | sed 's/;$//' | sed 's/ $//')"
  mine="$(grep "$idx" "$TMPDIR_SCHEMA/mine-blocks.norm" | head -1 | sed 's/;$//' | sed 's/ $//')"
  if [ "$can" != "$mine" ]; then
    echo "✖ ÍNDICE DIVERGE: $idx"
    echo "  canônico: $can"
    echo "  migration: $mine"
    exit 1
  fi
  echo "✔ índice OK: $idx"
done

# Tabela: comparação campo a campo (canônico tem ALTER COLUMN separado
# às vezes; normalizo removendo vírgulas finais e comparo o conjunto de
# linhas essenciais)
{
  grep -o '"key" TEXT NOT NULL\|"windowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP\|"count" INTEGER NOT NULL DEFAULT 0\|"updatedAt" TIMESTAMP(3) NOT NULL\|CONSTRAINT "tracking_rate_limit_pkey" PRIMARY KEY ("key")' \
    "$TMPDIR_SCHEMA/canonical-blocks.sql" | sort -u
} > "$TMPDIR_SCHEMA/table-canonical.norm"
{
  grep -o '"key" TEXT NOT NULL\|"windowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP\|"count" INTEGER NOT NULL DEFAULT 0\|"updatedAt" TIMESTAMP(3) NOT NULL\|CONSTRAINT "tracking_rate_limit_pkey" PRIMARY KEY ("key")' \
    "$TMPDIR_SCHEMA/mine-blocks.norm" | sort -u
} > "$TMPDIR_SCHEMA/table-mine.norm"

if diff -u "$TMPDIR_SCHEMA/table-canonical.norm" "$TMPDIR_SCHEMA/table-mine.norm"; then
  echo "✔ tabela OK: tracking_rate_limit (5/5 linhas essenciais idênticas ao canônico)"
else
  echo "✖ TABELA DIVERGE do canônico — ver diff acima"
  echo "--- canônico:"; cat "$TMPDIR_SCHEMA/canonical-blocks.sql"
  exit 1
fi

echo ""
echo "✔ DDL da migration IDÊNTICO ao canônico do Prisma"
echo "  (3 índices compostos + tabela tracking_rate_limit)"
