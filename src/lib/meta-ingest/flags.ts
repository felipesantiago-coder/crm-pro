// ============================================================
// FEATURE FLAGS da Fase 3 — canário com reversão por env
// ============================================================
// Padrão do rollout (prompt §Validação): canário de produção com
// feature flags para inbox, cursor, outbox e cache.
//
//   META_INGEST_V2=legacy    → webhook volta ao processamento inline
//                              (sem inbox/worker/status)
//   META_POLL_CURSOR_V2=legacy → polling volta a watermarks soltas +
//                              isRunning em memória + quota in-memory
//
// Default: caminho novo LIGADO. Reversão instantânea: variável de
// ambiente + redeploy (ou promote do deploy anterior no painel
// Vercel — ver docs/rollback.md §3).
// ============================================================

/** Inbox + worker/retry no webhook (default ON). */
export function isMetaInboxV2Enabled(): boolean {
  return process.env.META_INGEST_V2 !== 'legacy';
}

/** Cursor persistente + lease distribuído + quota atômica no polling (default ON). */
export function isMetaCursorV2Enabled(): boolean {
  return process.env.META_POLL_CURSOR_V2 !== 'legacy';
}
