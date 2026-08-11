-- Adiciona constraint UNIQUE no campo email da tabela clients
-- Preveni duplicatas de clientes quando submissões simultâneas ocorrem

-- 1. Primeiro, limpa emails duplicados mantendo o cliente mais recente por email
DELETE FROM clients c1
WHERE EXISTS (
  SELECT 1 FROM clients c2
  WHERE c2.email = c1.email
    AND c2.email IS NOT NULL
    AND c2."createdAt" > c1."createdAt"
    AND c1.email IS NOT NULL
);

-- 2. Remove emails .temp (gerados pelo hero mini-form como workaround)
DELETE FROM clients WHERE email LIKE '%@cadastro.temp';

-- 3. Limpa NULLs duplicados (Postgres permite múltiplos NULLs com UNIQUE)
-- Mas garante que não há entradas problemáticas
UPDATE clients SET email = NULL WHERE email = '';

-- 4. Cria a constraint unique
CREATE UNIQUE INDEX "clients_email_key" ON clients ("email") WHERE "email" IS NOT NULL;
