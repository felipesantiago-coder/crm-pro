#!/usr/bin/env bash
# Valida o DDL da migration 20260911_enterprise_public_snapshot contra o
# diff canônico gerado pelo Prisma (provider postgresql, from-empty).
# Não conecta em banco nenhum (regra 2 do prompt).
set -euo pipefail
cd /home/z/my-project

TMPDIR_SCHEMA=/tmp/schema-pg-check-public-snapshot
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
#    - CREATE TABLE enterprise_public_snapshots
#    - UNIQUE (slug, locale) + índice enterpriseId
{
  grep -A11 'CREATE TABLE "enterprise_public_snapshots"' "$TMPDIR_SCHEMA/canonical.sql" || true
  grep 'enterprise_public_snapshots_slug_locale_key\|enterprise_public_snapshots_enterpriseId_idx' "$TMPDIR_SCHEMA/canonical.sql" | grep -i 'CREATE.*INDEX' || true
} > "$TMPDIR_SCHEMA/canonical-blocks.sql"

# 4. Normaliza (IF NOT EXISTS fora, comentários fora, espaços) e compara.
norm() {
  sed -e 's/ IF NOT EXISTS//g' \
      -e 's/--.*//' \
      -e 's/[[:space:]]\+/ /g' \
      -e 's/^ //' -e 's/ $//' \
      -e '/^$/d' "$1"
}

norm prisma/migrations/20260911_enterprise_public_snapshot/migration.sql \
  > "$TMPDIR_SCHEMA/mine.norm"
{
  grep -v '^--' "$TMPDIR_SCHEMA/mine.norm" | grep -A10 'CREATE TABLE "enterprise_public_snapshots"' || true
  grep 'enterprise_public_snapshots_slug_locale_key\|enterprise_public_snapshots_enterpriseId_idx' "$TMPDIR_SCHEMA/mine.norm" || true
} > "$TMPDIR_SCHEMA/mine-blocks.norm"

norm "$TMPDIR_SCHEMA/canonical-blocks.sql" > "$TMPDIR_SCHEMA/canonical-blocks.norm"

# 5. Confirma que os 3 objetos estão presentes na migration
for obj in \
  'CREATE TABLE "enterprise_public_snapshots"' \
  'CREATE UNIQUE INDEX "enterprise_public_snapshots_slug_locale_key"' \
  'CREATE INDEX "enterprise_public_snapshots_enterpriseId_idx"'; do
  grep -qF "$obj" "$TMPDIR_SCHEMA/mine.norm" \
    || { echo "✖ Objeto ausente na migration: $obj"; exit 1; }
done

# 6. Compara blocos normalizados (tabela + índices) — precisa ser 1:1
if diff -u "$TMPDIR_SCHEMA/canonical-blocks.norm" "$TMPDIR_SCHEMA/mine-blocks.norm" > "$TMPDIR_SCHEMA/block-diff.txt"; then
  echo "✔ DDL da migration == canônico Prisma (tabela + 2 índices, escopado)"
else
  echo "✖ Divergência entre migration e canônico:"
  cat "$TMPDIR_SCHEMA/block-diff.txt"
  exit 1
fi

# 7. Asserções de schema: model declarado com mapa/unique/índice corretos
grep -q 'model EnterprisePublicSnapshot' prisma/schema.prisma \
  || { echo "✖ model EnterprisePublicSnapshot ausente no schema"; exit 1; }
grep -q '@@map("enterprise_public_snapshots")' prisma/schema.prisma \
  || { echo "✖ @@map ausente"; exit 1; }
grep -q '@@unique(\[slug, locale\])' prisma/schema.prisma \
  || { echo "✖ @@unique([slug, locale]) ausente"; exit 1; }
grep -q 'publicSnapshots EnterprisePublicSnapshot\[\]' prisma/schema.prisma \
  || { echo "✖ relação Enterprise.publicSnapshots ausente"; exit 1; }

echo "✔ Migration 20260911_enterprise_public_snapshot validada contra o canônico"
