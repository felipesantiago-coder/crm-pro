# Tutorial Completo de Configuração — Publicação Automática no Instagram

## Visão Geral

Este tutorial cobre toda a configuração manual necessária para que a funcionalidade de publicação automática no Instagram funcione 100%. O sistema publica imagens com legendas no Instagram Business via Meta Graph API v22.0, com agendamento por cron-job.org.

---

## Índice

1. [Criar o App no Meta Developer](#1-criar-o-app-no-meta-developer)
2. [Configurar o Instagram Basic Display / OAuth](#2-configurar-o-oauth)
3. [Adicionar o Produto Instagram Basic Display](#3-adicionar-o-produto-instagram-basic-display)
4. [Configurar Permissões do App](#4-configurar-permissões-do-app)
5. [Solicitar o App Review](#5-solicitar-o-app-review)
6. [Preparar o Bucket do Supabase Storage](#6-preparar-o-bucket-do-supabase-storage)
7. [Configurar Variáveis de Ambiente na Vercel](#7-configurar-variáveis-de-ambiente-na-vercel)
8. [Rodar a Migration do Banco de Dados](#8-rodar-a-migration-do-banco-de-dados)
9. [Configurar o Cron no cron-job.org](#9-configurar-o-cron-no-cron-joborg)
10. [Teste Final — Checklist Completo](#10-teste-final--checklist-completo)

---

## 1. Criar o App no Meta Developer

### 1.1 Acessar o Portal

1. Acesse [https://developers.facebook.com/](https://developers.facebook.com/)
2. Faça login com a mesma conta Facebook que é administradora da Página do Facebook conectada ao Instagram Business
3. Clique em **"My Apps"** no menu superior

### 1.2 Criar o App

1. Clique em **"Create App"**
2. Selecione o tipo: **"Business"**
3. Preencha:
   - **App Name**: `CRM Pro Instagram Publisher` (ou o nome que preferir — será visível durante o App Review)
   - **App Contact Email**: seu e-mail profissional
   - **Business Account**: selecione sua conta de negócio (se tiver), ou "Não tenho uma conta de negócio"
4. Clique em **"Create App"**
5. Preencha o captcha se solicitado

### 1.3 Anotar Credenciais

1. Na página inicial do app, vá em **Settings > Basic**
2. Anote:
   - **App ID** → será seu `INSTAGRAM_APP_ID`
   - **App Secret** → clique em "Show" e anote → será seu `INSTAGRAM_APP_SECRET`

---

## 2. Configurar o OAuth

### 2.1 Adicionar o produto "Instagram Basic Display"

> **Nota:** A partir de 2024, a Meta moveu as permissões do Instagram para dentro do produto Facebook Login. O fluxo correto usa o Facebook Login para obter permissões do Instagram.

1. No painel do app, vá em **"Add a Product"** (ou "Products" no menu esquerdo)
2. Encontre **"Facebook Login"** e clique em **"Set Up"**
3. Na configuração do Facebook Login:
   - Em **"Client OAuth Settings"**:
     - **Valid OAuth Redirect URIs**: adicione:
       ```
       https://seu-domínio.vercel.app/api/instagram/callback
       ```
       Substitua `seu-domínio` pelo seu domínio real na Vercel.
     - **Deauthorize Callback URL**: pode deixar em branco
     - **Force Web OAuth Reauthentication**: **No**
     - **Login Button Plugin**: pode ignorar
   - Clique em **"Save Changes"**

### 2.2 Configurar o Instagram

1. No menu esquerdo, vá em **"Instagram"** > **"Basic Display"** (ou "Instagram API")
2. Se aparecer um aviso sobre migração, siga as instruções para usar o Graph API
3. Anote o **Instagram App ID** e o **Instagram App Secret** (devem ser iguais ao App ID e App Secret do app)

---

## 3. Adicionar o Produto Instagram Basic Display

Na verdade, o que você precisa é do **Facebook Login** com as permissões do Instagram. Siga:

1. Vá em **"Products"** > **"Facebook Login"** > **"Settings"**
2. Configure:
   - **Client OAuth Login Flow**: Web
   - **Valid OAuth Redirect URIs**: `https://SEU_DOMINIO.vercel.app/api/instagram/callback`
   - **Cancel URL**: pode deixar em branco ou usar a URL do seu app
   - **Allowed Domains**: `SEU_DOMINIO.vercel.app`

---

## 4. Configurar Permissões do App

### 4.1 Permissões Necessárias

O sistema usa as seguintes permissões (scopes):

| Permissão | Para que serve |
|---|---|
| `instagram_basic` | Acessar dados básicos da conta do Instagram |
| `instagram_content_publish` | Publicar conteúdo no Instagram Business |
| `pages_show_list` | Listar as Páginas do Facebook do usuário |
| `pages_read_engagement` | Ler dados de engajamento da Página |
| `pages_manage_posts` | Gerenciar publicações da Página (necessário para o token da página) |

### 4.2 Como Adicionar as Permissões

1. Vá em **"App Review"** > **"Permissions and Features"**
2. Para cada permissão listada acima:
   - Clique no botão ao lado ("Request" ou "Configure")
   - Se já estiver disponível como "Live", não precisa fazer nada
   - Se estiver como "Not Available for Review" ou "Advanced Access", solicite o acesso avançado

### 4.3 Acesso Avançado (Advanced Access)

A partir de 2024, permissões como `instagram_content_publish` requerem **Advanced Access**:

1. Clique em **"Request Advanced Access"** ao lado da permissão
2. Preencha o formulário com:
   - **Reason for requesting**: explique que seu app permite que o administrador do CRM agende e publique posts automaticamente no Instagram Business da empresa
   - **Use case details**: descreva que o app é para uso interno (admin-only) e que as publicações são feitas pelo próprio administrador
3. Submeta e aguarde a aprovação (geralmente leva de 1 a 5 dias úteis)

> **Dica para aprovação:** Mencione que é um app de uso interno, que não compartilha dados com terceiros, e que o usuário final é o próprio administrador da conta. Isso aumenta muito a chance de aprovação.

---

## 5. Solicitar o App Review

### 5.1 Antes de Solicitar — Pré-requisitos

Certifique-se de que:
- [ ] O app está no modo **"Development"** (não mude para "Live" ainda)
- [ ] As permissões estão solicitadas em **"Permissions and Features"**
- [ ] A **Valid OAuth Redirect URI** está configurada corretamente
- [ ] Seu app tem uma **Privacy Policy URL** acessível
- [ ] Seu app tem um **Data Deletion Request URL** (ou callback configurado)

### 5.2 Configurar Privacy Policy e Data Deletion

1. **Privacy Policy URL**:
   - Crie uma página de política de privacidade no seu domínio (ex: `https://seu-dominio.vercel.app/privacy`)
   - A página deve explicar quais dados são coletados e como são usados
   - Vá em **Settings > Basic > Privacy Policy URL** e cole a URL

2. **Data Deletion Request URL**:
   - Vá em **Settings > Advanced > Data Deletion Request URL**
   - Cole a URL do seu callback de exclusão de dados (ex: `https://seu-dominio.vercel.app/api/instagram/callback`)
   - Na prática, para apps de uso interno, isso serve como placeholder

### 5.3 Criar o Vídeo de Demonstração (OBRIGATÓRIO)

O Meta App Review **exige um vídeo** demonstrando o uso de cada permissão solicitada. Siga:

**Permissões que precisam de vídeo:**
- `instagram_content_publish`
- `instagram_basic`
- `pages_show_list`
- `pages_read_engagement`

**Como gravar o vídeo:**

1. Use uma ferramenta de gravação de tela (OBS Studio, Loom, ou o gravador nativo do Windows/Mac)
2. **Estrutura do vídeo (3-5 minutos):**
   - **0:00-0:30** — Mostre a tela de login do seu app (página da Vercel) e o botão "Conectar Instagram"
   - **0:30-1:00** — Mostre o fluxo de autorização OAuth (tela de consentimento do Facebook/Instagram aparecendo)
   - **1:00-2:00** — Mostre a tela de criação de post no app: upload de imagem, digitação de legenda, seleção de data/hora
   - **2:00-2:30** — Mostre a lista de publicações agendadas com os status
   - **2:30-3:00** — Mostre o post sendo publicado (ou a tela de confirmação de publicação)
   - **3:00-3:30** — Mostre a opção de desconectar a conta do Instagram

3. **Dicas para o vídeo:**
   - **NÃO** grave a tela do Meta Developer — grave APENAS o seu app
   - Mostre o fluxo completo do ponto de vista do usuário
   - Fale em inglês ou legende em inglês (revisores falam inglês)
   - A qualidade não precisa ser perfeita, mas precisa ser legível
   - Mostre claramente onde cada permissão é usada na interface

4. Hospede o vídeo em um destes serviços:
   - **YouTube** (como "Não listado" ou "Público")
   - **Loom**
   - **Vimeo**
   - **Google Drive** (com link público)

### 5.4 Submeter o App Review

1. Vá em **"App Review"** > **"Permissions and Features"**
2. Para cada permissão que precisa de revisão:
   - Clique em **"Request Review"** (ou "Start Review")
   - Faça upload do vídeo de demonstração
   - Adicione uma breve explicação (em inglês):
     ```
     This permission is used by our internal CRM admin to publish 
     scheduled content to their own Instagram Business account. 
     The feature is admin-only and not accessible to end users.
     ```
   - Clique em **"Submit for Review"**
3. Repita para todas as permissões necessárias
4. Aguarde o resultado (normalmente 1-5 dias úteis)

### 5.5 Se Foi Rejeitado

Se o App Review for rejeitado:
1. Leia atentamente o motivo da rejeição
2. Corrija o problema apontado
3. Grave um novo vídeo se necessário
4. Re-submeta

Motivos comuns de rejeição:
- O vídeo não mostra claramente o uso da permissão
- A Privacy Policy está inacessível ou incompleta
- O caso de uso não está claro
- O app parece ser para uso público, mas não tem termos de uso adequados

---

## 6. Preparar o Bucket do Supabase Storage

O sistema usa o Supabase Storage para hospedar as imagens antes de enviá-las ao Instagram.

### 6.1 Criar o Bucket

1. Acesse o [Dashboard do Supabase](https://supabase.com/dashboard)
2. Selecione seu projeto
3. No menu esquerdo, vá em **"Storage"**
4. Clique em **"New Bucket"**
5. Configure:
   - **Name**: `instagram-posts` (exatamente este nome)
   - **Public**: **Desmarcado** (o bucket deve ser privado)
   - Clique em **"Create Bucket"**

### 6.2 Configurar Políticas de Acesso (RLS)

O bucket precisa de políticas que permitam upload e leitura. No SQL Editor do Supabase, execute:

```sql
-- Permitir upload de imagens para usuários autenticados (admin)
CREATE POLICY "Admin can upload instagram images"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'instagram-posts'
  AND auth.role() = 'authenticated'
);

-- Permitir leitura das imagens (necessário para gerar URL assinada)
CREATE POLICY "Admin can read instagram images"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'instagram-posts'
  AND auth.role() = 'authenticated'
);

-- Permitir exclusão (para quando um post rascunho é removido)
CREATE POLICY "Admin can delete instagram images"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'instagram-posts'
  AND auth.role() = 'authenticated'
);
```

> **Nota:** Se você usa um sistema de admin personalizado (não o auth padrão do Supabase), ajuste as políticas conforme necessário. O importante é que o bucket permita upload, leitura e exclusão.

---

## 7. Configurar Variáveis de Ambiente na Vercel

### 7.1 Variáveis Necessárias

Adicione as seguintes variáveis de ambiente no seu projeto na Vercel (**Settings > Environment Variables**):

| Variável | Valor | Descrição |
|---|---|---|
| `INSTAGRAM_APP_ID` | `123456789012345` | O App ID do Meta Developer App |
| `INSTAGRAM_APP_SECRET` | `seu-app-secret-aqui...` | O App Secret do Meta Developer App |
| `CRON_SECRET` | `uma-string-super-secreta-aleatoria` | Chave para autenticar requisições do cron-job.org |

### 7.2 Como Configurar

1. Acesse o [Dashboard da Vercel](https://vercel.com/dashboard)
2. Selecione seu projeto
3. Vá em **"Settings"** > **"Environment Variables"**
4. Para cada variável:
   - **Name**: o nome da variável (exatamente como na tabela acima)
   - **Value**: o valor correspondente
   - **Environment**: selecione **Production**, **Preview** e **Development** (todas as três)
5. Clique em **"Save"**
6. **Re-deploy** o projeto para que as variáveis façam efeito:
   - Vá em **"Deployments"** > clique nos três pontos do deploy mais recente > **"Redeploy"**

### 7.3 Gerar o CRON_SECRET

Gere uma string aleatória segura para o `CRON_SECRET`:

```bash
# No terminal:
openssl rand -hex 32
```

Copie o resultado e use como valor da variável.

---

## 8. Rodar a Migration do Banco de Dados

O sistema adicionou dois novos modelos ao Prisma: `InstagramToken` e `InstagramPost`.

### 8.1 Gerar a Migration

```bash
# No terminal, na raiz do projeto:
npx prisma migrate dev --name add-instagram-publishing
```

Isso criará as tabelas `InstagramToken` e `InstagramPost` no banco de dados.

### 8.2 Se Estiver em Produção

```bash
npx prisma migrate deploy
```

### 8.3 Verificar as Tabelas

No SQL Editor do Supabase, confirme que as tabelas foram criadas:

```sql
-- Verificar tabelas
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('InstagramToken', 'InstagramPost');

-- Verificar estrutura da InstagramToken
\d "InstagramToken";

-- Verificar estrutura da InstagramPost
\d "InstagramPost";
```

---

## 9. Configurar o Cron no cron-job.org

O cron-job.org é um serviço gratuito que fará chamadas periódicas ao endpoint de publicação.

### 9.1 Criar Conta

1. Acesse [https://cron-job.org/en/](https://cron-job.org/en/)
2. Clique em **"Sign Up"**
3. Crie uma conta gratuita
4. Confirme o e-mail de verificação

### 9.2 Criar o Cron Job

1. Faça login no cron-job.org
2. Clique em **"Create Cronjob"**
3. Configure:
   - **Title**: `CRM Pro - Instagram Publisher`
   - **URL**: 
     ```
     https://SEU_DOMINIO.vercel.app/api/cron/instagram-publish
     ```
     Substitua `SEU_DOMINIO` pelo seu domínio real na Vercel.
   - **Schedule**: 
     - Selecione **"Every 5 minutes"** (recomendado)
     - Ou **"Every 15 minutes"** se preferir menos frequência
   - **Request method**: **POST**
   - **Headers**: Adicione:
     ```
     Authorization: Bearer SUA_CRON_SECRET_AQUI
     Content-Type: application/json
     ```
     Substitua `SUA_CRON_SECRET_AQUI` pelo valor que você configurou na variável `CRON_SECRET` na Vercel.
   - **Body**: Deixe vazio
   - **Timeout**: `30` segundos
4. Clique em **"Create Cronjob"**

### 9.3 Testar o Cron Job

1. Na lista de cron jobs, clique no que você acabou de criar
2. Clique em **"Execute now"** para testar manualmente
3. Verifique o **"History"** para ver se a requisição retornou status 200

> **Importante:** O endpoint verifica o header `Authorization: Bearer <CRON_SECRET>`. Se a requisição retornar 401, verifique se o header está correto.

---

## 10. Teste Final — Checklist Completo

### 10.1 Checklist de Configuração

- [ ] **Meta Developer App criado** com App ID e App Secret anotados
- [ ] **Facebook Login configurado** com Valid OAuth Redirect URI
- [ ] **Permissões solicitadas**: instagram_basic, instagram_content_publish, pages_show_list, pages_read_engagement, pages_manage_posts
- [ ] **App Review submetido** com vídeo de demonstração
- [ ] **Privacy Policy URL** configurada no app
- [ ] **Bucket `instagram-posts`** criado no Supabase Storage (privado)
- [ ] **Políticas RLS** do bucket configuradas (insert, select, delete)
- [ ] **Variáveis de ambiente** configuradas na Vercel (INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET, CRON_SECRET)
- [ ] **Projeto re-deployado** na Vercel após configurar variáveis
- [ ] **Migration rodada** (tabelas InstagramToken e InstagramPost criadas)
- [ ] **Cron job criado** no cron-job.org apontando para o endpoint com Bearer token

### 10.2 Fluxo de Teste

1. **Conectar conta:**
   - Acesse o CRM como administrador
   - Vá em **"Instagram"** no menu lateral
   - Clique em **"Conectar Conta"**
   - Autorize o acesso na tela do Facebook/Instagram
   - Verifique se a conta aparece como conectada

2. **Criar post:**
   - Vá para a aba **"Novo Post"**
   - Faça upload de uma imagem
   - Escreva uma legenda
   - Agende para daqui a 5 minutos
   - Salve o post

3. **Verificar publicação:**
   - Aguarde o cron job executar (a cada 5 minutos)
   - Verifique se o status muda de `SCHEDULED` para `PUBLISHING` para `PUBLISHED`
   - Confira o link do post publicado no Instagram

4. **Testar publicação imediata:**
   - Crie um novo post sem agendamento
   - Clique em **"Publicar Agora"**
   - Verifique se o post aparece no Instagram

### 10.3 Solução de Problemas

| Problema | Solução |
|---|---|
| Erro 401 no callback | Verifique se INSTAGRAM_APP_ID e INSTAGRAM_APP_SECRET estão corretos na Vercel |
| Erro de CSRF no callback | Limpe os cookies do navegador e tente novamente |
| Token expirado | O cron job deve renovar tokens com < 7 dias de expiração. Verifique se o cron está rodando. |
| Erro 403 ao publicar | O App Review provavelmente não foi aprovado ainda. Verifique o status das permissões. |
| Imagem não sobe | Verifique se o bucket `instagram-posts` existe e as políticas RLS estão corretas |
| Cron job retorna 401 | Verifique o header `Authorization: Bearer <CRON_SECRET>` no cron-job.org |
| Post stuck em PUBLISHING | O processamento tem timeout de 30s. Verifique os logs na Vercel. |
| Post stuck em FAILED | Verifique o campo `errorMessage` no banco para o motivo. Use "Tentar Novamente" na UI. |
| Página do Facebook não aparece | Certifique-se de que a conta do Facebook é administradora de pelo menos uma Página |
| Instagram Business não encontrado | A Página do Facebook precisa estar conectada a uma conta do Instagram Business nas configurações da Página |

---

## Resumo da Arquitetura

```
Admin (CRM UI)
    │
    ├── Upload de imagem → Supabase Storage (bucket: instagram-posts)
    ├── Criar post → Banco de dados (InstagramPost)
    │
    └── Conectar conta → OAuth Meta → InstagramToken salvo no banco


Cron (cron-job.org, a cada 5 min)
    │
    ├── POST /api/cron/instagram-publish (com Bearer CRON_SECRET)
    ├── Renova tokens expirando (< 7 dias)
    ├── Busca posts SCHEDULED com scheduledAt <= agora
    ├── Para cada post (máx 5):
    │   ├── Cria Media Container (Graph API)
    │   ├── Aguarda processamento (polling, até 30s)
    │   └── Publica o container
    └── Atualiza status no banco


Meta Graph API
    │
    ├── OAuth: code → short-lived token → long-lived token (~60 dias)
    ├── Media: create container → check status → publish
    └── Permissões: instagram_basic + instagram_content_publish
```

---

*Tutorial gerado automaticamente para o CRM Pro.*
