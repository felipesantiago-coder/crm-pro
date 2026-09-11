#!/usr/bin/env bash
# Prova: os 7 erros restantes de `mode: 'insensitive'` são artefatos do
# provider sqlite local. Com o client gerado para POSTGRESQL (provider de
# produção — GUARD B do push-to-main.sh), o tsc fica 100% limpo.
# NO FINAL, regenera o client sqlite local (dev não fica quebrado).
set -euo pipefail
cd /home/z/my-project

GEN=.tmp-schema-pg.prisma

sed 's/^  provider = "sqlite"/  provider = "postgresql"/' prisma/schema.prisma > "$GEN"
grep -q 'provider = "postgresql"' "$GEN"
trap 'rm -f .tmp-schema-pg.prisma' EXIT

echo "=== 1. Gerando Prisma Client para POSTGRESQL (como na Vercel) ==="
npx prisma generate --schema "$GEN" 2>&1 | tail -2

echo "=== 2. tsc com client postgres ==="
set +e
npx tsc --noEmit --pretty false 2>&1 | grep -E "error TS" > /tmp/tsc-pg.txt
STATUS=$?
set -e
if [ -s /tmp/tsc-pg.txt ]; then
  echo "❌ Ainda há erros com provider postgres:"
  cat /tmp/tsc-pg.txt | cut -c1-160
  echo "(continuando para restaurar o client sqlite antes de sair)"
  RESTORE_FAILED=1
else
  echo "✅ tsc 100% LIMPO com client postgresql — os 7 erros são artefatos do provider sqlite local"
  RESTORE_FAILED=0
fi

echo "=== 3. Restaurando Prisma Client sqlite (dev local) ==="
npx prisma generate 2>&1 | tail -2
grep -c '"sqlite"' prisma/schema.prisma || true

exit $RESTORE_FAILED
