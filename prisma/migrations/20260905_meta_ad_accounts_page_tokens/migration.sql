-- Página access tokens POR CONTA (restauração do comportamento de
-- extração automática — antes vivia no userSetting global
-- meta_page_access_token, removido com o fim do modelo global).
--
-- O diagnóstico de cada conta extrai o page access token a partir do
-- token da conta (GET /{page-id}?fields=access_token; em tokens de
-- USUÁRIO, via /me/accounts) e salva o resultado aqui para:
--   - não expirar junto com o user token (~60 dias);
--   - o webhook preferir o token da PÁGINA ao buscar field_data;
--   - o diagnóstico validar a assinatura leadgen (subscribed_apps).

ALTER TABLE "meta_ad_accounts" ADD COLUMN IF NOT EXISTS "pageTokens" TEXT;
