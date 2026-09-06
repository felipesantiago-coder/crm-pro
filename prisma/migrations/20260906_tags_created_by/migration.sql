-- Tags por usuário (isolamento por autor)
-- Antes: qualquer usuário autenticado listava/gerenciava TODAS as tags
-- (GET sem filtro) e o modelo não tinha dono. Agora: createdById aponta
-- o autor; usuários comuns veem apenas as próprias tags, ADMIN vê todas.
-- null = tag LEGADA (criada antes do isolamento) — visível só para ADMIN.

ALTER TABLE "tags" ADD COLUMN IF NOT EXISTS "createdById" TEXT;

-- name único GLOBAL → único POR AUTOR. O Postgres trata NULLs como
-- distintos, então tags legadas (createdById null) com o mesmo nome
-- não conflitam entre si.
ALTER TABLE "tags" DROP CONSTRAINT IF EXISTS "tags_name_key";
DROP INDEX IF EXISTS "tags_name_key";
CREATE UNIQUE INDEX IF NOT EXISTS "tags_createdById_name_key" ON "tags"("createdById", "name");

-- FK do autor (idempotente): onDelete SetNull — usuário removido →
-- tags dele viram legadas (fica sob gestão do ADMIN).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tags_createdById_fkey') THEN
    ALTER TABLE "tags" ADD CONSTRAINT "tags_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
