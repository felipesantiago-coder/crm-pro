/**
 * Testes do gerenciamento de formulários da seção Temperatura
 * (importar/remover por conta de anúncios Meta):
 *   - placeholders de importação (campaignId sintático __account_<act_id>);
 *   - formIds JSON das contas (registro/desregistro do polling);
 *   - remoção do formulário não confunde placeholders com mapeamentos
 *     aprendidos de leads.
 *
 * Rodar: npm test (ou: node --test --import ./tests/ai/register.mjs tests/lead-temperature/form-management.test.ts)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAccountPlaceholderCampaignId,
  isPlaceholderCampaignId,
  mergeFormIdsIntoJson,
  removeFormIdFromJson,
  normalizeAdAccountId,
  PLACEHOLDER_CAMPAIGN_PREFIX,
} from '@/lib/meta-ad-accounts';

describe('buildAccountPlaceholderCampaignId', () => {
  test('normaliza ID numérico para act_ e prefixa com __account_', () => {
    assert.equal(buildAccountPlaceholderCampaignId('123456789'), '__account_act_123456789');
  });

  test('mantém prefixo act_ já existente', () => {
    assert.equal(buildAccountPlaceholderCampaignId('act_987654321'), '__account_act_987654321');
  });

  test('remove espaços das bordas', () => {
    assert.equal(buildAccountPlaceholderCampaignId('  111222333  '), '__account_act_111222333');
  });

  test('usa o mesmo formato do Sync Forms (compatibilidade de upsert)', () => {
    // O Sync Forms sempre usou `__account_${normalizeAdAccountId(...)}`;
    // a importação da Temperatura precisa gerar a MESMA chave para
    // reutilizar o registro em vez de duplicar.
    const adAccountId = '456789123';
    assert.equal(
      buildAccountPlaceholderCampaignId(adAccountId),
      `__account_${normalizeAdAccountId(adAccountId)}`,
    );
  });
});

describe('isPlaceholderCampaignId', () => {
  test('reconhece placeholders de importação', () => {
    assert.equal(isPlaceholderCampaignId('__account_act_123456789'), true);
    assert.equal(isPlaceholderCampaignId(PLACEHOLDER_CAMPAIGN_PREFIX), true);
  });

  test('não confunde com mapeamentos aprendidos de leads', () => {
    assert.equal(isPlaceholderCampaignId('23851234567890000'), false); // campaignId real
    assert.equal(isPlaceholderCampaignId('__no_campaign'), false);
    assert.equal(isPlaceholderCampaignId(null), false);
    assert.equal(isPlaceholderCampaignId(undefined), false);
    assert.equal(isPlaceholderCampaignId(''), false);
  });

  test('prefixo tem que casar do início (account_ no meio não conta)', () => {
    assert.equal(isPlaceholderCampaignId('campaign___account_act_1'), false);
  });
});

describe('mergeFormIdsIntoJson (registro no polling da conta)', () => {
  test('JSON inexistente → cria array com os ids', () => {
    assert.equal(mergeFormIdsIntoJson(null, ['111', '222']), '["111","222"]');
    assert.equal(mergeFormIdsIntoJson(undefined, ['111']), '["111"]');
  });

  test('preserva ids existentes e anexa os novos ao final', () => {
    assert.equal(
      mergeFormIdsIntoJson('["111"]', ['222', '333']),
      '["111","222","333"]',
    );
  });

  test('não duplica ids já presentes', () => {
    assert.equal(mergeFormIdsIntoJson('["111","222"]', ['222', '333']), '["111","222","333"]');
  });

  test('ignora ids vazios', () => {
    assert.equal(mergeFormIdsIntoJson(null, ['', '  ', '111']), '["111"]');
  });

  test('sem ids válidos → null (coluna vazia)', () => {
    assert.equal(mergeFormIdsIntoJson(null, []), null);
    assert.equal(mergeFormIdsIntoJson(null, ['']), null);
  });

  test('JSON corrompido é descartado e recriado', () => {
    assert.equal(mergeFormIdsIntoJson('{não é json', ['111']), '["111"]');
  });
});

describe('removeFormIdFromJson (desregistro do polling ao remover formulário)', () => {
  test('remove o formId mantendo os demais', () => {
    assert.equal(removeFormIdFromJson('["111","222","333"]', '222'), '["111","333"]');
  });

  test('último id removido → null (polling da conta para)', () => {
    assert.equal(removeFormIdFromJson('["111"]', '111'), null);
  });

  test('id não presente → JSON restante inalterado', () => {
    assert.equal(removeFormIdFromJson('["111","222"]', '999'), '["111","222"]');
  });

  test('JSON inexistente/corrompido → null', () => {
    assert.equal(removeFormIdFromJson(null, '111'), null);
    assert.equal(removeFormIdFromJson(undefined, '111'), null);
    assert.equal(removeFormIdFromJson('não-json', '111'), null);
  });

  test('só remove correspondência exata (não prefixos)', () => {
    assert.equal(removeFormIdFromJson('["111","111222"]', '111'), '["111222"]');
  });
});

describe('remoção de formulário — regras de negócio (placeholders × aprendidos)', () => {
  // Reproduz, em memória, o filtro do DELETE ?scope=form:
  // deleteMany({ where: { formId, campaignId: { startsWith: PREFIX } } })
  interface Mapping { formId: string; campaignId: string; queueId?: string }
  function removeForm(mappings: Mapping[], formId: string): Mapping[] {
    return mappings.filter((m) => !(m.formId === formId && isPlaceholderCampaignId(m.campaignId)));
  }

  test('remove placeholders de importação e PRESERVA mapeamentos aprendidos (fila/CAPI)', () => {
    const mappings: Mapping[] = [
      { formId: 'F1', campaignId: '__account_act_111' },
      { formId: 'F1', campaignId: '23851000000000123', queueId: 'fila-vendas' },
      { formId: 'F1', campaignId: '__no_campaign' },
      { formId: 'F2', campaignId: '__account_act_111' },
    ];

    const remaining = removeForm(mappings, 'F1');
    assert.deepEqual(remaining, [
      { formId: 'F1', campaignId: '23851000000000123', queueId: 'fila-vendas' },
      { formId: 'F1', campaignId: '__no_campaign' },
      { formId: 'F2', campaignId: '__account_act_111' },
    ]);
  });

  test('remover formulário de outra conta não afeta placeholders de outras formas', () => {
    const mappings: Mapping[] = [
      { formId: 'F1', campaignId: '__account_act_111' },
      { formId: 'F2', campaignId: '__account_act_222' },
    ];
    const remaining = removeForm(mappings, 'F2');
    assert.deepEqual(remaining, [{ formId: 'F1', campaignId: '__account_act_111' }]);
  });
});
