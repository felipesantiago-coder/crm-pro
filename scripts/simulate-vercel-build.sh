#!/usr/bin/env bash
# Simulação Vercel-fiel do build (Fase 3): client POSTGRESQL (como no
# deploy — GUARD B do push), typecheck ON (ignoreBuildErrors: false),
# build next sem migration e sem envs de Storage. No fim, restaura o
# client sqlite local (dev).
set -uo pipefail
cd /home/z/my-project

GEN=.tmp-schema-pg-build.prisma
sed 's/^  provider = "sqlite"/  provider = "postgresql"/' prisma/schema.prisma > "$GEN"
grep -q 'provider = "postgresql"' "$GEN" || { echo "✖ conversão falhou"; exit 1; }
trap 'rm -f "$GEN"; npx prisma generate >/dev/null 2>&1 || true' EXIT

echo "=== 1. Prisma Client POSTGRESQL (produção) ==="
npx prisma generate --schema "$GEN" 2>&1 | tail -1

echo "=== 2. next build (typecheck ON, sem Storage envs) ==="
# envs mínimas de build (placeholders SEM valor real, como na Vercel antes do release)
NEXTAUTH_SECRET=build-placeholder NEXTAUTH_URL=http://localhost:3000 \
  npx next build 2>&1 | tail -18
STATUS=${PIPESTATUS[0]}

if [ "$STATUS" -eq 0 ]; then
  echo "✅ BUILD VERDE com client postgres + typecheck ON (simulação Vercel-fiel)"
else
  echo "✖ build falhou (status $STATUS)"
fi
exit $STATUS
