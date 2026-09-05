-- Configurações de canal por conta de anúncios (multi-conta):
-- cada conta AGRUPA as próprias configurações de webhook (verify
-- token/app secret/pages + toggle) e de polling (formIds + toggle),
-- sem se misturar com as demais contas.
-- Aditivo e não destrutivo: defaults true preservam o comportamento
-- atual de todas as contas existentes.

-- AlterTable
ALTER TABLE "meta_ad_accounts" ADD COLUMN "webhookEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "meta_ad_accounts" ADD COLUMN "pollingEnabled" BOOLEAN NOT NULL DEFAULT true;
