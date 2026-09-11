#!/usr/bin/env bash
# Valida o DDL da migration 20260911_meta_ingest_durability contra o
# diff canônico gerado pelo Prisma (provider postgresql, from-empty).
# Não conecta em banco nenhum (regra 2 do prompt).
set -euo pipefail
cd /home/z/my-project

TMPDIR_SCHEMA=/tmp/schema-pg-check-meta-ingest
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

# 3. Extrai blocos canônicos das 3 tabelas + índices
TABLES=(meta_lead_inbox meta_polling_cursor meta_polling_lease)
{
  for t in "${TABLES[@]}"; do
    awk "/CREATE TABLE \"${t}\"/,/^\\);/" "$TMPDIR_SCHEMA/canonical.sql"
  done
  for t in "${TABLES[@]}"; do
    grep "\"${t}\"" "$TMPDIR_SCHEMA/canonical.sql" | grep -i 'CREATE.*INDEX' || true
  done
} > "$TMPDIR_SCHEMA/canonical-blocks.sql"

# 4. Normaliza (IF NOT EXISTS fora, comentários fora, espaços) e compara
norm() {
  sed -e 's/ IF NOT EXISTS//g' \
      -e 's/--.*//' \
      -e 's/[[:space:]]\+/ /g' \
      -e 's/^ //' -e 's/ $//' \
      -e '/^$/d' "$1"
}

norm prisma/migrations/20260911_meta_ingest_durability/migration.sql | sort > "$TMPDIR_SCHEMA/mine.norm"
norm "$TMPDIR_SCHEMA/canonical-blocks.sql" | sort > "$TMPDIR_SCHEMA/canonical.norm"

echo "=== COMPARAÇÃO (normalizada: sem IF NOT EXISTS / comentários) ==="
if diff -u "$TMPDIR_SCHEMA/canonical.norm" "$TMPDIR_SCHEMA/mine.norm"; then
  echo "✅ DDL das 3 tabelas (inbox/cursor/lease) é IDÊNTICO ao canônico do Prisma"
else
  echo "✖ DIFERENÇAS acima — corrigir a migration"
  exit 1
fi
