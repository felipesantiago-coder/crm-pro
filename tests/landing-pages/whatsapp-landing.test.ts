import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_WHATSAPP_LANDING_MESSAGE,
  REGION_PLACEHOLDER,
  buildLandingWhatsappUrl,
  generateLandingSlug,
  isValidLandingSlug,
  landingPublicPath,
  normalizeLandingPhone,
  resolveLandingMessage,
} from '../../src/lib/whatsapp-landing.ts';

/* ── normalizeLandingPhone ─────────────────────────────── */

test('normalizeLandingPhone: número nacional formatado ganha DDI 55', () => {
  const r = normalizeLandingPhone('(11) 99999-9999');
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.value, '5511999999999');
});

test('normalizeLandingPhone: móvel sem formatação (11 dígitos) ganha DDI', () => {
  const r = normalizeLandingPhone('11999999999');
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.value, '5511999999999');
});

test('normalizeLandingPhone: fixo sem DDI (10 dígitos) ganha DDI', () => {
  const r = normalizeLandingPhone('11 3333 4444');
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.value, '551133334444');
});

test('normalizeLandingPhone: já com DDI 55 é mantido intacto', () => {
  const r = normalizeLandingPhone('+55 11 99999-9999');
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.value, '5511999999999');
});

test('normalizeLandingPhone: vazio é rejeitado com mensagem', () => {
  const r = normalizeLandingPhone('   ');
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /Informe o número/);
});

test('normalizeLandingPhone: dígitos insuficientes são rejeitados', () => {
  const r = normalizeLandingPhone('99999-9999');
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /Número inválido/);
});

test('normalizeLandingPhone: comprimento estranho sem DDI 55 é rejeitado', () => {
  assert.equal(normalizeLandingPhone('12345678901234').ok, false);
  assert.equal(normalizeLandingPhone('5512').ok, false);
});

/* ── resolveLandingMessage ─────────────────────────────── */

test('resolveLandingMessage: vazio cai na mensagem padrão do produto', () => {
  assert.equal(resolveLandingMessage('', 'Portal do Parque'), DEFAULT_WHATSAPP_LANDING_MESSAGE);
  assert.equal(resolveLandingMessage(null, 'X'), DEFAULT_WHATSAPP_LANDING_MESSAGE);
  assert.equal(resolveLandingMessage(undefined, 'X'), DEFAULT_WHATSAPP_LANDING_MESSAGE);
  assert.equal(resolveLandingMessage('   ', 'X'), DEFAULT_WHATSAPP_LANDING_MESSAGE);
});

test('resolveLandingMessage: mensagem padrão é EXATAMENTE a pedida', () => {
  assert.equal(DEFAULT_WHATSAPP_LANDING_MESSAGE, 'Olá, gostaria de conhecer outras opções na região');
});

test('resolveLandingMessage: placeholder {regiao} é substituído', () => {
  assert.equal(
    resolveLandingMessage(`Olá! Quero conhecer outras opções na região ${REGION_PLACEHOLDER}`, 'Portal do Parque'),
    'Olá! Quero conhecer outras opções na região Portal do Parque',
  );
  assert.equal(resolveLandingMessage('{regiao} - fale comigo', 'Vila Nova'), 'Vila Nova - fale comigo');
});

test('resolveLandingMessage: mensagem sem placeholder é mantida como está', () => {
  assert.equal(resolveLandingMessage('Oi, vim do anúncio', 'Qualquer'), 'Oi, vim do anúncio');
});

/* ── buildLandingWhatsappUrl ───────────────────────────── */

test('buildLandingWhatsappUrl: wa.me com mensagem url-encodada', () => {
  const url = buildLandingWhatsappUrl('5511999999999', 'Olá, gostaria de conhecer outras opções na região');
  assert.ok(url.startsWith('https://wa.me/5511999999999?text='));
  assert.equal(url, 'https://wa.me/5511999999999?text=Ol%C3%A1%2C%20gostaria%20de%20conhecer%20outras%20op%C3%A7%C3%B5es%20na%20regi%C3%A3o');
});

/* ── slug ──────────────────────────────────────────────── */

test('generateLandingSlug: acentos, maiúsculas e espaços viram slug', () => {
  assert.equal(generateLandingSlug('Portal do Parque'), 'portal-do-parque');
  assert.equal(generateLandingSlug('  Alphaville   Leste  '), 'alphaville-leste');
  assert.equal(generateLandingSlug('Jardim das Acácias'), 'jardim-das-acacias');
  assert.equal(generateLandingSlug('Centro!!!'), 'centro');
});

test('isValidLandingSlug: só minúsculas, números e hífens internos', () => {
  assert.equal(isValidLandingSlug('portal-do-parque'), true);
  assert.equal(isValidLandingSlug('lp-2'), true);
  assert.equal(isValidLandingSlug('Portal'), false);
  assert.equal(isValidLandingSlug('com espaço'), false);
  assert.equal(isValidLandingSlug('-inicia-hifen'), false);
  assert.equal(isValidLandingSlug('termina-hifen-'), false);
  assert.equal(isValidLandingSlug(''), false);
});

test('landingPublicPath: caminho público da landing', () => {
  assert.equal(landingPublicPath('portal-do-parque'), '/lp/portal-do-parque');
});
