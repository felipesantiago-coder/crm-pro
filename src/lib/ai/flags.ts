/**
 * flags.ts — Feature flags e kill switch das capacidades do Nexo
 * (prompt v1.0 §8.1 "feature flags e kill switch" + §19.10).
 *
 * Leitura pura de env no servidor. Defaults seguros: capacidades novas
 * ligadas (são aditivas e revisáveis), mas qualquer uma pode ser
 * desligada em produção sem deploy de código (env na Vercel).
 * `NEXO_AI_KILL_SWITCH=1` desativa TODAS as capacidades generativas
 * do gateway de uma vez (o CRM determinístico continua funcionando).
 */

function flag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultValue;
  return raw === '1' || raw.toLowerCase() === 'true';
}

export interface NexoFeatureFlags {
  /** Resumo do cliente estruturado (ClientBrief) com cache. */
  clientBrief: boolean;
  /** Pipeline de extração v2 (draft/verificado/publicado) com revisão. */
  extractionV2: boolean;
  /** Nudge proativo de revisão documental de empreendimentos. */
  proactiveEnterprise: boolean;
  /** Importador revenda com simulação (dry run) e classificação. */
  resaleDryRun: boolean;
}

export function getFeatureFlags(): NexoFeatureFlags {
  return {
    clientBrief: flag('NEXO_FLAG_CLIENT_BRIEF', true),
    extractionV2: flag('NEXO_FLAG_EXTRACTION_V2', true),
    proactiveEnterprise: flag('NEXO_FLAG_PROACTIVE_ENTERPRISE', true),
    resaleDryRun: flag('NEXO_FLAG_RESALE_DRY_RUN', true),
  };
}

export function isAiKillSwitchActive(): boolean {
  return flag('NEXO_AI_KILL_SWITCH', false);
}
