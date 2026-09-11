| Rota | Métodos | Categoria | maxDuration | dynamic |
|---|---|---|---|---|
| `/api` | GET | autenticada | — | — |
| `/api/admin/notification-status` | GET | autenticada | — | — |
| `/api/ai-assistant` | POST | autenticada | — | — |
| `/api/analytics` | GET | autenticada | — | — |
| `/api/auth/[...nextauth]` | ? | pública (auth) | — | — |
| `/api/auth/change-password` | POST | pública (auth) | — | — |
| `/api/auth/forgot-password` | POST | pública (auth) | — | — |
| `/api/auth/reset-password` | POST | pública (auth) | — | — |
| `/api/auth/seed` | POST | pública (auth) | — | — |
| `/api/clients` | GET,POST | autenticada | — | — |
| `/api/clients/:id` | GET,PUT,PATCH,DELETE | autenticada | — | — |
| `/api/clients/:id/context-memory` | GET,POST | autenticada | — | — |
| `/api/clients/:id/interactions` | GET,POST,DELETE | autenticada | — | — |
| `/api/clients/:id/partners` | GET,POST,DELETE | autenticada | — | — |
| `/api/clients/:id/schedules` | GET,POST,PATCH,DELETE | autenticada | — | — |
| `/api/clients/:id/stage` | PATCH | autenticada | — | — |
| `/api/clients/campaigns` | GET | autenticada | — | — |
| `/api/clients/client-names` | GET | autenticada | — | — |
| `/api/clients/regions` | GET | autenticada | — | — |
| `/api/clients/stats` | GET | relatório | — | — |
| `/api/cron/fetch-meta-leads` | GET | cron | 10s | — |
| `/api/cron/fetch-meta-leads/config` | GET,PUT | cron | — | — |
| `/api/debug` | GET | autenticada | — | — |
| `/api/debug/prisma` | GET | autenticada | — | — |
| `/api/enterprises` | GET,POST | autenticada | — | — |
| `/api/enterprises/:id` | GET,PUT,DELETE | autenticada | — | — |
| `/api/enterprises/:id/floor-plans` | GET,POST,PUT,PATCH,DELETE | mídia/PDF | — | — |
| `/api/enterprises/:id/floor-plans/upload-image` | POST | mídia/PDF | — | — |
| `/api/enterprises/:id/form-fields` | GET,POST | autenticada | — | — |
| `/api/enterprises/:id/images` | GET,POST,PUT,DELETE | mídia/PDF | — | — |
| `/api/enterprises/:id/pdf` | POST,DELETE | mídia/PDF | 120s | — |
| `/api/enterprises/:id/resale-properties` | GET,POST,DELETE | autenticada | — | — |
| `/api/enterprises/batch` | POST | autenticada | — | — |
| `/api/enterprises/cache-all` | POST | autenticada | 120s | — |
| `/api/enterprises/catalog/:slug` | GET,PUT | autenticada | — | — |
| `/api/enterprises/extract-info` | POST | mídia/PDF | 120s | — |
| `/api/enterprises/extraction/draft` | DELETE | mídia/PDF | — | — |
| `/api/enterprises/extraction/publish` | POST | mídia/PDF | — | — |
| `/api/enterprises/extraction/restore` | POST | mídia/PDF | — | — |
| `/api/enterprises/extraction/status` | GET | mídia/PDF | — | — |
| `/api/enterprises/extraction/versions` | GET,DELETE | mídia/PDF | — | — |
| `/api/enterprises/form-fields/:fieldId` | PUT,DELETE | autenticada | — | — |
| `/api/enterprises/landing-slug` | PUT | autenticada | — | — |
| `/api/enterprises/list-public` | GET | pública | — | — |
| `/api/enterprises/panel` | GET | autenticada | — | — |
| `/api/enterprises/public-lead` | POST | autenticada | — | — |
| `/api/enterprises/public-list` | GET | autenticada | — | — |
| `/api/enterprises/public/:slug` | GET | autenticada | — | — |
| `/api/enterprises/resale-all` | GET | autenticada | — | — |
| `/api/enterprises/resale-import` | POST | mídia/PDF | — | — |
| `/api/enterprises/seed-missing` | POST | autenticada | — | — |
| `/api/enterprises/seed-vitta-info` | GET | autenticada | — | — |
| `/api/enterprises/update-cached-info` | POST | autenticada | — | — |
| `/api/enterprises/web-enrich` | GET,POST | autenticada | — | — |
| `/api/errors/:id` | PATCH,DELETE | autenticada | — | — |
| `/api/errors/list` | GET | autenticada | — | — |
| `/api/errors/log` | POST | autenticada | — | — |
| `/api/export` | GET | autenticada | — | — |
| `/api/google-calendar/auth` | GET | autenticada | — | — |
| `/api/google-calendar/callback` | GET | autenticada | — | — |
| `/api/google-calendar/disconnect` | POST | autenticada | — | — |
| `/api/google-calendar/status` | GET | autenticada | — | — |
| `/api/import` | POST | mídia/PDF | — | — |
| `/api/lead-queues` | GET,POST | autenticada | — | — |
| `/api/lead-queues/:id` | GET,PUT,DELETE | autenticada | — | — |
| `/api/lead-queues/:id/members` | GET,POST,PATCH,DELETE | autenticada | — | — |
| `/api/lead-queues/:id/members/:memberId` | PATCH,DELETE | autenticada | — | — |
| `/api/lead-queues/assign` | POST | autenticada | — | — |
| `/api/lead-queues/next-user` | GET | autenticada | — | — |
| `/api/leads/lost-leads` | GET,POST,DELETE | autenticada | 30s | — |
| `/api/leads/safety-net` | POST | autenticada | — | — |
| `/api/lp-view` | POST | pública | — | — |
| `/api/meta-ad-accounts` | GET,POST | autenticada | — | — |
| `/api/meta-ad-accounts/:id` | PATCH,DELETE | autenticada | — | — |
| `/api/meta-ad-accounts/:id/diagnose` | GET | autenticada | 30s | — |
| `/api/meta-ad-accounts/:id/subscribe-app-webhook` | POST | autenticada | 30s | — |
| `/api/meta-ad-accounts/:id/subscribe-page` | POST | autenticada | 30s | — |
| `/api/meta-ad-accounts/:id/sync-forms` | POST | autenticada | — | — |
| `/api/meta-ad-accounts/oauth/callback` | GET | autenticada | 30s | — |
| `/api/meta-ad-accounts/oauth/start` | GET | autenticada | — | — |
| `/api/meta-ads` | GET | autenticada | — | — |
| `/api/meta-ads/ai-analysis` | POST | autenticada | — | — |
| `/api/meta-ads/analyze` | GET | autenticada | — | — |
| `/api/meta-ads/leads` | GET | autenticada | — | — |
| `/api/meta-ads/temperature` | GET,PUT,DELETE | autenticada | 60s | — |
| `/api/meta-ads/temperature/backfill` | GET,POST | autenticada | 60s | — |
| `/api/meta-ads/temperature/forms` | GET,POST | autenticada | 60s | — |
| `/api/meta-ads/temperature/import-md` | POST | mídia/PDF | 60s | — |
| `/api/meta-ads/temperature/import-md/apply` | POST | mídia/PDF | 60s | — |
| `/api/meta-ads/temperature/reclassify` | POST | autenticada | 60s | — |
| `/api/meta-campaign-bindings` | GET,PATCH | autenticada | — | — |
| `/api/meta-capi-configs` | GET,POST | autenticada | — | — |
| `/api/meta-capi-configs/:id` | GET,PATCH,DELETE | autenticada | — | — |
| `/api/meta-capi-configs/:id/quality` | GET | autenticada | — | — |
| `/api/meta-capi-configs/form-mappings` | GET,POST,PATCH,DELETE | autenticada | — | — |
| `/api/meta-capi-logs` | GET | autenticada | — | — |
| `/api/notifications/cron` | GET | autenticada | — | — |
| `/api/ntfy/test` | POST | autenticada | — | — |
| `/api/pipeline` | GET | autenticada | — | — |
| `/api/profile` | GET,PUT | autenticada | — | — |
| `/api/reminders` | GET,POST | autenticada | — | — |
| `/api/reminders/:id` | PUT,DELETE | autenticada | — | — |
| `/api/reminders/check` | GET | autenticada | — | — |
| `/api/reports` | GET | relatório | — | — |
| `/api/schedules` | GET | autenticada | — | — |
| `/api/settings` | GET,PUT | autenticada | — | — |
| `/api/settings/ntfy` | GET,PUT | autenticada | — | — |
| `/api/settings/ntfy/credentials` | GET | autenticada | — | — |
| `/api/settings/telegram` | GET,PUT | autenticada | — | — |
| `/api/tags` | GET,POST | autenticada | — | — |
| `/api/tags/:id` | PUT,DELETE | autenticada | — | — |
| `/api/teams` | GET,POST | autenticada | — | — |
| `/api/teams/:id` | PATCH,DELETE | autenticada | — | — |
| `/api/telegram/link-token` | POST | autenticada | — | — |
| `/api/telegram/test` | POST | autenticada | — | — |
| `/api/telegram/webhook` | POST | autenticada | — | — |
| `/api/telegram/webhook/register` | GET,POST | autenticada | — | — |
| `/api/track` | GET,POST | pública | — | — |
| `/api/track/debug` | GET,POST | pública | — | — |
| `/api/track/pixel.gif` | GET | pública | — | — |
| `/api/track/server` | POST | pública | — | — |
| `/api/tracking/campaigns` | GET | pública | — | — |
| `/api/tracking/dashboard` | GET | pública | — | — |
| `/api/tracking/report` | GET | pública | — | — |
| `/api/tracking/reset` | DELETE | pública | — | — |
| `/api/users` | GET,POST | autenticada | — | — |
| `/api/users/:id` | GET,PATCH,DELETE | autenticada | — | — |
| `/api/users/search` | GET | autenticada | — | — |
| `/api/webhooks/meta-leads` | GET,POST | webhook | 30s | — |
| `/api/webhooks/meta-leads/capi-test` | POST | webhook | — | — |
| `/api/webhooks/meta-leads/config` | GET,PUT | webhook | — | — |
| `/api/webhooks/meta-leads/import-by-form` | POST | webhook | — | — |
| `/api/webhooks/meta-leads/import-manual` | POST | webhook | — | — |
| `/api/webhooks/meta-leads/simulate` | GET,POST | webhook | — | — |
| `/api/whatsapp-landings` | GET,POST | autenticada | — | — |
| `/api/whatsapp-landings/:id` | PATCH,DELETE | autenticada | — | — |
| `/lp/:slug/go` | GET | autenticada | — | — |

### Totais por categoria

- autenticada: 98
- mídia/PDF: 14
- pública: 10
- webhook: 6
- pública (auth): 5
- relatório: 2
- cron: 2

TOTAL: 137 rotas de API

### Pages (12)

- `/change-password`
- `/empreendimentos`
- `/empreendimentos/[slug]`
- `/empreendimentos/[slug]/cadastro-sucesso`
- `/empreendimentos/empreendimentos`
- `/empreendimentos/empreendimentos/[slug]`
- `/empreendimentos/empreendimentos/[slug]/cadastro-sucesso`
- `/forgot-password`
- `/login`
- `/lp/[slug]`
- `/page.tsx`
- `/reset-password`
