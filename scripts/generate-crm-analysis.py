#!/usr/bin/env python3
"""
CRM Pro - Analise Comparativa de Funcionalidades
Gera relatorio PDF com gap analysis contra concorrentes (CV CRM, etc.)
"""

import os, sys, hashlib
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm, cm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY, TA_RIGHT
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, KeepTogether, HRFlowable, Image
)
from reportlab.platypus.tableofcontents import TableOfContents
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import registerFontFamily
from reportlab.lib.colors import HexColor

# ━━ Font Registration ━━
FONT_DIR = '/usr/share/fonts'

# Noto Serif SC for body (CJK safe)
pdfmetrics.registerFont(TTFont('NotoSerifSC', f'{FONT_DIR}/truetype/noto-serif-sc/NotoSerifSC-Regular.ttf'))
pdfmetrics.registerFont(TTFont('NotoSerifSC-Bold', f'{FONT_DIR}/truetype/noto-serif-sc/NotoSerifSC-Bold.ttf'))
registerFontFamily('NotoSerifSC', normal='NotoSerifSC', bold='NotoSerifSC-Bold')

# Liberation Sans for UI/labels
pdfmetrics.registerFont(TTFont('LiberationSans', f'{FONT_DIR}/truetype/liberation/LiberationSans-Regular.ttf'))
pdfmetrics.registerFont(TTFont('LiberationSans-Bold', f'{FONT_DIR}/truetype/liberation/LiberationSans-Bold.ttf'))
registerFontFamily('LiberationSans', normal='LiberationSans', bold='LiberationSans-Bold')

# ━━ Cascade Palette ━━
PAGE_BG       = colors.HexColor('#f1f1f0')
SECTION_BG    = colors.HexColor('#ededea')
CARD_BG       = colors.HexColor('#e9e8e5')
TABLE_STRIPE  = colors.HexColor('#f0efed')
HEADER_FILL   = colors.HexColor('#736847')
COVER_BLOCK   = colors.HexColor('#696148')
BORDER        = colors.HexColor('#d4cfc0')
ICON          = colors.HexColor('#93814c')
ACCENT        = colors.HexColor('#a48528')
ACCENT_2      = colors.HexColor('#4794ae')
TEXT_PRIMARY   = colors.HexColor('#242320')
TEXT_MUTED     = colors.HexColor('#7e7c75')
SEM_SUCCESS   = colors.HexColor('#3c8052')
SEM_WARNING   = colors.HexColor('#997b3f')
SEM_ERROR     = colors.HexColor('#95443c')
SEM_INFO      = colors.HexColor('#4f779f')

# ━━ Output ━━
OUTPUT_DIR = '/home/z/my-project/download'
os.makedirs(OUTPUT_DIR, exist_ok=True)
OUTPUT_PATH = os.path.join(OUTPUT_DIR, 'analise-funcionalidades-crm-pro.pdf')

# ━━ Page Setup ━━
PAGE_W, PAGE_H = A4
LEFT_MARGIN = 22*mm
RIGHT_MARGIN = 22*mm
TOP_MARGIN = 25*mm
BOTTOM_MARGIN = 25*mm
CONTENT_W = PAGE_W - LEFT_MARGIN - RIGHT_MARGIN

# ━━ Styles ━━
styles = getSampleStyleSheet()

s_h1 = ParagraphStyle('H1Custom', parent=styles['Heading1'],
    fontName='LiberationSans-Bold', fontSize=20, leading=26,
    textColor=HEADER_FILL, spaceAfter=10, spaceBefore=20,
    borderPadding=(0,0,4,0))

s_h2 = ParagraphStyle('H2Custom', parent=styles['Heading2'],
    fontName='LiberationSans-Bold', fontSize=15, leading=20,
    textColor=ACCENT, spaceAfter=8, spaceBefore=16)

s_h3 = ParagraphStyle('H3Custom', parent=styles['Heading3'],
    fontName='LiberationSans-Bold', fontSize=12, leading=16,
    textColor=ICON, spaceAfter=6, spaceBefore=12)

s_body = ParagraphStyle('BodyCustom', parent=styles['Normal'],
    fontName='NotoSerifSC', fontSize=10, leading=16,
    textColor=TEXT_PRIMARY, alignment=TA_JUSTIFY, spaceAfter=8,
    firstLineIndent=0)

s_body_indent = ParagraphStyle('BodyIndent', parent=s_body,
    leftIndent=12)

s_bullet = ParagraphStyle('BulletCustom', parent=s_body,
    leftIndent=20, firstLineIndent=-12, spaceAfter=4)

s_caption = ParagraphStyle('CaptionCustom', parent=styles['Normal'],
    fontName='NotoSerifSC', fontSize=8, leading=11,
    textColor=TEXT_MUTED, alignment=TA_CENTER, spaceAfter=6)

s_kicker = ParagraphStyle('KickerCustom', parent=styles['Normal'],
    fontName='LiberationSans', fontSize=9, leading=12,
    textColor=TEXT_MUTED, alignment=TA_LEFT, spaceAfter=2)

s_table_header = ParagraphStyle('TableHeader', parent=styles['Normal'],
    fontName='LiberationSans-Bold', fontSize=8.5, leading=12,
    textColor=colors.white, alignment=TA_CENTER)

s_table_cell = ParagraphStyle('TableCell', parent=styles['Normal'],
    fontName='NotoSerifSC', fontSize=8.5, leading=12,
    textColor=TEXT_PRIMARY, alignment=TA_LEFT)

s_table_cell_center = ParagraphStyle('TableCellCenter', parent=s_table_cell,
    alignment=TA_CENTER)

# ━━ TOC Styles ━─
toc_level0 = ParagraphStyle('TOC0', fontName='LiberationSans-Bold', fontSize=11,
    leading=20, leftIndent=0, textColor=TEXT_PRIMARY)
toc_level1 = ParagraphStyle('TOC1', fontName='NotoSerifSC', fontSize=10,
    leading=18, leftIndent=20, textColor=TEXT_MUTED)

# ━━ TOC DocTemplate ━━
class TocDocTemplate(SimpleDocTemplate):
    def afterFlowable(self, flowable):
        if hasattr(flowable, 'bookmark_name'):
            level = getattr(flowable, 'bookmark_level', 0)
            text = getattr(flowable, 'bookmark_text', '')
            key = getattr(flowable, 'bookmark_key', '')
            self.notify('TOCEntry', (level, text, self.page, key))

def add_heading(text, style, level=0):
    key = f'h_{hashlib.md5(text.encode()).hexdigest()[:8]}'
    p = Paragraph(f'<a name="{key}"/>{text}', style)
    p.bookmark_name = key
    p.bookmark_level = level
    p.bookmark_text = text
    p.bookmark_key = key
    return p

def make_table(headers, rows, col_widths=None):
    """Create a styled table with header and alternating rows."""
    header_cells = [Paragraph(h, s_table_header) for h in headers]
    data = [header_cells]
    for row in rows:
        data.append([Paragraph(str(c), s_table_cell) for c in row])

    if col_widths is None:
        col_widths = [CONTENT_W / len(headers)] * len(headers)

    t = Table(data, colWidths=col_widths, repeatRows=1)
    style_cmds = [
        ('BACKGROUND', (0, 0), (-1, 0), HEADER_FILL),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'LiberationSans-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 8.5),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 8),
        ('TOPPADDING', (0, 0), (-1, 0), 8),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 1), (-1, -1), 6),
        ('TOPPADDING', (0, 1), (-1, -1), 6),
        ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
    ]
    # Alternating row colors
    for i in range(1, len(data)):
        if i % 2 == 0:
            style_cmds.append(('BACKGROUND', (0, i), (-1, i), TABLE_STRIPE))
        else:
            style_cmds.append(('BACKGROUND', (0, i), (-1, i), colors.white))
    t.setStyle(TableStyle(style_cmds))
    return t

def hr():
    return HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=10, spaceBefore=10)

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# BUILD STORY
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
story = []

# ── TOC ──
toc = TableOfContents()
toc.levelStyles = [toc_level0, toc_level1]
story.append(Paragraph('Sumario', ParagraphStyle('TOCTitle', parent=s_h1, textColor=HEADER_FILL, fontSize=22, spaceBefore=0)))
story.append(Spacer(1, 12))
story.append(toc)
story.append(PageBreak())

# ═══════════════════════════════════════════════════
# 1. INTRODUCAO
# ═══════════════════════════════════════════════════
story.append(add_heading('1. Introducao e Contexto', s_h1, 0))

story.append(Paragraph(
    'O mercado imobiliario brasileiro possui um ecossistema maduro de CRMs especializados, liderado por solucoes como o CV CRM (Construtor de Vendas), '
    'que acumula mais de 13 anos de experiencia, 1.500 clientes incorporadores e 300.000 corretores associados. Alem do CV CRM, concorrentes como Hypnobox, '
    'Supremo CRM, Kenlo, Dommus e Facilita CRM oferecem funcionalidades robustas que atendem desde pequenas imobiliarias ate grandes redes de '
    'incorporacao. Este relatorio apresenta uma analise comparativa profunda entre essas solucoes e o CRM Pro, identificando lacunas funcionais '
    'e oportunidades estrategicas de evolucao.', s_body))

story.append(Paragraph(
    'A analise foi conduzida em tres etapas: (1) mapeamento exaustivo de todas as funcionalidades ja implementadas no CRM Pro, cobrindo seus 56 endpoints '
    'de API, 22 componentes de interface, 18 modelos de banco de dados e 8 integracoes ativas; (2) pesquisa de mercado sobre as funcionalidades '
    'oferecidas pelos principais concorrentes brasileiros; e (3) cruzamento dos dados para identificar lacunas e priorizar as funcionalidades '
    'mais relevantes para a evolucao do produto.', s_body))

story.append(Paragraph(
    'Cada funcionalidade identificada como ausente foi avaliada sob tres perspectivas complementares: a facilidade de uso para o corretor '
    '(usuario final), o valor para o administrador do sistema, e o impacto na adocao por grandes imobiliarias e incorporadoras. '
    'Essa tripla avaliacao permite construir uma estrategia de desenvolvimento que equilibre usabilidade, gestao e escalabilidade comercial.', s_body))

story.append(add_heading('1.1. O que o CRM Pro ja implementa', s_h2, 1))

story.append(Paragraph(
    'O CRM Pro ja possui uma base solida com 56 endpoints de API, 22 componentes de interface reativa e 8 integracoes ativas. '
    'Entre as funcionalidades implementadas estao: gestao completa de clientes com pipeline kanban de 8 etapas, integracao com Google Calendar '
    '(OAuth2 com sincronizacao de agendamentos), notificacoes multi-canal (Telegram, Ntfy, WhatsApp via Meta Cloud API, email via Resend), '
    'distribuicao automatica de leads por filas round-robin, landing pages dinamicas para empreendimentos com tracking pixel avancado, '
    'importacao de leads via Meta Lead Ads com verificacao HMAC, assistente de IA (Gemini 2.5 Flash / Groq Llama 3.1) com contexto do CRM, '
    'analise de metricas com dashboard de campanhas UTM, portal do cliente com reagendamento autosservico, e sistema de tags, lembretes, '
    'parcerias entre corretores e importacao/exportacao de dados via XLSX/CSV.', s_body))

# ═══════════════════════════════════════════════════
# 2. PANORAMA DO MERCADO
# ═══════════════════════════════════════════════════
story.append(add_heading('2. Panorama do Mercado de CRM Imobiliario', s_h1, 0))

story.append(Paragraph(
    'O mercado brasileiro de CRM imobiliario se divide em dois grandes segmentos. O primeiro e composto por plataformas voltadas para '
    'incorporadoras e grandes lancamentos, onde o CV CRM domina com sua suite modular de 6 modulos (Prospectar, Vender, Relacionar, '
    'Gerenciar, Integrar e Magic). O segundo segmento abrange CRMs para imobiliarias e corretores, com players como Supremo CRM, Kenlo, '
    'Jetimob e Vista CRM (da Loft) competindo por fatias de mercado com propostas que combinam vendas, locacao e marketing.', s_body))

story.append(Paragraph(
    'Uma tendencia clara observada e a IA como diferencial competitivo. O CV CRM lancou o CV Magic com geracao de texto por IA (CVIA), '
    'analise de documentos e insights automatizados. O Supremo CRM oferece o Gerente Virtual para distribuicao inteligente de leads e '
    'qualificacao via WhatsApp com IA. Solucoes externas como Morada.ai adicionam camadas de IA sobre CRMs existentes, oferecendo '
    'qualificacao automatica de leads por WhatsApp. Outra tendencia e a integracao com portais imobiliarios (ZAP Imoveis, Viva Real, OLX), '
    'que se tornou requisito basico para qualquer CRM do setor. A integracao com WhatsApp tambem e onipresente, com todos os '
    'concorrentes oferecendo algum nivel de comunicacao via esse canal.', s_body))

story.append(add_heading('2.1. Principais concorrentes e seus diferenciais', s_h2, 1))

concorrentes_headers = ['CRM', 'Foco Principal', 'Diferencial', 'Modulos']
concorrentes_rows = [
    ['CV CRM', 'Incorporadoras', 'Suite completa 6 modulos, AI, assinatura eletronica',
     'Prospectar, Vender, Relacionar, Gerenciar, Integrar, Magic'],
    ['Hypnobox', 'Captura e distribuicao de leads', 'Regras granulares de distribuicao, integracao com portais',
     'Leads, Funil, Portais, Meta Ads'],
    ['Supremo CRM', 'Imobiliarias completas', 'IA para distribuicao de leads, modulo financeiro nativo',
     'Vendas, Locacao, Site, Marketing, Financeiro'],
    ['Kenlo', 'Vendas e locacao', 'Construtor de sites, BI/Inteligencia de dados',
     'Vendas, Locacao, Site, Portais, Meta Ads'],
    ['Dommus', 'Gestao de empreendimentos', 'Follow-up automatico por etapa do funil, precos dinamicos',
     'Empreendimentos, Vendas, Funil, Integracao'],
    ['Facilita CRM', 'Equipes comerciais', 'App mobile para corretores, gestao de cotas',
     'Vendas, Equipes, Reservas, WhatsApp'],
    ['Jetimob', 'Site + CRM', 'Gerador de sites com SEO integrado ao CRM',
     'Site, CRM, Funil, Portais, Meta Ads'],
    ['Vista CRM (Loft)', 'Corretores Loft', 'Integracao nativa com ecossistema Loft',
     'Funil, Qualificacao, WhatsApp, Site'],
]
story.append(make_table(concorrentes_headers, concorrentes_rows,
    [CONTENT_W*0.12, CONTENT_W*0.20, CONTENT_W*0.35, CONTENT_W*0.33]))
story.append(Paragraph('Tabela 1: Principais concorrentes e seus diferenciais no mercado brasileiro de CRM imobiliario.', s_caption))

# ═══════════════════════════════════════════════════
# 3. ANALISE DE LACUNAS
# ═══════════════════════════════════════════════════
story.append(add_heading('3. Analise de Lacunas Funcionais', s_h1, 0))

story.append(Paragraph(
    'A comparacao detalhada entre o CRM Pro e os concorrentes revela lacunas em tres grandes categorias: funcionalidades '
    'especificas do setor imobiliario que nao existem no CRM Pro, funcionalidades de automacao e IA que estao se tornando '
    'padrao de mercado, e funcionalidades operacionais que grandes imobiliarias consideram essenciais para adocao. A seguir, '
    'cada lacuna e detalhada com sua descricao, impacto e relevancia estrategica.', s_body))

# ── 3.1 Vendas e Reservas ──
story.append(add_heading('3.1. Modulo de Vendas e Reservas', s_h2, 1))

story.append(Paragraph(
    'O CV CRM possui o modulo CV Vender, que e o mais abrangente do mercado. Ele inclui espelho de vendas em tempo real (disponibilidade '
    'de unidades), gestao de reservas com fluxos de aprovacao (credito + juridico), gestao de propostas, tabela de precos com series, '
    'diferenciais e clonagem, simulacao de vendas com workflows de distribuicao e expiracao, mapa de disponibilidade 2D/3D, '
    'gestao de comissoes com regras de premiacoes e pagamento em lote, cessao de unidades, distratos, permutas e alcadas de aprovacao '
    'hierarquicas. O CRM Pro atualmente nao possui nenhuma dessas funcionalidades de natureza transacional, limitando-se ao '
    'gerenciamento de leads e ao acompanhamento comercial via pipeline kanban.', s_body))

story.append(Paragraph(
    'Para o Supremo CRM, o modulo financeiro e nativo e inclui controle de comissoes, pagamento de parcelas e gestao de contratos. '
    'O Dommus oferece gestao de empreendimentos com tabelas de precos dinamicas e follow-up automatico por etapa do funil. '
    'O Sigavi 360, voltado para grandes incorporadoras, destaca-se pelo controle em tempo real de tabelas de precos e disponibilidade '
    'de unidades, recursos que sao considerados essenciais por qualquer incorporadora de medio e grande porte.', s_body))

# ── 3.2 Portais ──
story.append(add_heading('3.2. Integracao com Portais Imobiliarios', s_h2, 1))

story.append(Paragraph(
    'A integracao com portais imobiliarios (ZAP Imoveis, Viva Real, OLX) e um requisito basico para qualquer CRM imobiliario no Brasil. '
    'Todos os principais concorrentes (CV CRM, Hypnobox, Kenlo, Supremo, Jetimob, Colibex) oferecem essa funcionalidade, que permite '
    'publicar automaticamente imoveis nos portais, receber leads diretamente no CRM e rastrear a origem de cada contato. O CRM Pro '
    'atualmente capta leads via Meta Ads e landing pages proprias, mas nao possui integracao com portais imobiliarios de terceiros.', s_body))

story.append(Paragraph(
    'A ausencia dessa integracao limita significativamente a adocao por imobiliarias que dependem desses portais como fonte '
    'principal de leads. A implementacao tipica envolve geracao de feeds XML no padrao SEFIP/ZAP, sincronizacao automatica de '
    'disponibilidade e precos, e recepcao de leads via webhook ou API dos portais. O Hypnobox se destaca por oferecer regras '
    'granulares de distribuicao por produto, empreendimento e perfil do corretor, direcionando leads de cada portal para '
    'o corretor mais adequado.', s_body))

# ── 3.3 WhatsApp ──
story.append(add_heading('3.3. Comunicacao Centralizada via WhatsApp', s_h2, 1))

story.append(Paragraph(
    'O CRM Pro ja utiliza o WhatsApp via Meta Cloud API para envio de notificacoes com templates pre-aprovados (5 tipos). No entanto, '
    'os concorrentes oferecem um nivel de integracao muito mais profundo. O CV CRM possui o Comunicador CV CRM, um hub centralizado '
    'que concentra todas as conversas com leads e clientes em uma interface unificada. O Supremo CRM e o Imobisoft oferecem '
    'qualificacao automatica de leads via WhatsApp com IA, onde um bot faz as primeiras perguntas de qualificacao antes de '
    'encaminhar ao corretor humano. O CV CRM tambem oferece uma extensao para Chrome que permite ao corretor registrar leads, '
    'verificar contatos e acessar leads ativos diretamente pelo WhatsApp Web.', s_body))

story.append(Paragraph(
    'A diferenca fundamental e que o CRM Pro usa WhatsApp como canal de saida (notificacoes do sistema), enquanto os concorrentes '
    'o usam como canal bidirecional (conversas completas com historico, qualificacao, respostas automaticas). Para uma grande imobiliaria, '
    'a capacidade de gerenciar todas as conversas com clientes dentro do CRM e essencial para garantir qualidade de atendimento '
    'e rastreamento completo do historico de interacoes.', s_body))

# ── 3.4 Follow-up ──
story.append(add_heading('3.4. Automacao de Follow-up e Campanhas', s_h2, 1))

story.append(Paragraph(
    'O CRM Pro possui sistema de lembretes manuais e notificacoes por cron, mas nao oferece automacao de follow-up baseada em '
    'regras ou gatilhos. O Dommus implementa follow-up automatico configuravel por etapa do funil, onde cada estagio do pipeline '
    'pode ter sequencias automaticas de mensagens e acoes. O CV CRM oferece campanhas de ativacao para reativar leads frios, '
    'e o RD Station (frequentemente integrado a CRMs imobiliarios) permite fluxos completos de lead nurturing com gatilhos '
    'baseados em comportamento, tempo e interacoes. Essa funcionalidade e particularmente valorizada por grandes equipes, '
    'onde o volume de leads torna o acompanhamento individual inviavel sem automacao.', s_body))

# ── 3.5 App Mobile ──
story.append(add_heading('3.5. Aplicativo Mobile para Corretores', s_h2, 1))

story.append(Paragraph(
    'O CV CRM oferece 5 aplicativos mobile distintos, cada um otimizado para um papel comercial (corretor, gerente, diretor, etc.), '
    'alem de um app dedicado para o portal do cliente. O Facilita CRM e o Kenlo tambem oferecem apps mobile com notificacoes push '
    'em tempo real sobre novos leads. O CRM Pro atualmente e uma aplicacao web responsiva, o que proporciona boa experiencia em '
    'dispositivos moveis via navegador, mas nao oferece as vantagens nativas de um app: notificacoes push instantaneas sem '
    'depender de polling, acesso offline, camera para documentos, e presenca na tela inicial do smartphone do corretor.', s_body))

story.append(Paragraph(
    'Para grandes imobiliarias, a presenca de um app mobile e frequentemente um criterio de decisao, pois os corretores operam '
    'predominantemente em campo, visitando obras e imoveis, e precisam de acesso rapido a dados de clientes, unidades disponiveis '
    'e historico de interacoes sem depender de uma conexao web estavel.', s_body))

# ── 3.6 Pontuacao ──
story.append(add_heading('3.6. Lead Scoring e Qualificacao Automatica', s_h2, 1))

story.append(Paragraph(
    'O CV CRM implementa pontuacao de engajamento (lead scoring) que acompanha a interacao do lead com o funil de vendas. '
    'O Supremo CRM utiliza IA para qualificacao automatica de leads via WhatsApp, onde o bot faz perguntas pre-definidas e '
    'classifica o lead conforme as respostas. O Hypnobox oferece rastreamento de origem que permite atribuir pontuacao '
    'diferenciada conforme o canal de entrada (portal, indicação, Meta Ads, etc.). O CRM Pro possui tags manuais e filtros por '
    'etapa do pipeline, mas nao possui um sistema automatico de pontuacao que considese comportamento, interacoes e '
    'perfis para priorizar os leads mais promissores.', s_body))

# ── 3.7 Pos-venda ──
story.append(add_heading('3.7. Modulo Pos-Venda e Relacionamento', s_h2, 1))

story.append(Paragraph(
    'O CV CRM possui o modulo CV Relacionar, dedicado ao pos-venda, que inclui portal do cliente com app mobile, agendamento de '
    'vistorias, assistencia tecnica, pesquisas de satisfacao e sistema de tickets para atendimento. O CRM Pro ja possui um portal '
    'do cliente basico com visualizacao de agendamentos e reagendamento, mas nao oferece vistorias, assistencia tecnica, pesquisas '
    'de satisfacao ou gestao de tickets. Para grandes incorporadoras, o ciclo de relacionamento pos-venda e tao importante quanto '
    'a venda propriamente dita, pois impacta a reputacao, a indicacao de novos clientes e a fidelizacao para futuros empreendimentos.', s_body))

# ── 3.8 Relatorios ──
story.append(add_heading('3.8. Relatorios Avancados e BI', s_h2, 1))

story.append(Paragraph(
    'O CRM Pro possui um dashboard de analise com graficos de distribuicao por etapa, funil de conversao, regionalizacao, '
    'empreendimentos e tendencias mensais. No entanto, o CV CRM oferece o CV Analitico, que inclui estatisticas de conversao por '
    'etapa do funil com drill-down, metricas de performance individual de cada corretor, rastreamento de conversao de simulacoes, '
    'analise de descartes por motivo e panorama de evolucao de leads ao longo do tempo. O Kenlo oferece BI e inteligencia de dados '
    'como modulo dedicado. Para uma grande imobiliaria, a capacidade de gerar relatorios personalizados com metricas de performance '
    'individual, comparativos entre equipes e analise de conversao detalhada e fundamental para a gestao estrategica.', s_body))

# ── 3.9 Contratos ──
story.append(add_heading('3.9. Assinatura Eletronica e Gestao de Contratos', s_h2, 1))

story.append(Paragraph(
    'O CV CRM possui o CV Sign, um sistema de assinatura eletronica integrado ao fluxo de vendas que permite assinar contratos '
    'diretamente dentro do CRM. O Supremo CRM e o Kenlo tambem oferecem gestao de contratos como parte de seus modulos. '
    'O CRM Pro atualmente nao possui funcionalidade de contratos ou assinatura eletronica. Para incorporadoras que processam '
    'centenas de contratos por mes, a integracao entre gestao comercial e assinatura eletronica elimina a necessidade de ferramentas '
    'externas (como DocuSign ou Clicksign) e reduz significativamente o tempo de fechamento.', s_body))

# ── 3.10 Conformidade ──
story.append(add_heading('3.10. LGPD e Gestao de Consentimento', s_h2, 1))

story.append(Paragraph(
    'O CV CRM e outros concorrentes declaram conformidade com a LGPD (Lei Geral de Protecao de Dados). Isso tipicamente inclui '
    'registro de consentimento dos leads, direto de exclusao de dados, auditoria de acessos e gestao de preferencias de comunicacao. '
    'O CRM Pro nao possui um modulo explicito de conformidade LGPD, embora tenha autenticacao com bcrypt e controle de acesso '
    'baseado em papeis. Para grandes imobiliarias e incorporadoras, a conformidade com a LGPD nao e apenas uma exigencia legal, '
    'mas um requisito comercial para firmar contratos corporativos e parcerias com empresas que exigem certificacao de protecao de dados.', s_body))

# ═══════════════════════════════════════════════════
# 4. RECOMENDACOES PRIORIZADAS
# ═══════════════════════════════════════════════════
story.append(add_heading('4. Funcionalidades Recomendadas: Analise Priorizada', s_h1, 0))

story.append(Paragraph(
    'Com base na analise de lacunas e nas tendencias do mercado, as funcionalidades a seguir foram selecionadas e avaliadas '
    'sob tres perspectivas: (1) Facilidade de uso para o corretor, avaliando a curva de aprendizado e o impacto no dia a dia '
    'do corretor; (2) Valor para o administrador, medindo a capacidade de gestao, controle e ganho de eficiencia; e (3) Impacto '
    'na adocao por grandes imobiliarias, avaliando o peso dessa funcionalidade como criterio de decisao de compra. Cada funcionalidade '
    'recebeu uma classificacao em cada perspectiva (Alta, Media, Baixa) e uma nota geral de prioridade de implementacao.', s_body))

# ── Feature 1 ──
story.append(add_heading('4.1. Integracao com Portais Imobiliarios (ZAP, Viva Real, OLX)', s_h2, 1))

story.append(Paragraph(
    '<b>Descricao:</b> Modulo que permite publicar automaticamente empreendimentos/imoveis nos principais portais imobiliarios '
    'brasileiros, receber leads diretamente no CRM e rastrear a origem de cada contato por portal e campanha. A implementacao '
    'envolve geracao de feeds XML no padrao SEFIP, sincronizacao bidirecional de disponibilidade e precos, e recepcao de leads via API.', s_body))

story.append(Paragraph(
    '<b>Perspectiva do Corretor (Alta):</b> O corretor se beneficia diretamente ao receber leads qualificados dos portais sem '
    'necessidade de cadastramento manual. Todos os leads chegam ja com dados preenchidos e vinculados ao empreendimento correto, '
    'reduzindo trabalho operacional e aumentando o volume de oportunidades. A origem do lead (qual portal, qual anuncio) fica '
    'automaticamente registrada, permitindo ao corretor entender o perfil e a intenção de cada contato desde o primeiro contato.', s_body))

story.append(Paragraph(
    '<b>Perspectiva do Administrador (Alta):</b> O administrador ganha visibilidade centralizada sobre a performance de cada portal, '
    'podendo comparar custo por lead, taxa de conversao e ROI de cada canal. A distribuicao automatica de leads por portal '
    '(ex.: leads do ZAP para corretores especializados em alto padrao) permite otimizar a conversao. A gestao de anuncios e '
    'disponibilidade a partir de um unico painel elimina a necessidade de acessar cada portal individualmente.', s_body))

story.append(Paragraph(
    '<b>Perspectiva de Adocao por Grande Imobiliaria (Critica):</b> Esta e possivelmente a funcionalidade mais importante para '
    'adocao corporativa. Grandes imobiliarias dependem dos portais como sua principal fonte de leads e exigem integracao nativa. '
    'Sem essa funcionalidade, o CRM seria imediatamente descartado em processos de seleção. A implementacao precisa suportar '
    'multiplos empreendimentos, sincronizacao de precos em tempo real e relatorios de performance por portal e por campanha.', s_body))

# ── Feature 2 ──
story.append(add_heading('4.2. Espelho de Vendas e Mapa de Disponibilidade de Unidades', s_h2, 1))

story.append(Paragraph(
    '<b>Descricao:</b> Painel visual em tempo real que mostra o status de cada unidade de um empreendimento (disponivel, reservada, '
    'vendida), com filtro por tipo de unidade, valor, andar e quadrant. Pode incluir visualizacao 2D (planta) ou 3D para '
    'loteamentos. O espelho de vendas e a ferramenta mais utilizada por corretores de lancamentos durante a negociacao presencial.', s_body))

story.append(Paragraph(
    '<b>Perspectiva do Corretor (Alta):</b> O corretor de lancamentos utiliza o espelho de vendas em praticamente toda visita '
    'presencial a obra ou ao stand de vendas. Poder consultar em tempo real quais unidades estao disponiveis, seus precos e '
    'caracteristicas diretamente no CRM, sem precisar ligar para a central ou consultar uma planilha externa, agiliza enormemente '
    'o processo de venda. A visualizacao por andar e tipo permite apresentar opcoes ao cliente de forma imediata.', s_body))

story.append(Paragraph(
    '<b>Perspectiva do Administrador (Alta):</b> O administrador tem controle total sobre a disponibilidade em tempo real, '
    'podendo ver qual corretor reservou qual unidade, ha quanto tempo e qual o status atual. Isso permite identificar rapidamente '
    'unidades estagnadas (reservadas ha muito tempo sem evolucao) e tomar acoes proativas. O mapa de vendas consolidado '
    'por empreendimento e uma ferramenta de gestao essencial para diretores comerciais.', s_body))

story.append(Paragraph(
    '<b>Perspectiva de Adocao por Grande Imobiliaria (Critica):</b> Nenhuma incorporadora de medio ou grande porte opera sem um '
    'espelho de vendas. E a ferramenta central do processo de vendas de lancamentos. A ausencia dessa funcionalidade exclui '
    'o CRM de todo o segmento de incorporacao. A implementacao deve suportar multiplos empreendimentos, atualizacao em tempo '
    'real e controle de permissoes (quais corretores podem ver quais precos).', s_body))

# ── Feature 3 ──
story.append(add_heading('4.3. Gestao de Reservas com Fluxo de Aprovacao', s_h2, 1))

story.append(Paragraph(
    '<b>Descricao:</b> Sistema completo de reservas de unidades que permite ao corretor iniciar uma reserva, enviar para aprovacao '
    'do setor de credito e/ou juridico, acompanhar o andamento, e efetivar a venda ou cancelar. Inclui controle de documentos '
    'exigidos, prazos de validade da reserva e hierarquia de aprovacao (alcadas).', s_body))

story.append(Paragraph(
    '<b>Perspectiva do Corretor (Media-Alta):</b> O corretor se beneficia de ter um fluxo claro e rastreavel para suas reservas, '
    'sabendo exatamente em qual etapa esta cada processo. A possibilidade de anexar documentos e acompanhar a aprovacao sem '
    'precisar enviar emails ou ligar para outros departamentos reduz o tempo de atendimento e a ansiedade do cliente. '
    'A interface deve ser simples, com indicadores visuais claros do status (pendente, em analise de credito, aprovado, rejeitado).', s_body))

story.append(Paragraph(
    '<b>Perspectiva do Administrador (Alta):</b> O administrador ganha controle total sobre o pipeline de reservas, podendo '
    'ver todas as reservas em andamento, identificar gargalos nos setores de aprovacao, definir prazos automaticos para validade '
    'de reservas e configurar alcadas (ex.: reservas acima de R$ 1 milhao precisam de aprovacao do diretor). O historico completo '
    'de cada reserva permite auditoria e analise de motivos de cancelamento.', s_body))

story.append(Paragraph(
    '<b>Perspectiva de Adocao por Grande Imobiliaria (Alta):</b> Grandes incorporadoras processam dezenas a centenas de reservas '
    'por mes e necessitam de um fluxo estruturado. A capacidade de configurar regras de aprovacao, prazos automaticos e '
    'hierarquias demonstra maturidade operacional do CRM e e um requisito para operacoes em escala.', s_body))

# ── Feature 4 ──
story.append(add_heading('4.4. Automacao de Follow-up com Sequencias por Etapa', s_h2, 1))

story.append(Paragraph(
    '<b>Descricao:</b> Motor de automacao que permite criar sequencias de acoes (mensagens por WhatsApp, email, SMS, notificacao in-app) '
    'disparadas automaticamente com base em gatilhos como tempo sem contato, mudanca de etapa no funil, inatividade do lead '
    'ou datas especificas. Cada etapa do pipeline pode ter sua propria sequencia de follow-up configuravel.', s_body))

story.append(Paragraph(
    '<b>Perspectiva do Corretor (Alta):</b> O corretor que atende 50-100 leads simultaneamente nao consegue fazer follow-up '
    'individual para todos. A automacao garante que nenhum lead seja esquecido, enviando mensagens pre-configuradas em momentos '
    'estrategicos. O corretor pode personalizar os templates de mensagem e definir excecoes (ex.: nao enviar automacao para leads '
    'que ja agendaram visita). O resultado e um aumento significativo na taxa de conversao sem aumento proporcional no esforco.', s_body))

story.append(Paragraph(
    '<b>Perspectiva do Administrador (Alta):</b> O administrador pode criar sequencias padrao para toda a equipe, garantindo '
    'consistencia no atendimento. Pode medir a eficacia de cada sequencia (taxa de resposta, agendamentos gerados, conversoes) '
    'e otimizar continuamente. A automacao de campanhas de reativacao para leads frios pode recuperar oportunidades que '
    'seriam perdidas, impactando diretamente o faturamento.', s_body))

story.append(Paragraph(
    '<b>Perspectiva de Adocao por Grande Imobiliaria (Alta):</b> A automacao de marketing e vendas e um diferencial competitivo '
    'que grandes operadores buscam ativamente. A capacidade de configurar sequencias complexas com gatilhos multi-canal '
    'demonstra sofisticacao tecnologica e reduz a dependencia de ferramentas externas como RD Station.', s_body))

# ── Feature 5 ──
story.append(add_heading('4.5. Lead Scoring e Qualificacao Automatica via IA', s_h2, 1))

story.append(Paragraph(
    '<b>Descricao:</b> Sistema que atribui pontuacao automatica a cada lead com base em comportamento (interacoes com landing pages, '
    'respostas a mensagens, tempo desde o primeiro contato), perfil (regiao, faixa de preco, tipo de imovel) e fonte de origem. '
    'Pode incluir qualificacao automatica via WhatsApp com IA, onde um bot faz as primeiras perguntas antes de encaminhar ao corretor.', s_body))

story.append(Paragraph(
    '<b>Perspectiva do Corretor (Alta):</b> O corretor que recebe 30-50 leads por dia precisa saber quais priorizar. O lead scoring '
    'apresenta os leads mais promissores no topo da lista, com indicadores visuais de prioridade (ex.: estrelas, cores, tags automaticas). '
    'A qualificacao via IA no WhatsApp filtra leads desqualificados automaticamente (ex.: pessoa sem capacidade financeira para o empreendimento), '
    'economizando o tempo do corretor para leads genuinamente interessados.', s_body))

story.append(Paragraph(
    '<b>Perspectiva do Administrador (Alta):</b> O lead scoring permite criar relatorios de qualidade de leads por fonte (ex.: leads do '
    'Meta Ads tem score medio 7.2, enquanto leads do ZAP tem score medio 5.8), orientando decisoes de investimento em marketing. '
    'A taxa de qualificacao automatica e um KPI poderoso que mostra a eficiencia do funil de captacao.', s_body))

story.append(Paragraph(
    '<b>Perspectiva de Adocao por Grande Imobiliaria (Alta):</b> A IA aplicada a qualificacao de leads e uma das tendencias mais '
    'fortes do mercado. Grandes operadores buscam ativamente CRMs com IA nativa para reduzir custos operacionais e aumentar a '
    'eficiencia do funil de vendas. O CRM Pro ja possui integracao com Gemini e Groq, o que facilita a implementacao.', s_body))

# ── Feature 6 ──
story.append(add_heading('4.6. Tabela de Precos Dinamica por Empreendimento', s_h2, 1))

story.append(Paragraph(
    '<b>Descricao:</b> Modulo de gestao de tabelas de precos que permite ao administrador criar, clonar e gerenciar tabelas de '
    'precos por empreendimento, com suporte a series (tabelas por periodo), diferencias (valores adicionais por '
    'caracteristica como andar, vista, varanda), e atualizacao em lote. Os precos ficam vinculados as unidades individuais.', s_body))

story.append(Paragraph(
    '<b>Perspectiva do Corretor (Media):</b> O corretor se beneficia ao consultar precos atualizados diretamente no CRM, sem risco '
    'de trabalhar com tabela desatualizada. A visualizacao de diferencias por andar ou caracteristica permite fazer simulacoes '
    'rapidas para o cliente. No entanto, o corretor tipicamente nao gerencia tabelas, apenas as consulta.', s_body))

story.append(Paragraph(
    '<b>Perspectiva do Administrador (Alta):</b> O administrador tem controle centralizado sobre toda a politica de precos, podendo '
    'criar novas tabelas para promocoes, ajustar diferencias, clonar tabelas para novos empreendimentos e manter historico de '
    'reajustes. A integracao com o espelho de vendas garante que o corretor sempre veja o preco correto.', s_body))

story.append(Paragraph(
    '<b>Perspectiva de Adocao por Grande Imobiliaria (Alta):</b> A gestao de precos e um modulo central para incorporadoras, que '
    'frequentemente reajustam precos e gerenciam multiplas tabelas simultaneas. A capacidade de criar series (tabela de lancamento, '
    'tabela de promocao) e diferencias e considerada essencial.', s_body))

# ── Feature 7 ──
story.append(add_heading('4.7. Hub de Comunicacao Centralizada (WhatsApp Bidirecional)', s_h2, 1))

story.append(Paragraph(
    '<b>Descricao:</b> Interface unificada que concentra todas as conversas com leads e clientes (WhatsApp, Telegram, email) em um '
    'unico lugar dentro do CRM, com historico completo, busca por palavra-chave e capacidade de responder diretamente. '
    'Diferente do modelo atual de notificacoes unidirecionais, o hub permite conversas completas.', s_body))

story.append(Paragraph(
    '<b>Perspectiva do Corretor (Alta):</b> O corretor passa a gerenciar todas as suas conversas com clientes em um unico lugar, '
    'sem precisar alternar entre WhatsApp Web, Telegram e email. O historico completo de conversas fica vinculado ao perfil do '
    'cliente no CRM, permitindo que qualquer corretor da equipe retome uma conversa com contexto total. Isso e especialmente '
    'valioso em equipes com parceiros comerciais que compartilham clientes.', s_body))

story.append(Paragraph(
    '<b>Perspectiva do Administrador (Alta):</b> O administrador pode monitorar a qualidade do atendimento, medir tempos de resposta, '
    'e acessar qualquer conversa para auditoria ou treinamento. A centralizacao tambem permite implementar chatbots para triagem '
    'inicial e encaminhamento automatico, reduzindo a carga sobre a equipe humana.', s_body))

story.append(Paragraph(
    '<b>Perspectiva de Adocao por Grande Imobiliaria (Alta):</b> Grandes operadores precisam de rastreabilidade completa de todas as '
    'interacoes com clientes para fins de conformidade, qualidade e treinamento. A comunicacao centralizada e um requisito para '
    'equipes com mais de 10 corretores e e considerada padrao ouro no mercado.', s_body))

# ── Feature 8 ──
story.append(add_heading('4.8. Gestao de Comissoes e Regras de Premiacao', s_h2, 1))

story.append(Paragraph(
    '<b>Descricao:</b> Modulo para calcular, acompanhar e pagar comissoes de vendas, com suporte a regras personalizaveis (percentuais '
    'por empreendimento, faixa de vendas, cargo do corretor), bonus por meta atingida, pagamento em lote e geracao de boletos. '
    'Inclui mapa de comissoes e relatorios de performance individual.', s_body))

story.append(Paragraph(
    '<b>Perspectiva do Corretor (Alta):</b> O corretor pode acompanhar em tempo real quanto ja ganhou no mes, quais comissoes estao '
    'pendentes de pagamento e quanto falta para bater metas e ganhar premiacoes. A transparencia no calculo de comissoes '
    'aumenta a confianca e a motivacao da equipe.', s_body))

story.append(Paragraph(
    '<b>Perspectiva do Administrador (Critica):</b> O calculo manual de comissoes e uma das maiores dores de grandes imobiliarias, '
    'especialmente quando envolve regras complexas (percentuais diferentes por empreendimento, bonus cumulativos, metas por equipe). '
    'Um modulo de comissoes automatiza esse processo, elimina erros, permite pagamento em lote e gera relatorios que antes exigiam '
    'horas de trabalho em planilhas.', s_body))

story.append(Paragraph(
    '<b>Perspectiva de Adocao por Grande Imobiliaria (Critica):</b> Para imobiliarias com mais de 20 corretores, a gestao de comissoes '
    'e tao critica quanto a gestao de vendas. A ausencia dessa funcionalidade e um bloqueador para adocao por grandes operadores, '
    'pois sem ela o CRM nao cobre o ciclo financeiro completo da operacao.', s_body))

# ── Feature 9 ──
story.append(add_heading('4.9. Aplicativo Mobile Nativo para Corretores', s_h2, 1))

story.append(Paragraph(
    '<b>Descricao:</b> Aplicativo mobile nativo (iOS e Android) que permite ao corretor acessar o CRM em campo, com notificacoes push '
    'instantaneas sobre novos leads, consulta rapida de disponibilidade de unidades, registro de visitas com fotos, acesso ao '
    'historico do cliente e comunicacao via WhatsApp integrada. Funciona offline com sincronizacao posterior.', s_body))

story.append(Paragraph(
    '<b>Perspectiva do Corretor (Alta):</b> O corretor que esta em campo visitando obras ou mostrando imoveis precisa de acesso '
    'rapido a informacoes sem depender de um navegador web. Notificacoes push instantaneas sobre novos leads permitem resposta '
    'imediata (estudos mostram que leads contactados em 5 minutos tem 9x mais chance de conversao). A camera do celular '
    'pode ser usada para registrar documentos e comprovantes diretamente no CRM.', s_body))

story.append(Paragraph(
    '<b>Perspectiva do Administrador (Media-Alta):</b> O app mobile aumenta a produtividade da equipe ao permitir trabalho em campo, '
    'mas adiciona complexidade de manutencao (duas plataformas, atualizacoes de app, lojas de apps). O administrador pode definir '
    'quais funcionalidades estao disponiveis no app e monitorar a atividade da equipe.', s_body))

story.append(Paragraph(
    '<b>Perspectiva de Adocao por Grande Imobiliaria (Alta):</b> Embora a web responsiva atenda parcialmente, grandes operadores '
    'frequentemente exigem um app mobile nativo como parte da solucao. A presenca na tela inicial do smartphone do corretor '
    'e um diferencial de usabilidade que pode influenciar a decisao de compra.', s_body))

# ── Feature 10 ──
story.append(add_heading('4.10. Modulo Pos-Venda: Vistorias e Assistencia Tecnica', s_h2, 1))

story.append(Paragraph(
    '<b>Descricao:</b> Modulo dedicado ao atendimento pos-venda que inclui agendamento de vistorias, registro de defeitos e '
    'solicitacoes de assistencia tecnica, sistema de tickets com acompanhamento de status, pesquisa de satisfacao pos-entrega '
    'e historico completo de interacoes pos-venda vinculado ao perfil do cliente.', s_body))

story.append(Paragraph(
    '<b>Perspectiva do Corretor (Media):</b> O corretor de vendas nao e o principal usuario do pos-venda, mas se beneficia indiretamente '
    'ao poder indicar compradores futuros com base na experiencia positiva de clientes anteriores. A visibilidade de problemas '
    'pos-entrega tambem ajuda o corretor a gerenciar expectativas de novos clientes sobre o empreendimento.', s_body))

story.append(Paragraph(
    '<b>Perspectiva do Administrador (Alta):</b> O administrador pode acompanhar metricas de satisfacao pos-entrega, identificar problemas '
    'recorrentes em empreendimentos, gerenciar a equipe de assistencia tecnica e usar os dados de satisfacao como argumento '
    'de venda. O sistema de tickets garante que nenhuma solicitacao seja esquecida e permite medir tempos de resolucao.', s_body))

story.append(Paragraph(
    '<b>Perspectiva de Adocao por Grande Imobiliaria (Alta):</b> Para incorporadoras, o pos-venda e um diferencial competitivo '
    'importante. A capacidade de gerenciar vistorias e assistencia tecnica dentro do mesmo CRM demonstra cobertura do ciclo '
    'completo do cliente e e valorizada por grandes operadores que buscam reducao de custos com ferramentas fragmentadas.', s_body))

# ── Feature 11 ──
story.append(add_heading('4.11. Gestao de Contratos com Assinatura Eletronica', s_h2, 1))

story.append(Paragraph(
    '<b>Descricao:</b> Modulo de gestao de contratos imobiliarios com integracao de assinatura eletronica, permitindo criar modelos de '
    'contrato, enviar para assinatura, acompanhar o status e armazenar documentos assinados. Pode integrar com provedores como '
    'DocuSign, Clicksign ou implementar solucao propria.', s_body))

story.append(Paragraph(
    '<b>Perspectiva do Corretor (Media):</b> O corretor se beneficia ao poder enviar contratos para assinatura digital diretamente do CRM, '
    'sem necessidade de impressao, assinatura fisica e digitalizacao. O acompanhamento do status da assinatura (enviado, visualizado, '
    'assinado) permite saber quando agir para cobrar a assinatura pendente.', s_body))

story.append(Paragraph(
    '<b>Perspectiva do Administrador (Alta):</b> O administrador pode criar modelos padrao de contrato, definir fluxos de assinatura '
    '(ex.: comprador assina primeiro, depois fiador, depois incorporadora), armazenar todos os contratos de forma centralizada e '
    'gerar relatorios. A reducao de tempo no processo de fechamento impacta diretamente a velocidade de vendas.', s_body))

story.append(Paragraph(
    '<b>Perspectiva de Adocao por Grande Imobiliaria (Alta):</b> A assinatura eletronica integrada e um requisito para incorporadoras '
    'que processam grandes volumes de contratos. A capacidade de assinar digitalmente dentro do CRM elimina a necessidade de '
    'ferramentas externas e reduz o ciclo de vendas.', s_body))

# ── Feature 12 ──
story.append(add_heading('4.12. Conformidade LGPD com Gestao de Consentimento', s_h2, 1))

story.append(Paragraph(
    '<b>Descricao:</b> Modulo de conformidade com a LGPD que inclui registro de consentimento dos leads no momento da captacao, '
    'direito ao esquecimento (exclusao completa de dados), registro de auditoria de acessos, gestao de preferencias de comunicacao '
    '(canais permitidos, frequencia) e relatorio de conformidade para demonstracao a clientes corporativos.', s_body))

story.append(Paragraph(
    '<b>Perspectiva do Corretor (Baixa-Media):</b> O corretor tem pouca interacao direta com o modulo de LGPD, mas se beneficia '
    'indiretamente ao trabalhar em uma plataforma conforme a lei, evitando riscos legais para si e para a imobiliaria. O registro '
    'de consentimento pode ser automatico no formulario de captacao de leads.', s_body))

story.append(Paragraph(
    '<b>Perspectiva do Administrador (Alta):</b> O administrador precisa de ferramentas para garantir conformidade e responder a '
    'solicitacoes de titulares (exclusao de dados, acesso a dados). O modulo de LGPD fornece processos automatizados para essas '
    'solicitacoes e gera relatorios de auditoria que podem ser apresentados em caso de fiscalizacao.', s_body))

story.append(Paragraph(
    '<b>Perspectiva de Adocao por Grande Imobiliaria (Alta):</b> Grandes operadores exigem conformidade com LGPD como requisito '
    'contratual. A capacidade de demonstrar conformidade com relatorios e processos automatizados pode ser decisiva em processos '
    'de seleção de fornecedores.', s_body))

# ═══════════════════════════════════════════════════
# 5. TABELA RESUMO COM PRIORIZACAO
# ═══════════════════════════════════════════════════
story.append(add_heading('5. Tabela Resumo de Priorizacao', s_h1, 0))

story.append(Paragraph(
    'A tabela a seguir consolida todas as funcionalidades recomendadas, com sua classificacao por perspectiva e prioridade '
    'geral de implementacao. A prioridade foi calculada considerando o impacto combinado das tres perspectivas e a complexidade '
    'relativa de implementacao. Funcionalidades marcadas como Criticas sao bloqueadores para adocao por grandes imobiliarias, '
    'enquanto funcionalidades de Alta prioridade representam os maiores diferenciais competitivos.', s_body))

prio_headers = ['Funcionalidade', 'Corretor', 'Admin', 'Adocao', 'Prioridade']
prio_rows = [
    ['Integracao Portais Imobiliarios', 'Alta', 'Alta', 'Critica', 'P0 - Imediata'],
    ['Espelho de Vendas', 'Alta', 'Alta', 'Critica', 'P0 - Imediata'],
    ['Gestao de Reservas', 'Media-Alta', 'Alta', 'Alta', 'P1 - Curto Prazo'],
    ['Automacao de Follow-up', 'Alta', 'Alta', 'Alta', 'P1 - Curto Prazo'],
    ['Lead Scoring com IA', 'Alta', 'Alta', 'Alta', 'P1 - Curto Prazo'],
    ['Tabela de Precos', 'Media', 'Alta', 'Alta', 'P1 - Curto Prazo'],
    ['Hub WhatsApp Bidirecional', 'Alta', 'Alta', 'Alta', 'P2 - Medio Prazo'],
    ['Gestao de Comissoes', 'Alta', 'Critica', 'Critica', 'P2 - Medio Prazo'],
    ['App Mobile Nativo', 'Alta', 'Media-Alta', 'Alta', 'P3 - Longo Prazo'],
    ['Pos-Venda e Vistorias', 'Media', 'Alta', 'Alta', 'P3 - Longo Prazo'],
    ['Assinatura Eletronica', 'Media', 'Alta', 'Alta', 'P3 - Longo Prazo'],
    ['Conformidade LGPD', 'Baixa-Media', 'Alta', 'Alta', 'P2 - Medio Prazo'],
]
story.append(Spacer(1, 8))
story.append(make_table(prio_headers, prio_rows,
    [CONTENT_W*0.28, CONTENT_W*0.14, CONTENT_W*0.14, CONTENT_W*0.14, CONTENT_W*0.30]))
story.append(Paragraph('Tabela 2: Resumo de priorizacao das funcionalidades recomendadas.', s_caption))

# ═══════════════════════════════════════════════════
# 6. ESTRATEGIA DE IMPLEMENTACAO
# ═══════════════════════════════════════════════════
story.append(add_heading('6. Estrategia de Implementacao Sugerida', s_h1, 0))

story.append(add_heading('6.1. Fase 1 - Fundacao Imobiliaria (P0)', s_h2, 1))

story.append(Paragraph(
    'A primeira fase deve focar nas duas funcionalidades que sao bloqueadores absolutos para adocao por grandes imobiliarias: '
    'a integracao com portais imobiliarios e o espelho de vendas. A integracao com portais pode ser implementada de forma incremental, '
    'comecando pelo ZAP Imoveis (maior portal) com geracao de feed XML e recepcao de leads via webhook. O espelho de vendas '
    'pode começar como uma visualizacao 2D por andar/tipo, com posterior evolucao para 3D. Essas duas funcionalidades juntas '
    'transformam o CRM Pro de uma ferramenta de gestao de leads em uma plataforma de vendas imobiliarias.', s_body))

story.append(Paragraph(
    'Estimativa de esforco: 4-6 semanas para integracao basica com portais (feed XML + recepcao de leads + distribuicao), e '
    '3-4 semanas para o espelho de vendas 2D basico. O espelho de vendas requer um modelo de dados de unidades (unidades por '
    'empreendimento com status, preco, tipo, andar) que atualmente nao existe no schema do CRM Pro.', s_body))

story.append(add_heading('6.2. Fase 2 - Automacao e Inteligencia (P1)', s_h2, 1))

story.append(Paragraph(
    'A segunda fase adiciona automatizacao e inteligencia ao processo comercial. A automacao de follow-up pode ser construida '
    'sobre a infraestrutura de notificacoes ja existente (WhatsApp, email, Telegram), adicionando um motor de regras e gatilhos. '
    'O lead scoring com IA pode aproveitar as integracoes ja existentes com Gemini e Groq, criando modelos de pontuacao que '
    'considere o comportamento do lead no CRM, suas interacoes e perfil. A tabela de precos e a gestao de reservas completam '
    'o nucleo transacional, permitindo que o CRM gerencie o ciclo completo de venda, nao apenas a captação e acompanhamento de leads.', s_body))

story.append(Paragraph(
    'Estimativa de esforco: 6-10 semanas para as quatro funcionalidades. A automacao de follow-up (2-3 semanas) e o lead scoring (2-3 semanas) '
    'podem ser desenvolvidos em paralelo. A tabela de precos (1-2 semanas) e a gestao de reservas (3-4 semanas) dependem do modelo '
    'de unidades criado na Fase 1.', s_body))

story.append(add_heading('6.3. Fase 3 - Excelencia Operacional (P2)', s_h2, 1))

story.append(Paragraph(
    'A terceira fase foca em funcionalidades que elevam o CRM ao nivel de grandes operadores. O hub de comunicacao bidirecional '
    'via WhatsApp e a gestao de comissoes sao as mais impactantes. A conformidade LGPD pode ser implementada em paralelo, '
    'adicionando campos de consentimento nos formularios, logs de auditoria e fluxos de exclusao de dados. O hub de WhatsApp '
    'requer a evolucao da integracao atual com Meta Cloud API de canal unidirecional para bidirecional, utilizando a WhatsApp Business API.', s_body))

story.append(add_heading('6.4. Fase 4 - Diferencial Competitivo (P3)', s_h2, 1))

story.append(Paragraph(
    'A quarta fase inclui funcionalidades que consolidam o CRM Pro como solucao completa. O app mobile nativo pode começar como '
    'uma Progressive Web App (PWA) para reduzir custos iniciais, evoluindo para app nativo se a demanda justificar. O modulo '
    'pos-venda e a assinatura eletronica completam a cobertura do ciclo de vida do cliente, desde a captação do lead ate o '
    'atendimento pos-entrega. Essas funcionalidades diferenciam o CRM Pro de solucoes mais simples e o posicionam como '
    'alternativa viavel ao CV CRM para o segmento medio de mercado.', s_body))

# ═══════════════════════════════════════════════════
# 7. VANTAGENS COMPETITIVAS DO CRM PRO
# ═══════════════════════════════════════════════════
story.append(add_heading('7. Vantagens Competitivas Atuais do CRM Pro', s_h1, 0))

story.append(Paragraph(
    'Apesar das lacunas identificadas, o CRM Pro possui vantagens competitivas significativas que devem ser preservadas e '
    'amplificadas. Primeiro, a arquitetura tecnica moderna (Next.js 16, React 19, Prisma 6, Supabase) proporciona desempenho '
    'e escalabilidade superiores a muitos concorrentes que utilizam tecnologias legadas. Segundo, a infraestrutura de IA ja '
    'implementada (Gemini 2.5 Flash, Groq Llama 3.1) com contexto completo do CRM e mais avançada que a maioria dos concorrentes, '
    'posicionando o CRM Pro na vanguarda da IA aplicada ao mercado imobiliario.', s_body))

story.append(Paragraph(
    'Terceiro, o sistema de tracking pixel para landing pages com captura de Web Vitals, scroll depth, heartbeat e eventos '
    'personalizados e uma funcionalidade rara no mercado, geralmente disponivel apenas em ferramentas de marketing separadas. '
    'Quarto, o sistema de notificacoes multi-canal (5 canais simultaneos) com 5 tipos de templates WhatsApp e emails '
    'profissionais via Resend supera o que muitos concorrentes oferecem. Quinto, o portal do cliente com reagendamento '
    'autosservico e sincronizacao com Google Calendar demonstra maturidade na experiencia do cliente.', s_body))

story.append(Paragraph(
    'Sexto, a arquitetura de lead queues com distribuicao round-robin e atribuicao historica e flexivel e bem implementada. '
    'Setimo, a integracao com Meta Lead Ads com verificacao HMAC e diagnostico de 6 passos demonstra robustez tecnica. '
    'Essas vantagens devem ser utilizadas como argumentos de venda e como base para a evolucao das funcionalidades '
    'identificadas neste relatorio.', s_body))

# ═══════════════════════════════════════════════════
# 8. CONCLUSAO
# ═══════════════════════════════════════
story.append(add_heading('8. Consideracoes Finais', s_h1, 0))

story.append(Paragraph(
    'O CRM Pro possui uma base tecnologica solida e funcionalidades de gestao de leads e marketing digital que rivalizam com '
    'solucoes estabelecidas no mercado. No entanto, para competir efetivamente no segmento de imobiliarias de medio e grande porte, '
    'e necessario evoluir alem da gestao de leads e adicionar funcionalidades transacionais (vendas, reservas, comissoes), '
    'operacionais (portais, espelho de vendas, comunicacao bidirecional) e de conformidade (LGPD, assinatura eletronica).', s_body))

story.append(Paragraph(
    'A implementacao da Fase 1 (Portais + Espelho de Vendas) ja posicionaria o CRM Pro como uma alternativa viavel para imobiliarias '
    'de medio porte. A Fase 2 (Automacao + IA + Precos + Reservas) o elevaria ao nivel de concorrentes estabelecidos como Dommus e '
    'Facilita. As Fases 3 e 4 completariam a suite, tornando-o competitivo até com o CV CRM no segmento de incorporadoras de '
    'medio porte. A chave do sucesso esta em executar as fases de forma incremental, validando cada funcionalidade com usuarios '
    'reais antes de avancar para a proxima.', s_body))

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# BUILD PDF
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

doc = TocDocTemplate(
    OUTPUT_PATH,
    pagesize=A4,
    leftMargin=LEFT_MARGIN,
    rightMargin=RIGHT_MARGIN,
    topMargin=TOP_MARGIN,
    bottomMargin=BOTTOM_MARGIN,
    title='Analise de Funcionalidades - CRM Pro vs Mercado',
    author='CRM Pro',
    subject='Analise comparativa de funcionalidades de CRM imobiliario',
)

doc.multiBuild(story)
print(f'PDF gerado: {OUTPUT_PATH}')
