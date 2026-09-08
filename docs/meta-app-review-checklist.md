# App Review — Checklist para liberar o app do CRM para qualquer usuário

> Objetivo: que **qualquer** usuário do CRM conecte as próprias contas de anúncio/páginas
> com o botão **"Conectar com o Facebook"** (Facebook Login for Business) — sem criar app,
> sem conta no Meta for Developers e sem System User.
>
> Enquanto o app **não** tiver Advanced Access aprovado, só pessoas com papel no app
> (Admin/Developer/Tester) conseguem autorizar — para todos os outros, a Meta **omite
> silenciosamente** as permissões avançadas do diálogo e o CRM devolve o erro
> `missing_permissions` listando exatamente o que faltou.

---

## 0. Pré-requisitos (uma vez só)

- [ ] App criado em https://developers.facebook.com/apps (tipo **Business**) — o mesmo já conectado ao CRM.
- [ ] **Business Verification** concluída para a empresa dona do app:
      https://business.facebook.com/settings → Security Center → Start Verification.
      (Documentos da empresa; leva de horas a poucos dias.)
- [ ] Política de Privacidade pública com URL válida (descreve coleta/uso de leads).
- [ ] URL da **exclusão de dados** (Data Deletion callback/_instructions) cadastrada.
- [ ] Ícone 1024×1024 + categoria do app preenchidos.
- [ ] App em **Live** (Development → Live). Em Development, NINGUÉM fora dos papéis consegue logar.
- [ ] Env vars na Vercel: `META_APP_ID` e `META_APP_SECRET` (o callback exige App Secret para
      trocar o código por token; sem env, o CRM usa o App Secret verificado em uma conta já
      cadastrada).

## 1. Facebook Login for Business (produto)

- [ ] Adicionar o produto **Facebook Login for Business** ao app.
- [ ] **Valid OAuth Redirect URIs**: adicionar EXATAMENTE
      `https://www.crm-pro.site/api/meta-ad-accounts/oauth/callback`
      (produção) e, se usar, o domínio de preview. redirect_uri divergente → a Meta rejeita
      a troca do código (`redirect_mismatch`).
- [ ] Opcional: criar um **Configuration (config_id)** com as permissões abaixo e os ativos
      permitidos (contas de anúncio/páginas) — melhora o seletor de ativos do diálogo.

## 2. Permissões solicitadas (o CRM pede TODAS de uma vez)

O código pede, nesta ordem: `leads_retrieval, ads_management, ads_read, pages_show_list,
pages_read_engagement, pages_manage_metadata, business_management`.

Para o fluxo funcionar, o **mínimo** aprovado precisa ser:
`leads_retrieval`, `ads_management`, `pages_show_list`, `pages_manage_metadata`.

| Permissão | Para que o CRM usa | Notas de review |
|---|---|---|
| `leads_retrieval` | Ler os dados dos leads (`/{form}/leads`, field_data) | Permissão sensível: o reviewer testa com leads reais; proibido usar dados fora do consentimento |
| `ads_management` | Listar contas/`leadgen_forms`/campanhas do usuário | Justificar como CRM (leitura) |
| `ads_read` | Fallback de leitura | |
| `pages_show_list` | Listar páginas do usuário | |
| `pages_read_engagement` | Ler páginas para mapear formulários | |
| `pages_manage_metadata` | **Inscrever a página no webhook `leadgen` do app** | Core do tempo real |
| `business_management` | Ativos geridos em BM | Opcional, mas recomendada |

## 3. Pedir o Advanced Access (App Review)

- [ ] App Dashboard → App Review → Permissions and Features → para CADA permissão acima:
      **Request Advanced Access** → detalhe de uso → submit.
- [ ] Gravar o **vídeo de demonstração** (exigência central). Roteiro sugerido:
      1. Tela do CRM (Meta Ads → Contas) mostrando que não há token colado;
      2. Clicar em "Conectar com o Facebook" → diálogo da Meta listando as permissões;
      3. Autorizar com uma conta REAL que tenha conta de anúncio + página com formulário;
      4. CRM mostra as contas conectadas; abrir "Sync Forms" listando formulários;
      5. Submeter um lead de teste (Lead Ads Testing Tool) e o lead aparecendo no CRM.
- [ ] Preencher as respostas de verificação por permissão: onde os dados são exibidos,
      por que a permissão é necessária, como o usuário revoga.
- [ ] Fornecer **credenciais de teste** para o reviewer (uma conta com página/formulário/conta de anúncio).
- [ ] Submeter e acompanhar (App Review → Activities). Prazo típico: 1–7 dias.

## 4. Pós-aprovação

- [ ] Confirmar que o botão funciona com uma conta SEM papel no app (teste incógnito).
- [ ] Se aparecer `missing_permissions` em produção: a permissão aprovada foi revogada ou
      o usuário desmarcou no consentimento — reconectar com `auth_type=rerequest`
      (o botão "Reconectar com o Facebook" do card já faz isso).
- [ ] Monitorar tokens: tokens de usuário expiram (~60 dias). O CRM guarda `tokenExpiresAt`,
      avisa ≤7 dias (banner âmbar) e marca `expired`/`permission_denied` automaticamente
      quando a Graph devolve 190/200 (banner vermelho + botão Reconectar).

## 5. Erros de produção → diagnóstico rápido

| Erro no CRM | Causa | Correção |
|---|---|---|
| `missing_permissions` | Advanced Access não aprovado (Meta omite do diálogo) ou desmarcado | Concluir App Review; reconectar |
| `redirect_mismatch` | Callback não registrado (ou domínio diferente) | §1 Valid OAuth Redirect URIs |
| `app_credentials` | META_APP_ID/META_APP_SECRET errados | Corrigir envs |
| `app_mismatch` | Token emitido para outro app | Alinhar env com o app revisado |
| `no_ad_accounts` | Usuário sem papel nas contas ou não as marcou | Papel Anunciante+ e marcar ativos no diálogo |
| Banner vermelho "Token EXPIRADO" | 190 em runtime | Botão Reconectar com o Facebook |

## 6. Notas LGPD/compliance

- Leads são dados dos usuários das páginas; o CRM atua como processador. Documentar na
  política de privacidade finalidade, retenção e como o dono da página pode revogar o acesso
  (Facebook → Settings → Business Integrations → Remove).
- Não usar dados de leads para fora da finalidade do consentimento (regra de uso da Meta).
