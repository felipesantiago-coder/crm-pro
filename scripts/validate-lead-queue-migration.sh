#!/usr/bin/env bash
# Valida o DDL da migration 20260911_lead_queue_assignment_unique contra o
# diff canônico gerado pelo Prisma (provider postgresql, from-empty).
# Não conecta em banco nenhum (regra 2 do prompt).
set -euo pipefail
cd /home/z/my-project

TMPDIR_SCHEMA=/tmp/schema-pg-check-lead-queue
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

# 3. Extrai os índices canônicos da tabela lead_queue_assignments
#    (a migration da Fase 4 só adiciona o índice UNIQUE de leadId —
#     a tabela em si nasceu em migrations/baseline anteriores)
{
  grep "lead_queue_assignments" "$TMPDIR_SCHEMA/canonical.sql" | grep -i 'CREATE.*INDEX' || true
} > "$TMPDIR_SCHEMA/canonical-blocks.sql"

# A schema NÃO pode mais declarar o índice simples leadId (removido
# como redundante) — o canônico não pode contê-lo
if grep -q 'lead_queue_assignments_leadId_idx' "$TMPDIR_SCHEMA/canonical-blocks.sql"; then
  echo "✖ schema ainda declara @@index([leadId]) redundante — remover"; exit 1
fi

# 4. Normaliza (IF NOT EXISTS fora, comentários fora, espaços) e compara.
#    O DROP do índice simples redundante é ESPERADO (removido da schema
#    porque o UNIQUE leadId_key o cobre) — o diff canônico from-empty
#    nunca gera DROP, então ele entra como linha permitida explícita.
norm() {
  sed -e 's/ IF NOT EXISTS//g' \
      -e 's/--.*//' \
      -e 's/[[:space:]]\+/ /g' \
      -e 's/^ //' -e 's/ $//' \
      -e '/^$/d' "$1"
}

norm prisma/migrations/20260911_lead_queue_assignment_unique/migration.sql \
  | grep -v '^DROP INDEX IF EXISTS "lead_queue_assignments_leadId_idx";$' > "$TMPDIR_SCHEMA/mine.norm"
# Comparação escopada à mudança desta migration: o índice UNIQUE
# (os demais índices da tabela pertencem ao baseline anterior)
norm "$TMPDIR_SCHEMA/canonical-blocks.sql" | grep 'leadId_key' > "$TMPDIR_SCHEMA/canonical.norm"

# Confere que o DROP esperado está presente no arquivo original
grep -q 'DROP INDEX IF EXISTS "lead_queue_assignments_leadId_idx"' \
  prisma/migrations/20260911_lead_queue_assignment_unique/migration.sql \
  || { echo "✖ DROP do índice redundante ausente na migration"; exit 1; }

echo "=== COMPARAÇÃO (normalizada: sem IF NOT EXISTS / comentários) ==="
if diff -u "$TMPDIR_SCHEMA/canonical.norm" "$TMPDIR_SCHEMA/mine.norm"; then
  echo "✔ DDL da migration IDÊNTICO ao canônico do Prisma"
  echo "  (índice: lead_queue_assignments_leadId_key UNIQUE(leadId))"
else
  echo "✖ DDL DIVERGE do canônico — ver diff acima"
  echo "--- canônico extraído:"; cat "$TMPDIR_SCHEMA/canonical-blocks.sql"
  exit 1
fi
