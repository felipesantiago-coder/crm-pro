#!/usr/bin/env python3
"""Audit Report: Landing Pages de Empreendimentos de Alto Padrao vs Melhores Praticas"""

import os, sys, hashlib
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm, mm
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY, TA_RIGHT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, KeepTogether, HRFlowable, Image
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import registerFontFamily
from reportlab.platypus.tableofcontents import TableOfContents

# ── Font Registration ──────────────────────────────────────────
FONT_DIR = '/usr/share/fonts'
pdfmetrics.registerFont(TTFont('NotoSerifSC', f'{FONT_DIR}/truetype/noto-serif-sc/NotoSerifSC-Regular.ttf'))
pdfmetrics.registerFont(TTFont('NotoSerifSC-Bold', f'{FONT_DIR}/truetype/noto-serif-sc/NotoSerifSC-Bold.ttf'))
registerFontFamily('NotoSerifSC', normal='NotoSerifSC', bold='NotoSerifSC-Bold')

pdfmetrics.registerFont(TTFont('Carlito', f'{FONT_DIR}/truetype/english/Carlito-Regular.ttf'))
pdfmetrics.registerFont(TTFont('Carlito-Bold', f'{FONT_DIR}/truetype/english/Carlito-Bold.ttf'))
registerFontFamily('Carlito', normal='Carlito', bold='Carlito-Bold')

# ── Cascade Palette ───────────────────────────────────────────
PAGE_BG       = colors.HexColor('#f5f5f4')
SECTION_BG    = colors.HexColor('#f2f1f0')
CARD_BG       = colors.HexColor('#ebeae8')
TABLE_STRIPE  = colors.HexColor('#ededeb')
HEADER_FILL   = colors.HexColor('#4e4732')
COVER_BLOCK   = colors.HexColor('#746c56')
BORDER        = colors.HexColor('#c5bfac')
ICON          = colors.HexColor('#a48e4b')
ACCENT        = colors.HexColor('#92761f')
ACCENT_2      = colors.HexColor('#3aa0c2')
TEXT_PRIMARY   = colors.HexColor('#151513')
TEXT_MUTED     = colors.HexColor('#7e7c74')
SEM_SUCCESS   = colors.HexColor('#529067')
SEM_WARNING   = colors.HexColor('#8c7443')
SEM_ERROR     = colors.HexColor('#a25b54')
SEM_INFO      = colors.HexColor('#507aa4')

# ── Styles ────────────────────────────────────────────────────
styles = getSampleStyleSheet()

s_h1 = ParagraphStyle('H1', fontName='Carlito-Bold', fontSize=22, leading=28, textColor=HEADER_FILL, spaceAfter=8, spaceBefore=20)
s_h2 = ParagraphStyle('H2', fontName='Carlito-Bold', fontSize=16, leading=22, textColor=HEADER_FILL, spaceAfter=6, spaceBefore=16)
s_h3 = ParagraphStyle('H3', fontName='Carlito-Bold', fontSize=13, leading=18, textColor=ACCENT, spaceAfter=4, spaceBefore=12)
s_body = ParagraphStyle('Body', fontName='Carlito', fontSize=10.5, leading=16, textColor=TEXT_PRIMARY, alignment=TA_JUSTIFY, spaceAfter=6)
s_body_sm = ParagraphStyle('BodySm', fontName='Carlito', fontSize=9.5, leading=14, textColor=TEXT_PRIMARY, alignment=TA_JUSTIFY, spaceAfter=4)
s_bullet = ParagraphStyle('Bullet', fontName='Carlito', fontSize=10.5, leading=16, textColor=TEXT_PRIMARY, leftIndent=20, bulletIndent=8, spaceAfter=4, alignment=TA_JUSTIFY)
s_caption = ParagraphStyle('Caption', fontName='Carlito', fontSize=8.5, leading=12, textColor=TEXT_MUTED, alignment=TA_CENTER, spaceAfter=8)
s_kicker = ParagraphStyle('Kicker', fontName='Carlito', fontSize=9, leading=12, textColor=TEXT_MUTED, spaceAfter=4)

toc_level0 = ParagraphStyle('TOC0', fontName='Carlito-Bold', fontSize=12, leading=20, leftIndent=0, textColor=HEADER_FILL)
toc_level1 = ParagraphStyle('TOC1', fontName='Carlito', fontSize=10.5, leading=18, leftIndent=20, textColor=TEXT_PRIMARY)

# ── TOC Template ──────────────────────────────────────────────
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

# ── Helper functions ──────────────────────────────────────────
def gap_table(items, col_widths, header_text=None):
    """Create a gap analysis table with colored status indicators."""
    data = []
    if header_text:
        data.append([Paragraph(f'<b>{h}</b>', ParagraphStyle('th', fontName='Carlito-Bold', fontSize=9, leading=12, textColor=colors.white, alignment=TA_LEFT)) for h in header_text])
    
    for item in items:
        row = []
        for i, cell in enumerate(item):
            st = ParagraphStyle('cell', fontName='Carlito', fontSize=8.5, leading=12, textColor=TEXT_PRIMARY, alignment=TA_LEFT if i == 0 else TA_CENTER)
            if i == 0:
                st = ParagraphStyle('cell0', fontName='Carlito-Bold', fontSize=9, leading=13, textColor=TEXT_PRIMARY, alignment=TA_LEFT)
            # Color code status column
            if 'Ausente' in str(cell) or 'Nao implementado' in str(cell) or 'Nenhum' in str(cell):
                st = ParagraphStyle('cell_err', fontName='Carlito-Bold', fontSize=8.5, leading=12, textColor=SEM_ERROR, alignment=TA_CENTER)
            elif 'Parcial' in str(cell) or 'Basico' in str(cell):
                st = ParagraphStyle('cell_warn', fontName='Carlito', fontSize=8.5, leading=12, textColor=SEM_WARNING, alignment=TA_CENTER)
            elif 'Presente' in str(cell) or 'Bom' in str(cell) or 'Ok' in str(cell):
                st = ParagraphStyle('cell_ok', fontName='Carlito-Bold', fontSize=8.5, leading=12, textColor=SEM_SUCCESS, alignment=TA_CENTER)
            row.append(Paragraph(str(cell), st))
        data.append(row)
    
    avail_w = A4[0] - 4*cm
    cw = [c * avail_w for c in col_widths]
    
    t = Table(data, colWidths=cw, repeatRows=1)
    style_cmds = [
        ('BACKGROUND', (0, 0), (-1, 0), HEADER_FILL),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Carlito-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 9),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 8),
        ('TOPPADDING', (0, 0), (-1, 0), 8),
        ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 1), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 1), (-1, -1), 6),
    ]
    for i in range(1, len(data)):
        bg = TABLE_STRIPE if i % 2 == 0 else colors.white
        style_cmds.append(('BACKGROUND', (0, i), (-1, i), bg))
    
    t.setStyle(TableStyle(style_cmds))
    return t

# ── Build Document ────────────────────────────────────────────
output_path = '/home/z/my-project/download/auditoria-landing-pages-crm.pdf'
os.makedirs(os.path.dirname(output_path), exist_ok=True)

doc = TocDocTemplate(
    output_path,
    pagesize=A4,
    leftMargin=2*cm, rightMargin=2*cm,
    topMargin=2.2*cm, bottomMargin=2.2*cm,
    title='Auditoria de Landing Pages - CRM Pro',
    author='Z.ai',
    subject='Analise comparativa de landing pages de empreendimentos imobiliarios',
)

story = []

# ── TOC ───────────────────────────────────────────────────────
toc = TableOfContents()
toc.levelStyles = [toc_level0, toc_level1]
story.append(Paragraph('Sumario', s_h1))
story.append(toc)
story.append(PageBreak())

# ═══════════════════════════════════════════════════════════════
# CHAPTER 1: RESUMO EXECUTIVO
# ═══════════════════════════════════════════════════════════════
story.append(add_heading('1. Resumo Executivo', s_h1, 0))

story.append(Paragraph(
    'Este relatorio apresenta uma auditoria completa das landing pages de empreendimentos imobiliarios do CRM Pro, '
    'comparando a implementacao atual com as melhores praticas identificadas em mais de 30 fontes especializadas '
    'em marketing imobiliario de alto padrao. A analise abrange estrutura, design, elementos de conversao, '
    'otimizacao para dispositivos moveis, sinais de confianca, SEO tecnico e experiencia do usuario, '
    'referenciando empresas como Proven Partners, PropRank Digital, Repli, involve.me, MNKY Agency, '
    'Beefree/RGE Studio, KN Digital, Landingi, ProCorretor, entre outras autoridades do setor.',
    s_body
))

story.append(Paragraph(
    'A taxa media de conversao de landing pages imobiliarias no mercado global situa-se entre 2% e 5%, '
    'porem paginas bem otimizadas alcancam consistentemente 10% a 15%, segundo dados da Landingi e da '
    'Linke.ro. O estudo da PropRank Digital (junho de 2026) destaca que, no segmento de luxo, duplicar '
    'a taxa de conversao tem o mesmo impacto comercial que dobrar o trafego, mas a uma fracao do custo. '
    'Isso torna a otimizacao de landing pages o investimento com maior retorno imediato para o funil de vendas.',
    s_body
))

story.append(Paragraph(
    'A auditoria identificou que as landing pages do CRM Pro possuem uma base visual elegante com paleta '
    'escura e acentos em dourado, alem de funcionalidades solidas como galeria com lightbox, formulario '
    'dinamico e integracao com WhatsApp via round-robin. No entanto, a analise revelou <b>24 lacunas significativas</b> '
    'que, se corrigidas, poderiam aumentar substancialmente a taxa de conversao. As criticas mais graves incluem: '
    'ausencia total de sinais de confianca (prova social, credenciais), nenhuma chamada para acao no hero above-the-fold, '
    'falta de elementos de urgencia e escassez, nenhuma otimizacao SEO (SSR/SSG, meta tags dinamicas, JSON-LD), '
    'ausencia de botao flutuante de WhatsApp para mobile, e nenhuma estrategia de retencao (exit-intent, lead magnets).',
    s_body
))

# ═══════════════════════════════════════════════════════════════
# CHAPTER 2: METODOLOGIA
# ═══════════════════════════════════════════════════════════════
story.append(add_heading('2. Metodologia da Pesquisa', s_h1, 0))

story.append(add_heading('2.1 Fontes Pesquisadas', s_h2, 1))
story.append(Paragraph(
    'A pesquisa foi conduzida em junho de 2026, abrangendo buscas em ingles e portugues com termos como '
    '"luxury real estate landing page best practices 2024 2025", "high-converting real estate landing page examples", '
    '"empreendimento imobiliario alto padrao landing page conversao", "real estate landing page hero section CTA", '
    '"luxury property landing page social proof trust signals", "real estate landing page mobile sticky CTA", '
    '"landing page imobiliaria urgencia escassez unidades restantes", "real estate landing page FAQ section pricing", '
    '"real estate landing page exit intent popup lead magnet", entre outros. Foram consultados artigos completos '
    'de 9 fontes principais, alem de snippets de mais de 60 resultados de busca.',
    s_body
))

story.append(Paragraph(
    'As principais fontes analisadas em profundidade incluem: PropRank Digital (CRO para imoveis de luxo, '
    'junho 2026), ProCorretor (melhor tipo de landing page para imoveis de alto padrao, abril 2026), '
    'Beefree/RGE Studio (como construir landing pages imobiliarias que convertem, agosto 2025), '
    'Repli (melhores dicas para landing pages de apartamentos 2025), involve.me (exemplos de landing pages '
    'imobiliarias de alta conversao, maio 2026), KN Digital (7 exemplos de landing pages imobiliarias 2026), '
    'MNKY Agency (guia definitivo de landing pages imobiliarias), Landingi (24 exemplos de landing pages de '
    'imoveis), e Linke.ro (exemplos que convertem com taxas de 10-15%).',
    s_body
))

story.append(add_heading('2.2 Analise do Codigo do CRM', s_h2, 1))
story.append(Paragraph(
    'A auditoria do codigo-fonte abrangeu os seguintes arquivos principais: a landing page individual em '
    'repo-source/src/app/empreendimentos/[slug]/page.tsx (1032 linhas, componente monolitico client-side), '
    'a pagina de sucesso de cadastro, a pagina de listagem de empreendimentos, o layout com metadados OpenGraph, '
    'o pixel de rastreamento (pixel.js, 233 linhas), os endpoints de API publica (public/[slug], public-lead, '
    'public-list, lead-queues/next-user), o middleware de cache, e os componentes de gerenciamento de galeria '
    'e campos de formulario dinamicos. Cada arquivo foi lido integralmente e analisado quanto a estrutura, '
    'acessibilidade, performance e aderencia as melhores praticas.',
    s_body
))

# ═══════════════════════════════════════════════════════════════
# CHAPTER 3: PANORAMA ATUAL DO CRM
# ═══════════════════════════════════════════════════════════════
story.append(add_heading('3. Panorama Atual das Landing Pages do CRM', s_h1, 0))

story.append(add_heading('3.1 Estrutura e Secoes Atuais', s_h2, 1))
story.append(Paragraph(
    'A landing page do CRM e composta por seis secoes principais, todas renderizadas client-side em um unico '
    'componente React de 1032 linhas. A navegacao fixa inclui logo, botao de compartilhar e CTA "Cadastre-se" '
    'que faz scroll suave ate o formulario. O hero ocupa a altura total da viewport com imagem de fundo, '
    'overlay de gradiente duplo, badges de status (Entregue/Em Construcao/Lancamento), preco (extraido por regex), '
    'previsao de entrega e regiao. A galeria possui imagem principal responsiva com aspect-ratio adaptativo, '
    'faixa de thumbnails com scroll horizontal e lightbox fullscreen. A secao de detalhes exibe resumo, '
    'localizacao, construtora, projeto arquitetonico, tipos de unidades e diferenciais, condicionalmente baseada '
    'no cachedInfo extraido por IA. O formulario de cadastro possui campos de nome, telefone (com mascara), '
    'email e campos dinamicos configuraveis por empreendimento. O footer tem tres colunas com marca, navegacao '
    'e contato via WhatsApp.',
    s_body
))

story.append(add_heading('3.2 Pontos Positivos Identificados', s_h2, 1))
story.append(Paragraph(
    'A implementacao atual apresenta diversos pontos fortes que merecem reconhecimento. O design visual é '
    'sofisticado e coerente, com paleta escura (#0A0A0A) e acentos dourados (#C9A96E) que transmitem a ideia '
    'de luxo e exclusividade. A responsividade foi bem implementada com breakpoints sm, md e lg cobrindo '
    'todos os tamanhos de tela. A galeria de imagens possui funcionalidades avancadas como lightbox, navegacao '
    'por thumbnails e contador de imagens. O sistema de formulario dinamico permite personalizar os campos '
    'por empreendimento (text, textarea, select, number, checkbox). A integracao com WhatsApp via fila de '
    'distribuicao round-robin e um diferencial importante que garante atendimento equilibrado entre corretores. '
    'O pixel de rastreamento implementa pageview, scroll depth, heartbeat, UTM parsing e eventos personalizados. '
    'A compressao de imagens via sharp (conversao para WebP, max 1920px, qualidade adaptativa) e pratica e eficiente. '
    'A validacao de formulario e robusta com mascara de telefone e verificacao de campos obrigatorios dinamicos.',
    s_body
))

# ═══════════════════════════════════════════════════════════════
# CHAPTER 4: MELHORES PRATICAS DA INDUSTRIA
# ═══════════════════════════════════════════════════════════════
story.append(add_heading('4. Melhores Praticas Identificadas na Pesquisa', s_h1, 0))

story.append(add_heading('4.1 Hero Section e Above-the-Fold', s_h2, 1))
story.append(Paragraph(
    'Todas as fontes pesquisadas convergem em um ponto critico: o hero section (area visivel sem scroll) e '
    'o momento de maior impacto na landing page. Segundo a LeadFlask, a primeira impressao pode "fazer ou '
    'desfazer" a visita do usuario. O site SaaS Hero Network estabelece uma hierarquia visual obrigatoria: '
    'headline, subheadline e CTA, onde tamanho, peso e espacamento devem guiar a leitura nessa ordem exata. '
    'A SaaSHero relata que CTAs posicionados acima do fold capturam 60% a 90% dos visitantes e impulsionam '
    'conversoes imediatas. O site OptimizePress documenta que 16 exemplos de alta performance usam o hero '
    'para carousel dinamico ou video de fundo. A Repli (2025) recomenda headlines ousados e atencionantes '
    'que comuniquem imediatamente o nome da comunidade e o diferencial, como "Welcome to Oakwood Heights: '
    'Luxury Living in Downtown Atlanta." A Landing Page Flow (2026) classifica CTAs above-the-fold como '
    'estrategia numero um para captura imediata de atencao e conversao rapida.',
    s_body
))

story.append(add_heading('4.2 Prova Social e Sinais de Confianca', s_h2, 1))
story.append(Paragraph(
    'A prova social e consistentemente citada como o fator numero um para superar a "lacuna de credibilidade" '
    'em landing pages imobiliarias. A KN Digital (2026) destaca que paginas de alta conversao "efetivamente '
    'alavancam sinais de confianca" com depoimentos, avaliacoes e badges de credibilidade. A Beefree/RGE '
    'Studio (agosto 2025) afirma que "nao ha nada que construa confianca mais rapido do que ver outros '
    'compradores satisfeitos" e que credibilidade impulsiona conversoes no segmento de luxo. A involve.me '
    'mostra exemplos onde a prova social assume formas de avaliacoes com estrelas, contadores de unidades '
    'vendidas e logotipos de parceiros financeiros. A Adjet Marketing (junho 2026) reforca que "os sinais '
    'de confianca mais eficazes no mercado imobiliario sao locais e especificos" e que "avaliacoes genericas '
    'de cinco estrelas parecem menos crediveis do que um depoimento que menciona o bairro ou o empreendimento." '
    'A PropRank Digital (junho 2026) dedica uma secao inteira a "arquitetura de confianca", incluindo '
    'credenciais da construtora, certificacoes de seguranca e badges de financiamento.',
    s_body
))

story.append(add_heading('4.3 Elementos de Urgencia e Escassez', s_h2, 1))
story.append(Paragraph(
    'Embora a pesquisa em portugues sobre gatilhos mentais especificos para landing pages imobiliarias brasileiras '
    'tenha retornado resultados mais limitados, a literatura internacional e consistente: urgencia e escassez '
    'sao gatilhos validos quando usados com autenticidade. A Repli (2025) recomenda linguagem orientada a acao '
    'que transmita urgencia, como "Lease Now and Save!" ou "Limited Availability - Schedule a Tour Today!". '
    'A involve.me documenta que CTAs com contadores de unidades restantes ou prazos limitados aumentam a '
    'taxa de cliques em 15% a 25% em testes A/B. Para o segmento de luxo, a PropRank Digital adverte que '
    '"gimmicks, pop-ups agressivos e taticas de pressao danificam ativamente a confianca" - o que significa '
    'que esses elementos devem ser elegantemente sutis, como um badge discreto "Apenas 3 unidades disponiveis" '
    'ao lado dos tipos de apartamento, nunca como pop-ups invasivos ou contadores regressivos gritantes.',
    s_body
))

story.append(add_heading('4.4 Otimizacao para Mobile', s_h2, 1))
story.append(Paragraph(
    'A Repli (2025) documenta que mais de 70% dos inquilinos pesquisam imoveis pelo celular, tornando a '
    'otimizacao mobile absolutamente critica. Os requisitos incluem tempos de carregamento rapidos, navegacao '
    'com botoes amigaveis ao toque e formularios sem frustracoes. A Beefree menciona que 97% das buscas '
    'imobiliarias comecam na web, e uma proporcao crescente inicia em dispositivos moveis. A PropRank Digital '
    'destaca que, para imoveis de luxo, "a qualidade do seu site e avaliada como proxy da qualidade do seu '
    'servico" e que "um site lento, confuso ou visualmente inconsistente sinaliza que sua agencia nao opera '
    'no nivel que suas listagens sugerem." O site da ProCorretor (abril 2026) reforca que "a experiencia '
    'mobile precisa ser perfeita, ja que muitos clientes premium pesquisam imoveis pelo celular entre reunioes '
    'ou viagens." Uma pratica especifica mencionada por multiplas fontes e o botao de CTA flutuante (sticky) '
    'no rodape do mobile, que permanece visivel durante todo o scroll e oferece um ponto de conversao permanente.',
    s_body
))

story.append(add_heading('4.5 SEO Tecnico e Performance', s_h2, 1))
story.append(Paragraph(
    'A PropRank Digital dedica secao completa a performance tecnica como "o caminho mais rapido para perder '
    'um comprador", citando que cada segundo acima de 2 segundos de tempo de carregamento reduz a taxa de '
    'conversao em aproximadamente 7%. O estudo da LeadsEstate menciona que a melhoria de uma landing page de '
    '3% para 8% de conversao "e alcancavel para qualquer equipe competente" e efetivamente dobra o volume de '
    'leads a custo zero de trafego adicional. A Beefree destaca que ferramentas de busca como Google dependem '
    'de meta tags, dados estruturados (JSON-LD) e renderizacao server-side para indexar corretamente paginas. '
    'O envolvimento de SEO tecnico inclui: meta tags OpenGraph dinamicas por empreendimento, dados estruturados '
    'JSON-LD para imoveis (schema.org/RealEstateListing), renderizacao server-side (SSR/SSG) para permitir '
    'indexacao, canonical URLs, sitemap XML e Core Web Vitals otimizados (LCP, FID, CLS).',
    s_body
))

story.append(add_heading('4.6 Estrategias de Retencao e Reengajamento', s_h2, 1))
story.append(Paragraph(
    'A Beefree/RGE Studio destaca que landing pages de alto padrao devem oferecer multiplos pontos de conversao, '
    'nao apenas o formulario principal. Isso inclui: download de material exclusivo (brochura PDF, planta baixa), '
    'agendamento de visita, botao de WhatsApp persistente, e popup de exit-intent para visitantes que estao '
    'prestes a sair. A involve.me documenta que formularios com "lead magnets" (materiais de valor em troca do '
    'contato) tem taxas de conversao 2-3x maiores do que formularios simples. O caso de estudo da Beefree sobre '
    'Johari Beach Residences em Zanzibar gerou mais de 2.000 leads de 27 paises, com 77% das vendas de '
    'apartamentos vinculadas diretamente a campanhas de PPC e landing pages, demonstrando o poder de paginas '
    'focadas com multiplas vias de captura de leads.',
    s_body
))

story.append(add_heading('4.7 Formularios e Experiencia de Cadastro', s_h2, 1))
story.append(Paragraph(
    'Todas as fontes convergem: formularios curtos convertem mais. A involve.me declara que "o formulario e '
    'o coracao da sua landing page" e que "geralmente nome, email e telefone sao suficientes. Quanto menos '
    'campos, maior a taxa de conversao." A Repli (2025) recomenda "um ou dois campos-chave" como "Schedule a Tour" '
    'ou "Check Availability." O site da ProCorretor (abril 2026) afirma que o lead de alto padrao "tem pouca '
    'paciencia para preenchimento de longos formularios" e que a experiencia deve transmitir "atendimento '
    'personalizado, demonstrado ja no formulario, poucas perguntas, linguagem formal e cortes." A PropRank '
    'Digital recomenda que, para o segmento de luxo, o formulario deve ser "elegante e centrado no comprador", '
    'evitando abordagens agressivas. A posicao do formulario tambem e critica: multiplas fontes recomendam '
    'que o formulario esteja disponivel em multiplos pontos da pagina (topo e rodape), nao apenas numa secao '
    'especifica que exige scroll.',
    s_body
))

# ═══════════════════════════════════════════════════════════════
# CHAPTER 5: ANALISE DE LACUNAS
# ═══════════════════════════════════════════════════════════════
story.append(add_heading('5. Analise Comparativa de Lacunas', s_h1, 0))

story.append(Paragraph(
    'A tabela abaixo apresenta a analise detalhada das lacunas entre as landing pages do CRM e as melhores '
    'praticas da industria. Cada item e classificado quanto ao estado atual no CRM, impacto na conversao '
    'e complexidade de implementacao, permitindo priorizar as acoes corretivas.',
    s_body
))

story.append(Spacer(1, 8))

# Build the gap analysis table
gap_data = [
    ['CTA no Hero (above-the-fold)', 'Ausente', 'Alto', 'Baixa'],
    ['Prova social / depoimentos', 'Ausente', 'Alto', 'Media'],
    ['Sinais de confianca (CRECI, construtora)', 'Ausente', 'Alto', 'Baixa'],
    ['Contador de urgencia / escassez', 'Ausente', 'Medio', 'Baixa'],
    ['Botao flutuante WhatsApp (mobile)', 'Ausente', 'Alto', 'Baixa'],
    ['Mapa / localizacao interativa', 'Ausente', 'Medio', 'Media'],
    ['FAQ section', 'Ausente', 'Medio', 'Baixa'],
    ['SEO / meta tags dinamicas', 'Ausente', 'Alto', 'Alta'],
    ['SSR / renderizacao server-side', 'Ausente', 'Alto', 'Alta'],
    ['Dados estruturados (JSON-LD)', 'Ausente', 'Medio', 'Media'],
    ['Video / tour virtual 360', 'Ausente', 'Medio', 'Alta'],
    ['Lead magnet (brochura PDF)', 'Ausente', 'Medio', 'Media'],
    ['Exit-intent popup', 'Ausente', 'Medio', 'Media'],
    ['Banner LGPD / consentimento', 'Ausente', 'Baixo', 'Baixa'],
    ['Animacoes scroll-triggered', 'Ausente', 'Baixo', 'Media'],
    ['Botao "voltar ao topo"', 'Ausente', 'Baixo', 'Baixa'],
    ['Plantas / floor plans', 'Ausente', 'Medio', 'Media'],
    ['Tabela de precos estruturada', 'Parcial (regex)', 'Medio', 'Media'],
    ['Galeria com lazy loading', 'Ausente', 'Baixo', 'Baixa'],
    ['Progresso do formulario', 'Ausente', 'Baixo', 'Baixa'],
    ['Acessibilidade (ARIA, skip-nav)', 'Ausente', 'Medio', 'Media'],
    ['Multiplos pontos de formulario', 'Parcial (so rodape)', 'Medio', 'Baixa'],
    ['Integracao Instagram / social', 'Ausente', 'Baixo', 'Alta'],
    ['Personalizacao por UTM', 'Parcial (rastrea)', 'Medio', 'Media'],
]

story.append(gap_table(
    gap_data,
    [0.36, 0.22, 0.17, 0.25],
    ['Elemento / Melhor Pratica', 'Estado no CRM', 'Impacto', 'Complexidade']
))
story.append(Paragraph('Tabela 1: Analise completa de lacunas entre o CRM e as melhores praticas do mercado.', s_caption))

story.append(Spacer(1, 8))

story.append(Paragraph(
    'A analise revela um padrao claro: das 25 lacunas identificadas, 5 sao classificadas como de alto impacto '
    'e baixa complexidade (CTA no hero, sinais de confianca, WhatsApp flutuante, urgencia/escassez, FAQ), '
    'representando oportunidades de "ganho rapido" que poderiam ser implementadas em sprints curtos com '
    'retorno imediato na taxa de conversao. Por outro lado, itens como SSR e SEO tecnico sao de alto impacto '
    'mas alta complexidade, exigindo refatoracao arquitetural significativa.',
    s_body
))

# ═══════════════════════════════════════════════════════════════
# CHAPTER 6: RECOMENDACOES PRIORIZADAS
# ═══════════════════════════════════════════════════════════════
story.append(add_heading('6. Recomendacoes Priorizadas', s_h1, 0))

story.append(add_heading('6.1 Acoes Imediatas (Alto Impacto, Baixa Complexidade)', s_h2, 1))

story.append(add_heading('6.1.1 Adicionar CTA no Hero Section', s_h3, 1))
story.append(Paragraph(
    'A implementacao mais critica e a adicao de um botao de chamada para acao diretamente no hero section, '
    'visivel sem necessidade de scroll. Todas as fontes pesquisadas sao unanimes: o CTA above-the-fold e o '
    'maior preditor de conversao. A SaaSHero documenta que CTAs nessa posicao capturam 60-90% dos visitantes. '
    'A recomendacao e adicionar, ao lado do titulo e subtitulo no hero, dois botoes: um primario dourado '
    '"Agendar Visita" e um secundario "Ver Galeria" (que faz scroll suave para a secao de imagens). O botao '
    'deve ter tamanho generoso (px-8 py-4 no mobile, px-10 py-5 no desktop) com sombra dourada para '
    'destaque. O texto do CTA deve ser orientado a acao e especifico, evitando genericos como "Saiba Mais" '
    'em favor de "Quero Conhecer" ou "Agendar Visita".',
    s_body
))

story.append(add_heading('6.1.2 Botao Flutuante de WhatsApp para Mobile', s_h3, 1))
story.append(Paragraph(
    'O WhatsApp e o canal de comunicacao predominante no mercado imobiliario brasileiro. Atualmente, o '
    'WhatsApp so esta disponivel na secao de formulario e no footer, exigindo que o usuario faca scroll '
    'ate o rodape da pagina para encontrar o botao. A recomendacao e implementar um botao flutuante '
    'persistente no canto inferior direito da tela, visivel durante todo o scroll, com o icone do WhatsApp, '
    'uma pulse animation sutil para atrair atencao, e o nome do corretor atribuido via round-robin. '
    'Multiplas fontes, incluindo a Repli e a ProCorretor, destacam a importancia de multiplas vias de '
    'contato, especialmente em mobile onde o formulario pode ser cansativo de preencher. O botao deve '
    'ter uma tooltip ou badge "Fale agora" para incentivar o clique.',
    s_body
))

story.append(add_heading('6.1.3 Secao de Prova Social e Sinais de Confianca', s_h3, 1))
story.append(Paragraph(
    'A adicao de uma secao de prova social entre os detalhes do empreendimento e o formulario de cadastro '
    'e a recomendacao de maior impacto percebido. A KN Digital (2026) documenta que a prova social "efetivamente '
    'alavancam sinais de confianca" e a Beefree afirma que "credibilidade impulsiona conversoes no segmento de luxo." '
    'A implementacao deve incluir: (a) 2-3 depoimentos de clientes ficticios ou reais com foto, nome e '
    'comentario especifico sobre o atendimento ou o empreendimento; (b) logos de parceiros/financiadoras '
    '(Caixa, Itau, Bradesco, Santander) como badges de credibilidade; (c) CRECI da imobiliaria e/ou do corretor; '
    '(d) contador de "X pessoas ja se cadastraram" ou "X unidades vendidas" para criar urgencia social. '
    'A ProCorretor destaca que depoimentos devem ser "locais e especificos" para o segmento de alto padrao, '
    'enfatizando qualidade sobre quantidade.',
    s_body
))

story.append(add_heading('6.1.4 Elementos de Urgencia e Escassez', s_h3, 1))
story.append(Paragraph(
    'A adicao de indicadores de escassez junto aos tipos de unidades pode aumentar significativamente a '
    'conversao. A recomendacao e adicionar, em cada card de tipo de apartamento, um badge discreto como '
    '"2 unidades restantes" ou "Ultimas disponiveis" quando aplicavel. Alem disso, adicionar um banner '
    'sutil acima do formulario com texto como "Vagas limitadas - Faca sua reserva agora" cria senso de '
    'oportunidade sem ser agressivo. A PropRank Digital adverte que, para luxo, esses elementos devem ser '
    '"elegantes e centrados no comprador", evitando contadores regressivos gritantes ou pop-ups invasivos. '
    'A Repli (2025) recomenda "linguagem orientada a acao que transmita urgencia" de forma autentica.',
    s_body
))

story.append(add_heading('6.1.5 Secao de Perguntas Frequentes (FAQ)', s_h3, 1))
story.append(Paragraph(
    'Uma secao de FAQ antes do formulario reduz objecoes e responde duvidas comuns que poderiam impedir o '
    'cadastro. Perguntas tipicas para empreendimentos de alto padrao incluem: formas de pagamento e '
    'financiamento, prazo de entrega, infraestrutura do condominio, proximidade a servicos essenciais, '
    'politica de cancelamento, e disponibilidade de garagem. A implementacao pode usar um componente '
    'acordeao (expand/collapse) com design glass-morphism para manter a coerencia visual. A Repli documenta '
    'que paginas de alta conversao frequentemente incluem FAQ como estrategia de reducao de friccao, '
    'especialmente para compradores que estao na fase de pesquisa e ainda nao estao prontos para se cadastrar.',
    s_body
))

story.append(add_heading('6.2 Acoes de Medio Prazo (Alto/Medio Impacto, Media Complexidade)', s_h2, 1))

story.append(add_heading('6.2.1 SEO Tecnico e Meta Tags Dinamicas', s_h3, 1))
story.append(Paragraph(
    'A landing page atual e inteiramente client-side (use client), o que significa que os motores de busca '
    'nao conseguem indexar o conteudo de cada empreendimento. O document.title e definido imperativamente via '
    'JavaScript, e nao existem meta tags OpenGraph dinamicas por empreendimento. A correcao requer migrar '
    'a pagina de [slug]/page.tsx para Server Component com generateMetadata() para injetar title, description, '
    'OpenGraph image e dados estruturados JSON-LD (schema.org/RealEstateListing) no head da pagina. '
    'Alem disso, o cachedInfo ja contem dados estruturados que podem ser mapeados para JSON-LD automaticamente, '
    'incluindo endereco, preco, numero de quartos, area e status do imovel. O layout.tsx atual so tem '
    'metadados genericos, sem personalizacao por slug.',
    s_body
))

story.append(add_heading('6.2.2 Mapa Interativo da Localizacao', s_h3, 1))
story.append(Paragraph(
    'A localizacao e um dos tres fatores mais importantes na decisao de compra de imovel, ao lado do preco '
    'e da planta. Atualmente, a localizacao e exibida apenas como texto (endereco, bairro, cidade), sem '
    'nenhuma visualizacao geografica. A recomendacao e incorporar um mapa interativo do Google Maps ou '
    'Mapbox mostrando a localizacao do empreendimento com marcadores de pontos de interesse proximos '
    '(escolas, hospitais, shopping centers, transporte publico, parques). A Repli (2025) inclui a localizacao '
    'como um dos pilares da landing page ideal e a ProCorretor destaca que o cliente de alto padrao valoriza '
    'detalhes sobre a regiao, proximidade de servicos e infraestrutura do entorno. O mapa deve ser responsivo '
    'e ter um modo de visualizacao de rua (Street View) quando disponivel.',
    s_body
))

story.append(add_heading('6.2.3 Lead Magnet e Multiplas Vias de Conversao', s_h3, 1))
story.append(Paragraph(
    'Atualmente a unica via de conversao e o formulario de cadastro. A Beefree recomenda multiplos pontos '
    'de conversao: "Uma landing page de alto padrao deve oferecer multiplos pontos de conversao, nao apenas '
    'o formulario principal." A recomendacao e adicionar: (a) botao de "Baixar Brochura" que solicita apenas '
    'nome e email (menos friccao, maior conversao), usando o campo pdfContent ja existente no modelo de dados; '
    '(b) botao de "Agendar Visita" que leva a um mini-formulario simplificado; (c) popup de exit-intent que '
    'aparece quando o usuario move o mouse para fora da janela, oferecendo o download da brochura. A involve.me '
    'documenta que "formularios com lead magnets tem taxas de conversao 2-3x maiores do que formularios simples."',
    s_body
))

story.append(add_heading('6.3 Acoes de Longo Prazo (Alto Impacto, Alta Complexidade)', s_h2, 1))

story.append(add_heading('6.3.1 Migracao para Server-Side Rendering (SSR/SSG)', s_h3, 1))
story.append(Paragraph(
    'A migracao da landing page de client-side para server-side rendering ou static site generation e a '
    'mudanca arquitetural de maior impacto. Atualmente, toda a pagina e renderizada no cliente, o que '
    'significa: (a) motores de busca veem uma pagina vazia ate que o JavaScript execute; (b) o First '
    'Contentful Paint (FCP) depende de uma chamada API adicional (/api/enterprises/public/slug); (c) nao '
    'ha cache de conteudo no servidor. A migracao para SSG com generateStaticParams() permitiria pre-renderizar '
    'cada landing page no build time, resultando em: HTML completo indexavel, carregamento instantaneo, '
    'CDN caching nativo, e melhoria significativa nos Core Web Vitals. A PropRank Digital documenta que '
    '"cada segundo acima de 2 segundos reduz a conversao em 7%." O cachedInfo e as imagens ja estao '
    'disponiveis no banco de dados, facilitando a geracao estatica.',
    s_body
))

story.append(add_heading('6.3.2 Video e Tour Virtual', s_h3, 1))
story.append(Paragraph(
    'A Repli (2025) destaca que "videos e tours virtuais dao uma experiencia imersiva da propriedade" e que '
    'o hero image ou video banner "deve ser irresistivel, mostrando o espaco mais fotogenico ou um servico '
    'exclusivo." A recomendacao inclui: (a) suporte a video como hero (YouTube/Vimeo embed ou video MP4); '
    '(b) embed de tour virtual 360 (Matterport) na secao de galeria; (c) suporte a video walkthrough na '
    'galeria ao lado das fotos. A implementacao pode comecar com suporte a video no hero e embed de YouTube, '
    'evoluindo para integracao com plataformas de tour virtual como Matterport ou Kuula. O cachedInfo ja '
    'possui campos que poderiam ser estendidos para armazenar URLs de video e tours.',
    s_body
))

# ═══════════════════════════════════════════════════════════════
# CHAPTER 7: ROADMAP DE IMPLEMENTACAO
# ═══════════════════════════════════════════════════════════════
story.append(add_heading('7. Roadmap Sugerido de Implementacao', s_h1, 0))

story.append(Paragraph(
    'Com base na analise de impacto e complexidade, o roadmap abaixo organiza as recomendacoes em tres fases, '
    'priorizando as acoes de maior retorno sobre investimento.',
    s_body
))

roadmap_data = [
    ['Fase 1 (Sprint 1-2)', 'CTA no Hero Section', 'Alto', 'Baixa', '1-2 dias'],
    ['Fase 1 (Sprint 1-2)', 'WhatsApp Flutuante (mobile)', 'Alto', 'Baixa', '0.5 dia'],
    ['Fase 1 (Sprint 1-2)', 'Badges de confianca (CRECI, parceiros)', 'Alto', 'Baixa', '1 dia'],
    ['Fase 1 (Sprint 1-2)', 'Elementos de escassez nas unidades', 'Medio', 'Baixa', '0.5 dia'],
    ['Fase 1 (Sprint 1-2)', 'Secao FAQ (acordeao)', 'Medio', 'Baixa', '1 dia'],
    ['Fase 2 (Sprint 3-5)', 'SEO: meta tags dinamicas + JSON-LD', 'Alto', 'Media', '3-4 dias'],
    ['Fase 2 (Sprint 3-5)', 'Mapa interativo (Google Maps)', 'Medio', 'Media', '2-3 dias'],
    ['Fase 2 (Sprint 3-5)', 'Lead magnet: download brochura', 'Medio', 'Media', '2 dias'],
    ['Fase 2 (Sprint 3-5)', 'Exit-intent popup', 'Medio', 'Media', '1-2 dias'],
    ['Fase 2 (Sprint 3-5)', 'Depoimentos / prova social', 'Alto', 'Media', '2-3 dias'],
    ['Fase 3 (Sprint 6-10)', 'Migracao SSR/SSG', 'Alto', 'Alta', '5-7 dias'],
    ['Fase 3 (Sprint 6-10)', 'Video hero + tour virtual', 'Medio', 'Alta', '4-5 dias'],
    ['Fase 3 (Sprint 6-10)', 'Acessibilidade completa (ARIA)', 'Medio', 'Media', '3-4 dias'],
    ['Fase 3 (Sprint 6-10)', 'Animacoes scroll-triggered', 'Baixo', 'Media', '2-3 dias'],
    ['Fase 3 (Sprint 6-10)', 'Integracao Instagram / social feed', 'Baixo', 'Alta', '3-4 dias'],
]

story.append(Spacer(1, 6))
story.append(gap_table(
    roadmap_data,
    [0.16, 0.32, 0.14, 0.16, 0.22],
    ['Fase', 'Acao', 'Impacto', 'Complexidade', 'Estimativa']
))
story.append(Paragraph('Tabela 2: Roadmap de implementacao priorizado por fase, impacto e complexidade.', s_caption))

story.append(Spacer(1, 8))
story.append(Paragraph(
    'A Fase 1 concentra todas as acoes de alto impacto e baixa complexidade, totalizando aproximadamente '
    '5 dias de desenvolvimento. Se implementadas juntas, essas mudancas tem o potencial de aumentar a taxa '
    'de conversao em 50-100% com base nos benchmarks da industria (de 2-5% para 5-10%), conforme documentado '
    'pela Landingi e Linke.ro. A Fase 2 adiciona camadas de sofisticacao (SEO, mapa, lead magnets, prova social) '
    'que podem elevar a conversao para 10-15%. A Fase 3 aborda a infraestrutura tecnica (SSR, video, acessibilidade) '
    'que sustenta o crescimento a longo prazo e melhora a indexacao organica.',
    s_body
))

# ═══════════════════════════════════════════════════════════════
# CHAPTER 8: CONCLUSAO
# ═══════════════════════════════════════════════════════════════
story.append(add_heading('8. Conclusao', s_h1, 0))

story.append(Paragraph(
    'As landing pages do CRM Pro possuem uma base visual e funcional solida, com design sofisticado, galeria '
    'de imagens completa, formulario dinamico e integracao com WhatsApp. No entanto, a analise comparativa com '
    'mais de 30 fontes especializadas revelou 24 lacunas significativas que impedem a pagina de atingir seu '
    'potencial maximo de conversao. As cinco lacunas mais criticas - ausencia de CTA no hero, falta de prova '
    'social e sinais de confianca, inexistencia de WhatsApp flutuante para mobile, nenhuma estrategia de '
    'urgencia e escassez, e ausencia de FAQ - sao todas de baixa complexidade tecnica e podem ser resolvidas '
    'em 1-2 sprints com impacto imediato mensuravel.',
    s_body
))

story.append(Paragraph(
    'A pesquisa da PropRank Digital sintetiza bem a situacao: "A maioria dos sites imobiliarios, mesmo os '
    'bem projetados, deixa potencial significativo de conversao na mesa atraves de friccao nos lugares errados, '
    'sinais de confianca ausentes e chamadas para acao que falham em inspirar uma resposta de audiencias '
    'exigentes e criteriosas." O CRM Pro esta posicionado para fechar essa lacuna com investimentos focados '
    'nas recomendacoes priorizadas deste relatorio, potencialmente dobrando ou triplicando a taxa de conversao '
    'das landing pages de empreendimentos sem necessidade de aumentar o investimento em trafego pago.',
    s_body
))

story.append(Paragraph(
    'Os benchmarks do mercado sao claros: a taxa media do setor e de 2-5%, paginas otimizadas alcancam 10-15%, '
    'e casos de estudo como o Johari Beach Residences (77% das vendas vinculadas a landing pages) demonstram '
    'que a diferenca entre uma landing page mediana e uma excepcional pode ser medida diretamente em receita. '
    'A implementacao das recomendacoes deste relatorio, especialmente a Fase 1, representa o caminho mais '
    'eficiente para fechar a distancia entre o estado atual do CRM e as melhores praticas do mercado.',
    s_body
))

# ── Build ──────────────────────────────────────────────────────
doc.multiBuild(story)
print(f'PDF gerado com sucesso: {output_path}')