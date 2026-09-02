import {
  CircleDashed,
  Search,
  CalendarClock,
  CalendarCheck,
  FileText,
  FileSignature,
  Trophy,
  XCircle,
  type LucideIcon,
} from 'lucide-react';

/**
 * Configuração compartilhada dos estágios do pipeline — fonte única
 * para Kanban, cards, relatórios e demais telas.
 *
 * Semântica de cor oficial CRM Pro v2.0:
 * - Lead: slate/neutro (sem progresso);
 * - Prospect: ciano (integração/fluxo);
 * - Visita agendada: azul (informação/agenda);
 * - Visita realizada: índigo (marca/ação);
 * - Carta proposta: âmbar (atenção);
 * - Contrato gerado: violeta;
 * - Fechado ganho: verde (sucesso);
 * - Fechado perdido: vermelho/rose (erro/perda).
 *
 * Todas as combinações garantem contraste AA nos temas claro e escuro.
 */
export type StageVisual = {
  label: string;
  icon: LucideIcon;
  color: string;
  bg: string;
  border: string;
  dot: string;
  /** Fundo de destaque de drop com contraste adicional (borda + fundo + texto). */
  dropRing: string;
};

export const STAGE_CONFIG: Record<string, StageVisual> = {
  LEAD: {
    label: 'Lead',
    icon: CircleDashed,
    color: 'text-slate-700 dark:text-slate-300',
    bg: 'bg-slate-100 dark:bg-slate-800/50',
    border: 'border-slate-300 dark:border-slate-700',
    dot: 'bg-slate-400',
    dropRing: 'ring-slate-400/60 bg-slate-100 dark:bg-slate-800/60',
  },
  PROSPECT: {
    label: 'Prospect',
    icon: Search,
    color: 'text-cyan-700 dark:text-cyan-300',
    bg: 'bg-cyan-50 dark:bg-cyan-950/40',
    border: 'border-cyan-300 dark:border-cyan-800/60',
    dot: 'bg-cyan-500',
    dropRing: 'ring-cyan-500/50 bg-cyan-50 dark:bg-cyan-950/50',
  },
  VISITA_AGENDADA: {
    label: 'Visita Agendada',
    icon: CalendarClock,
    color: 'text-blue-700 dark:text-blue-300',
    bg: 'bg-blue-50 dark:bg-blue-950/40',
    border: 'border-blue-300 dark:border-blue-800/60',
    dot: 'bg-blue-500',
    dropRing: 'ring-blue-500/50 bg-blue-50 dark:bg-blue-950/50',
  },
  VISITA_REALIZADA: {
    label: 'Visita Realizada',
    icon: CalendarCheck,
    color: 'text-indigo-700 dark:text-indigo-300',
    bg: 'bg-indigo-50 dark:bg-indigo-950/40',
    border: 'border-indigo-300 dark:border-indigo-800/60',
    dot: 'bg-indigo-500',
    dropRing: 'ring-indigo-500/50 bg-indigo-50 dark:bg-indigo-950/50',
  },
  CARTA_PROPOSTA: {
    label: 'Carta Proposta',
    icon: FileText,
    color: 'text-amber-700 dark:text-amber-300',
    bg: 'bg-amber-50 dark:bg-amber-950/40',
    border: 'border-amber-300 dark:border-amber-800/60',
    dot: 'bg-amber-500',
    dropRing: 'ring-amber-500/50 bg-amber-50 dark:bg-amber-950/50',
  },
  CONTRATO_GERADO: {
    label: 'Contrato Gerado',
    icon: FileSignature,
    color: 'text-violet-700 dark:text-violet-300',
    bg: 'bg-violet-50 dark:bg-violet-950/40',
    border: 'border-violet-300 dark:border-violet-800/60',
    dot: 'bg-violet-500',
    dropRing: 'ring-violet-500/50 bg-violet-50 dark:bg-violet-950/50',
  },
  FECHADO_GANHO: {
    label: 'Fechado Ganho',
    icon: Trophy,
    color: 'text-emerald-700 dark:text-emerald-300',
    bg: 'bg-emerald-50 dark:bg-emerald-950/40',
    border: 'border-emerald-300 dark:border-emerald-800/60',
    dot: 'bg-emerald-500',
    dropRing: 'ring-emerald-500/50 bg-emerald-50 dark:bg-emerald-950/50',
  },
  FECHADO_PERDIDO: {
    label: 'Fechado Perdido',
    icon: XCircle,
    color: 'text-rose-700 dark:text-rose-300',
    bg: 'bg-rose-50 dark:bg-rose-950/40',
    border: 'border-rose-300 dark:border-rose-800/60',
    dot: 'bg-rose-500',
    dropRing: 'ring-rose-500/50 bg-rose-50 dark:bg-rose-950/50',
  },
};

/** Configuração com fallback seguro para estágios desconhecidos. */
export function getStageConfig(stage: string): StageVisual {
  return (
    STAGE_CONFIG[stage] ?? {
      label: stage,
      icon: CircleDashed,
      color: 'text-slate-700 dark:text-slate-300',
      bg: 'bg-slate-100 dark:bg-slate-800/50',
      border: 'border-slate-300 dark:border-slate-700',
      dot: 'bg-slate-400',
      dropRing: 'ring-slate-400/60 bg-slate-100 dark:bg-slate-800/60',
    }
  );
}

/** Lista ordenada dos estágios do pipeline. */
export const PIPELINE_STAGES: string[] = [
  'LEAD',
  'PROSPECT',
  'VISITA_AGENDADA',
  'VISITA_REALIZADA',
  'CARTA_PROPOSTA',
  'CONTRATO_GERADO',
  'FECHADO_GANHO',
  'FECHADO_PERDIDO',
];
