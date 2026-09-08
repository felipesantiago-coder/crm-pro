/**
 * teams.ts — lógica PURA de equipes (sem Prisma/Next).
 *
 * Usada por:
 *  - queues-tab: seleção "equipe primeiro → membros da equipe" ao adicionar
 *    atendentes a uma fila (admins entram pela pseudo-equipe ADMIN_OPTION;
 *    usuários sem equipe, pela pseudo-equipe TEAMLESS_OPTION).
 *  - rotas /api/clients e /api/pipeline: filtro de leads por equipe
 *    (leads manuais e automáticos compartilham o mesmo campo createdBy —
 *    automáticos são reatribuídos ao atendente da fila no assign).
 *
 * Regra de negócio: administradores NÃO pertencem a equipes específicas.
 */

/** Opção especial do seletor: pseudo-equipe dos administradores. */
export const ADMIN_TEAM_OPTION = '__admins__';

/** Opção especial do seletor: usuários regulares sem equipe. */
export const TEAMLESS_OPTION = '__teamless__';

export interface TeamCandidateUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
}

export interface TeamWithMembers {
  id: string;
  name: string;
  members: TeamCandidateUser[];
}

export interface QueueCandidatesParams {
  /** Valor do seletor: '' (nada selecionado), id de equipe ou pseudo-opção. */
  selectedTeam: string;
  teams: TeamWithMembers[];
  /** Usuários ADMIN (fora de qualquer equipe por design). */
  admins: TeamCandidateUser[];
  /** Usuários regulares sem equipe. */
  teamless: TeamCandidateUser[];
  /** userIds que JÁ são membros da fila (não podem repetir). */
  existingMemberIds: ReadonlySet<string> | readonly string[];
}

/**
 * Candidatos a membro de fila após a escolha da equipe.
 * Ordem determinística: membros na ordem da equipe; pseudo-equipe por nome.
 * Retorna [] quando nada selecionado, equipe desconhecida ou sem candidatos.
 */
export function pickQueueCandidates(params: QueueCandidatesParams): TeamCandidateUser[] {
  const { selectedTeam, teams, admins, teamless } = params;
  const existing = params.existingMemberIds instanceof Set
    ? params.existingMemberIds
    : new Set(params.existingMemberIds);

  let pool: TeamCandidateUser[];
  if (selectedTeam === ADMIN_TEAM_OPTION) {
    pool = admins;
  } else if (selectedTeam === TEAMLESS_OPTION) {
    pool = teamless;
  } else if (selectedTeam === '') {
    return [];
  } else {
    const team = teams.find((t) => t.id === selectedTeam);
    if (!team) return [];
    pool = team.members;
  }

  // Remove quem já está na fila e deduplica por id (defensivo).
  const seen = new Set<string>();
  return pool.filter((u) => {
    if (existing.has(u.id) || seen.has(u.id)) return false;
    seen.add(u.id);
    return true;
  });
}

/**
 * Filtro Prisma de leads por equipe (createdBy ∈ membros).
 * - teamId vazio → null (sem filtro; admin vê tudo).
 * - equipe sem membros → { createdBy: { in: [] } } (resultado vazio, não erro).
 * Nunca aplica filtro para quem não é admin — quem chama garante isso.
 */
export function buildTeamLeadFilter(
  teamId: string,
  memberIds: readonly string[],
): { createdBy: { in: string[] } } | null {
  if (!teamId) return null;
  return { createdBy: { in: [...memberIds] } };
}

/**
 * Mapa userId → nome da equipe (badge na lista de membros da fila).
 * Usuários sem equipe e admins não entram no mapa.
 */
export function buildUserTeamNames(teams: TeamWithMembers[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const team of teams) {
    for (const member of team.members) {
      if (!map.has(member.id)) map.set(member.id, team.name);
    }
  }
  return map;
}
