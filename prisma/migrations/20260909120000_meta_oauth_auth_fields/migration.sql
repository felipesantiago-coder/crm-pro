-- Estado de AUTENTICAÇÃO do token por conta (OAuth + reconexão)
-- Aditivo e não destrutivo (colunas nullable + default).
--
-- tokenExpiresAt: expiração do token de usuário OAuth (~60 dias);
--   null = token manual/System User (não expira ou desconhecido).
-- authSource: 'oauth' | 'manual' (null = legado pré-OAuth).
-- authStatus: 'ok' | 'expiring' | 'expired' | 'permission_denied' —
--   marcado automaticamente quando o uso do token falha na Graph API
--   (190 → expired; 200/10 → permission_denied).
-- lastAuthError/lastAuthErrorAt: último erro de autenticação (UI).

ALTER TABLE "meta_ad_accounts" ADD COLUMN IF NOT EXISTS "authSource" TEXT;
ALTER TABLE "meta_ad_accounts" ADD COLUMN IF NOT EXISTS "tokenExpiresAt" TIMESTAMPTZ(3);
ALTER TABLE "meta_ad_accounts" ADD COLUMN IF NOT EXISTS "authStatus" TEXT NOT NULL DEFAULT 'ok';
ALTER TABLE "meta_ad_accounts" ADD COLUMN IF NOT EXISTS "lastAuthError" TEXT;
ALTER TABLE "meta_ad_accounts" ADD COLUMN IF NOT EXISTS "lastAuthErrorAt" TIMESTAMPTZ(3);

-- App ID comprovado pela Graph API na validação do App Secret (fonte
-- alternativa das credenciais do OAuth sem envs dedicadas).
ALTER TABLE "meta_ad_accounts" ADD COLUMN IF NOT EXISTS "appId" TEXT;
