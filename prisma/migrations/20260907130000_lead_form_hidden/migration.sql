-- ============================================================
-- LEAD FORM HIDDEN — formulários removidos da seção Temperatura
-- "Remover formulário" oculta o formulário da aba Temperatura sem
-- apagar leads nem mapeamentos aprendidos; importar novamente pela
-- conta de anúncios remove a marca e restaura o formulário.
-- ============================================================

-- CreateTable
CREATE TABLE IF NOT EXISTS "lead_form_hidden" (
    "formId" TEXT NOT NULL,
    "reason" TEXT,
    "hiddenBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_form_hidden_pkey" PRIMARY KEY ("formId")
);
