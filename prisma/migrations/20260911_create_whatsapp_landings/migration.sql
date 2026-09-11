-- Landing Page "Clique para Entrar" — página pública dinâmica de
-- redirecionamento para WhatsApp (leads não qualificados vindos de anúncios),
-- vinculada a uma região e a um número de destino informados pelo admin.
-- Gestão: Anúncios Meta → Landing Pages | Pública: /lp/{slug}
-- Criação dinâmica pelo administrador; mensagem com placeholder {regiao}.
-- Idempotente (IF NOT EXISTS): seguro em rebuilds e bancos já sincronizados
-- por db push (baseline) que ainda não conhecem a tabela.
-- Rollback: DROP TABLE "whatsapp_landings";

CREATE TABLE IF NOT EXISTS "whatsapp_landings" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "message" TEXT NOT NULL DEFAULT 'Olá, gostaria de conhecer outras opções na região',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "views" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_landings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_landings_slug_key" ON "whatsapp_landings"("slug");
