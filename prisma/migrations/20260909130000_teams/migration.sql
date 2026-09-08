-- Equipes (teams) para organização de usuários pelo admin:
-- filtro de leads por equipe e composição de filas (equipe → membros).
-- Aditivo e não destrutivo (tabela nova + coluna nullable em users).
-- Administradores NÃO pertencem a equipes (users."teamId" = NULL).

CREATE TABLE IF NOT EXISTS "teams" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "teams_name_key" ON "teams"("name");

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "teamId" TEXT;

CREATE INDEX IF NOT EXISTS "users_teamId_idx" ON "users"("teamId");

-- onDelete: SetNull — excluir a equipe NÃO exclui usuários; eles apenas
-- ficam sem equipe (aparecem em "Sem equipe" na UI de equipes).
DO $$ BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "users_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "teams"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
