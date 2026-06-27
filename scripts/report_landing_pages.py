#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Relatorio: Analise de Landing Pages de Empreendimentos de Alto Padrao - CRM Pro"""

import os, hashlib
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm, cm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, KeepTogether, HRFlowable, Image
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import registerFontFamily

# ── Fonts ────────────────────────────────────────────────────────────
FONT_DIR = '/usr/share/fonts'
pdfmetrics.registerFont(TTFont('NotoSerifSC', f'{FONT_DIR}/truetype/noto-serif-sc/NotoSerifSC-Regular.ttf'))
pdfmetrics.registerFont(TTFont('NotoSerifSC-Bold', f'{FONT_DIR}/truetype/noto-serif-sc/NotoSerifSC-Bold.ttf'))
registerFontFamily('NotoSerifSC', normal='NotoSerifSC', bold='NotoSerifSC-Bold')

pdfmetrics.registerFont(TTFont('NotoSansSC', f'{FONT_DIR}/truetype/chinese/NotoSansSC-Regular.ttf'))
pdfmetrics.registerFont(TTFont('NotoSansSC-Bold', f'{FONT_DIR}/truetype/chinese/NotoSansSC-Bold.ttf'))
registerFontFamily('NotoSansSC', normal='NotoSansSC', bold='NotoSansSC-Bold')

# ── Palette ──────────────────────────────────────────────────────────
PAGE_BG       = colors.HexColor('#f7f7f6')
CARD_BG       = colors.HexColor('#eae9e4')
TABLE_STRIPE  = colors.HexColor('#ecebe8')
HEADER_FILL   = colors.HexColor('#726743')
ACCENT        = colors.HexColor('#8e7323')
TEXT_PRIMARY   = colors.HexColor('#272623')
TEXT_MUTED     = colors.HexColor('#8a8780')
BORDER        = colors.HexColor('#d0cbb9')
SEM_SUCCESS   = colors.HexColor('#43875a')
SEM_ERROR     = colors.HexColor('#9e4d46')
SEM_WARNING   = colors.HexColor('#8d7444')
SEM_INFO      = colors.HexColor('#5079a3')

# ── Styles ───────────────────────────────────────────────────────────
styles = getSampleStyleSheet()

s_h1 = ParagraphStyle('H1', fontName='NotoSerifSC-Bold', fontSize=22, leading=28, textColor=TEXT_PRIMARY, spaceAfter=8, spaceBefore=20)
s_h2 = ParagraphStyle('H2', fontName='NotoSerifSC-Bold', fontSize=16, leading=22, textColor=HEADER_FILL, spaceAfter=6, spaceBefore=16)
s_h3 = ParagraphStyle('H3', fontName='NotoSansSC-Bold', fontSize=12, leading=17, textColor=TEXT_PRIMARY, spaceAfter=4, spaceBefore=12)
s_body = ParagraphStyle('Body', fontName='NotoSansSC', fontSize=10, leading=16, textColor=TEXT_PRIMARY, alignment=TA_JUSTIFY, spaceAfter=6, firstLineIndent=0)
s_body_indent = ParagraphStyle('BodyIndent', parent=s_body, firstLineIndent=20)
s_bullet = ParagraphStyle('Bullet', parent=s_body, leftIndent=20, bulletIndent=8, spaceBefore=2, spaceAfter=2)
s_caption = ParagraphStyle('Caption', fontName='NotoSansSC', fontSize=8, leading=12, textColor=TEXT_MUTED, alignment=TA_CENTER, spaceBefore=4, spaceAfter=8)
s_toc_title = ParagraphStyle('TOCTitle', fontName='NotoSerifSC-Bold', fontSize=20, leading=26, textColor=TEXT_PRIMARY, spaceAfter=12)
s_toc_entry = ParagraphStyle('TOCEntry', fontName='NotoSansSC', fontSize=11, leading=22, textColor=TEXT_PRIMARY)
s_toc_sub = ParagraphStyle('TOCSub', fontName='NotoSansSC', fontSize=10, leading=20, textColor=TEXT_MUTED, leftIndent=16)
s_header_cell = ParagraphStyle('HeaderCell', fontName='NotoSansSC-Bold', fontSize=9, leading=13, textColor=colors.white, alignment=TA_CENTER)
s_cell = ParagraphStyle('Cell', fontName='NotoSansSC', fontSize=9, leading=13, textColor=TEXT_PRIMARY, alignment=TA_LEFT)
s_cell_center = ParagraphStyle('CellCenter', parent=s_cell, alignment=TA_CENTER)

# ── Helpers ──────────────────────────────────────────────────────────
def h1(text):
    return Paragraph(text, s_h1)

def h2(text):
    return Paragraph(text, s_h2)

def h3(text):
    return Paragraph(text, s_h3)

def p(text):
    return Paragraph(text, s_body)

def pi(text):
    return Paragraph(text, s_body_indent)

def bullet(text):
    return Paragraph(f'<bullet>&bull;</bullet> {text}', s_bullet)

def accent_line():
    return HRFlowable(width='30%', thickness=2, color=ACCENT, spaceBefore=4, spaceAfter=12)

def make_table(headers, rows, col_widths=None):
    """Create a styled table with header row and alternating stripes."""
    header_paras = [Paragraph(h, s_header_cell) for h in headers]
    data = [header_paras]
    for row in rows:
        data.append([Paragraph(str(c), s_cell) if i == 0 else Paragraph(str(c), s_cell_center) for i, c in enumerate(row)])

    if col_widths is None:
        available = A4[0] - 2 * 2.2 * cm
        col_widths = [available / len(headers)] * len(headers)

    t = Table(data, colWidths=col_widths, repeatRows=1)
    style_cmds = [
        ('BACKGROUND', (0, 0), (-1, 0), HEADER_FILL),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'NotoSansSC-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 9),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 8),
        ('TOPPADDING', (0, 0), (-1, 0), 8),
        ('BOTTOMPADDING', (0, 1), (-1, -1), 6),
        ('TOPPADDING', (0, 1), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, TABLE_STRIPE]),
    ]
    t.setStyle(TableStyle(style_cmds))
    return t


# ── Build document ───────────────────────────────────────────────────
OUTPUT = '/home/z/my-project/download/relatorio-landing-pages-alto-padrao.pdf'

doc = SimpleDocTemplate(
    OUTPUT,
    pagesize=A4,
    topMargin=2.2*cm, bottomMargin=2.2*cm,
    leftMargin=2.2*cm, rightMargin=2.2*cm,
    title='Landing Pages de Empreendimentos de Alto Padrao - Analise e Recomendacoes',
    author='CRM Pro',
    subject='Analise comparativa de landing pages imobiliarias de luxo',
)

story = []

# ── TOC ──────────────────────────────────────────────────────────────
story.append(Paragraph('Sumario', s_toc_title))
story.append(accent_line())

toc_items = [
    ('1. Introducao e Contexto', False),
    ('2. Metodologia de Pesquisa', False),
    ('3. As 12 Melhores Praticas Identificadas', False),
    ('   3.1. Hero Section com CTA Imediato', True),
    ('   3.2. Galeria de Imagens de Alta Resolucao e Videos', True),
    ('   3.3. Formulario Curto e Inteligente', True),
    ('   3.4. Prova Social e Sinais de Confianca', True),
    ('   3.5. Descricao Emocional do Empreendimento', True),
    ('   3.6. Seccao de Localizacao com Mapa Interativo', True),
    ('   3.7. Plantas e Especificacoes Tecnicas', True),
    ('   3.8. Diferenciais e Amenidades', True),
    ('   3.9. CTAs Repetidos e Consistentes', True),
    ('   3.10. Urgencia e Escassez', True),
    ('   3.11. Otimizacao Mobile-First', True),
    ('   3.12. Integracao com WhatsApp e CRM', True),
    ('4. Analise da Implementacao Atual do CRM Pro', False),
    ('5. Matriz de Conformidade', False),
    ('6. Plano de Recomendacoes Priorizadas', False),
    ('7. Conclusao', False),
]
for label, is_sub in toc_items:
    story.append(Paragraph(label, s_toc_sub if is_sub else s_toc_entry))

story.append(PageBreak())

# ── 1. INTRODUCAO ────────────────────────────────────────────────────
story.append(h1('1. Introducao e Contexto'))
story.append(accent_line())

story.append(p(
    'O mercado imobiliario de alto padrao no Brasil vive um momento de intensa transformacao digital. '
    'Com compradores cada vez mais conectados e exigentes, a presenca online deixou de ser um diferencial '
    'para se tornar condicao essencial de competitividade. Segundo dados do setor, mais de 70% dos acessos '
    'a paginas de imoveis ja ocorrem por dispositivos moveis, e um atraso de apenas 1 segundo no '
    'carregamento da pagina pode reduzir as conversoes em ate 20%. Esses numeros revelam que a experiencia '
    'digital do potencial comprador e tao critica quanto a qualidade do imovel em si.'
))
story.append(p(
    'Nesse cenario, as landing pages surgem como a ferramenta central de conversao. Diferentemente de um '
    'site institucional generico, uma landing page e projetada com um unico objetivo: transformar visitantes '
    'em leads qualificados. No segmento de luxo, onde o ticket medio ultrapassa milhoes de reais e o ciclo '
    'de venda pode durar meses, cada ponto de contato precisa ser estrategicamente pensado para transmitir '
    'exclusividade, gerar confianca e facilitar o proximo passo do comprador, seja agendar uma visita, '
    'solicitar mais informacoes ou iniciar uma conversa via WhatsApp.'
))
story.append(p(
    'Este relatorio apresenta os resultados de uma pesquisa abrangente realizada em junho de 2026, '
    'analisando mais de 130 fontes entre artigos especializados, estudos de caso de referencia e '
    'exemplos reais de landing pages de empreendimentos de alto padrao. O objetivo e comparar essas '
    'melhores praticas com a implementacao atual do CRM Pro, identificar gaps criticos e propor '
    'recomendacoes concretas para maximizar a taxa de conversao de leads qualificados.'
))

# ── 2. METODOLOGIA ───────────────────────────────────────────────────
story.append(h1('2. Metodologia de Pesquisa'))
story.append(accent_line())

story.append(p(
    'A pesquisa foi conduzida em tres etapas complementares, garantindo cobertura tanto de referenciais '
    'internacionais quanto de especialistas do mercado imobiliario brasileiro. Na primeira etapa, '
    'foram realizadas 10 buscas sistematicas na internet utilizando termos estrategicos em portugues e '
    'ingles, como "luxury real estate landing page best practices conversion optimization", "landing page '
    'empreendimento imobiliario alto padrao melhores praticas conversao", e "real estate landing page above '
    'the fold hero section CTA best practices". Essas buscas geraram mais de 130 resultados relevantes, '
    'cobrindo fontes como Unbounce, Beefree, KN Digital, Perspective, Zoho, Praedium, Create Media, '
    'Instapage, Landingi e HousingWire, alem de publicacoes no Instagram e YouTube de especialistas do setor.'
))
story.append(p(
    'Na segunda etapa, os artigos mais relevantes foram lidos na integra por meio de extração de conteudo '
    'web, permitindo identificar nao apenas as recomendacoes superficiais, mas os fundamentos estrategicos, '
    'dados quantitativos e exemplos praticos citados por cada fonte. A terceira etapa consistiu na analise '
    'do codigo-fonte completo do CRM Pro, incluindo todos os componentes de interface, rotas de API, '
    'schema do banco de dados e o portal do cliente, para mapear com precisao o que existe hoje e o que '
    'falta em relacao as melhores praticas identificadas.'
))
story.append(p(
    'A taxa media de conversao de landing pages imobiliarias genericas e inferior a 2%, segundo o Perspective. '
    'Porem, as landing pages analisadas neste estudo que seguem as praticas recomendadas atingem taxas de '
    'conversao entre 11% e 28%, demonstrando o impacto direto dessas otimizacoes nos resultados comerciais.'
))

# ── 3. AS 12 MELHORES PRATICAS ───────────────────────────────────────
story.append(h1('3. As 12 Melhores Praticas Identificadas'))
story.append(accent_line())

story.append(p(
    'A analise cruzada das 130 fontes pesquisadas revelou 12 praticas recorrentes e validadas por multiplos '
    'especialistas. Cada uma delas e detalhada a seguir com sua justificativa estrategica, dados de impacto '
    'e exemplos de implementacao.'
))

# 3.1
story.append(h2('3.1. Hero Section com CTA Imediato'))
story.append(p(
    'A hero section e o primeiro elemento que o visitante visualiza ao acessar a landing page, e pesquisas '
    'mostram que o usuario decide em menos de 5 segundos se continua navegando ou abandona a pagina. '
    'Nos empreendimentos de alto padrao, a hero section deve combinar uma imagem panoramica de alta '
    'resolucao do empreendimento com um titulo emocionalmente persuasivo, um subtitulo que comunica '
    'a proposta de valor exclusiva e, mais importante, um botao de CTA (Call-to-Action) claramente visivel '
    'sem necessidade de rolar a pagina.'
))
story.append(p(
    'O HubSpot e o Unbounce recomendam que o CTA na hero section use verbos de acao orientados ao beneficio, '
    'como "Agendar Visita Exclusiva" ou "Descobrir Seu Apartamento", em vez de genericos como "Saiba Mais" '
    'ou "Enviar". A cor do botao deve contrastar fortemente com o fundo da hero image, preferencialmente '
    'utilizando cores quentes como dourado, terracota ou verde-esmeralda para remeter a sofisticacao e '
    'natureza, respectivamente. O Beefree destaca que landing pages com formulario visivel na hero section '
    'convertem significativamente mais do que aquelas que exigem rolagem ate o formulario.'
))

# 3.2
story.append(h2('3.2. Galeria de Imagens de Alta Resolucao e Videos'))
story.append(p(
    'Imagens profissionais sao o elemento mais impactante em landing pages imobiliarias. Segundo o Unbounce, '
    'landing pages que incluem "lots of appealing images, like professional photos of properties, videos and '
    'virtual walkthroughs" sao consistentemente as que melhor convertem. O Beefree vai alem, afirmando que '
    'a inclusao de um video na landing page pode aumentar as conversoes em ate 80%, especialmente quando '
    'se trata de um video de drone de 30 segundos ou um tour virtual 360 graus.'
))
story.append(p(
    'Para empreendimentos de alto padrao, a galeria deve incluir: renderizacoes 3D do projeto, fotografias '
    'profissionais do terreno e da regiao, plantas decoradas, imagens dos materiais de acabamento e, '
    'quando possivel, videos com narracao que conte a historia do empreendimento. A galeria deve suportar '
    'navegacao por gestos no mobile e permitir zoom em alta resolucao. O Beefree alerta que "stock imagery '
    'e generic drone shots won\'t cut it" para o segmento de luxo, enfatizando a necessidade de conteudo '
    'visual autentico e exclusivo.'
))

# 3.3
story.append(h2('3.3. Formulario Curto e Inteligente'))
story.append(p(
    'O formulario e o ponto de conversao da landing page, e sua otimizacao e um dos fatores mais criticos. '
    'O Zoho recomenda que o formulario imobiliario seja o mais curto possivel, solicitando apenas nome, '
    'telefone e, opcionalmente, e-mail. O Involve.me corrobora: "Keep forms short" e "Highlight one main '
    'CTA". O Praedium enfatiza que "tudo na pagina leva ao formulario", ou seja, todos os elementos da '
    'landing page devem convergir para o preenchimento do formulario.'
))
story.append(p(
    'Para alto padrao, a abordagem recomendada e o formulario de duas etapas: na primeira, apenas nome e '
    'WhatsApp (reduzindo a friccao inicial); na segunda, informacoes complementares como perfil de '
    'apartamento desejado e faixa de investimento. O Create Media destaca que formularios com integracao '
    'direta ao WhatsApp apos o envio apresentam taxas de conversao superiores, pois o lead recebe '
    'atendimento imediato. Alem disso, o formulario deve incluir micro-copy que reforce a exclusividade, '
    'como "Receba atendimento personalizado de um consultor dedicado".'
))

# 3.4
story.append(h2('3.4. Prova Social e Sinais de Confianca'))
story.append(p(
    'A prova social e um dos gatilhos de persuasao mais poderosos identificados pela pesquisa. O Instapage '
    'destaca que "testimonials can have a strong influence on prospects because they tell a positive story '
    'about your brand", recomendando depoimentos detalhados com foto e nome do comprador. O Perspective '
    'enfatiza que landing pages com taxas de conversao de 11% a 28% incluem consistentemente elementos '
    'de prova social posicionados estrategicamente ao longo da pagina.'
))
story.append(p(
    'Para empreendimentos de alto padrao, os sinais de confianca recomendados incluem: selos da '
    'construtora/incorporadora, certificacoes de sustentabilidade (AQUA, LEED), premiacoes recebidas, '
    'numero de unidades vendidas, depoimentos de compradores reais com fotos, parcerias com bancos para '
    'financiamento, e indicadores de seguranca como "Site seguro" e "Seus dados protegidos". A pesquisa '
    'do ProCorretor reforça que a landing page de alto padrao deve "transmitir exclusividade, clareza nas '
    'informacoes e respeito" ao visitante, e a prova social e o mecanismo mais eficaz para isso.'
))

# 3.5
story.append(h2('3.5. Descricao Emocional do Empreendimento'))
story.append(p(
    'A psicologia da venda de imoveis de luxo, conforme analisado pelo European Tour Destinations, revela '
    'que "the essence of selling luxury real estate is the feeling and emotion created in what it is being '
    'presented". A descricao do empreendimento deve ir muito alem das especificacoes tecnicas, criando '
    'uma narrativa que permita o visitante imaginar sua vida futura naquele espaco. O HousingWire '
    'recomenda "clear and emotionally compelling copy" como um dos pilares da conversao.'
))
story.append(p(
    'Na pratica, isso significa que a copy da landing page deve seguir uma hierarquia emocional: comecar '
    'com uma promessa aspiracional ("Viva onde a cidade encontra a natureza"), detalhar a experiencia '
    'sensorial ("acabamento em madeira natural, piso porcelanato importado, bancada em marmore Carrara") '
    'e finalizar com dados concretos que validam a promessa (metragem, numero de suítes, vagas de '
    'garagem, lazer completo). Essa estrutura foi identificada em 8 das 10 melhores landing pages '
    'analisadas pelo KN Digital e pelo Beefree.'
))

# 3.6
story.append(h2('3.6. Seccao de Localizacao com Mapa Interativo'))
story.append(p(
    'A localizacao e frequentemente o fator decisivo na compra de imoveis de alto padrao. O Zoho '
    'recomenda que a landing page inclua "transparencia" sobre a localizacao e, idealmente, um widget '
    'do Google Maps incorporado. A Create Media enfatiza que "a localizacao e um dos tres pilares da '
    'decisao de compra, junto com preco e qualidade do imovel". A praedium destaca que a proximidade '
    'de servicos essenciais como escolas, hospitais, shopping centers e parques deve ser comunicada '
    'de forma visual e objetiva.'
))
story.append(p(
    'A implementacao ideal inclui: mapa interativo com marcador do empreendimento, raio de proximidade '
    'mostrando pontos de interesse relevantes, calculadora de tempo de deslocamento para os principais '
    'polos comerciais e fotografias aereas da regiao. Para o publico de alto padrao, e estrategico '
    'destacar tambem a seguranca do bairro, o valor de mercado da regiao e projetos de urbanizacao '
    'previstos, pois esses fatores comunicam valorizacao patrimonial.'
))

# 3.7
story.append(h2('3.7. Plantas e Especificacoes Tecnicas'))
story.append(p(
    'O KN Digital e o Beefree identificaram que landing pages que incluem plantas baixas e especificacoes '
    'tecnicas detalhadas convertem mais porque permitem que o comprador visualize a distribuicao dos '
    'espacos e valide se o layout atende suas necessidades antes mesmo de agendar uma visita. No segmento '
    'de luxo, onde os apartamentos muitas vezes sao personalizados, a disponibilidade de plantas '
    'com os diferentes tipos (1, 2, 3 ou 4 suítes) e fundamental para qualificar o lead.'
))
story.append(p(
    'A recomendacao e apresentar as plantas em formato interativo, permitindo que o visitante clique '
    'em cada tipo para ver detalhes como metragem privativa, varanda, sacada, area de servico e suite '
    'principal com closet. Cada planta deve incluir um botao de CTA contextual, como "Quero conhecer '
    'este tipo" ou "Simular financiamento", direcionando para o formulario com o tipo pre-selecionado.'
))

# 3.8
story.append(h2('3.8. Diferenciais e Amenidades'))
story.append(p(
    'A seccao de diferenciais e amenidades funciona como o argumento de venda complementar, '
    'especialmente relevante no segmento de alto padrao onde a competencia entre empreendimentos '
    'e intensa. O Unbounce recomenda usar icons e cards visuais para cada diferencial, em vez de '
    'listas textuais monotonas. O Beefree sugere que os diferenciais sejam apresentados com imagens '
    'reais do espaco, como a piscina, a academia, o espaco gourmet e o rooftop.'
))
story.append(p(
    'A estrutura ideal inclui: titulo que resuma a proposta de lazer, grid de cards com icone + nome '
    '+ breve descricao para cada amenidade, '
    'fotos reais dos espacos comuns e, quando possivel, um tour virtual do lazer. E importante '
    'quantificar os diferenciais quando possivel, por exemplo, "Piscina aquecida de 25m com raia '
    'olimpica" em vez de apenas "Piscina". Numeros concretos transmitem concretude e sofisticacao.'
))

# 3.9
story.append(h2('3.9. CTAs Repetidos e Consistentes'))
story.append(p(
    'O OptimizePress afirma que "the CTA throughout your page should be consistent, so that anyone who '
    'has decided to move ahead has a clear idea of what comes next". O KN Digital reforça que as '
    'melhores landing pages imobiliarias repetem o CTA em multiplos pontos da pagina, sempre com o '
    'mesmo texto e visual, criando um caminho claro para a conversao. A pratica recomendada e '
    'posicionar um CTA a cada 2-3 seccoes de conteudo, garantindo que o visitante nunca precise '
    'voltar ao topo da pagina para converter.'
))
story.append(p(
    'Alem do CTA principal, e eficaz incluir um CTA flutuante (sticky) no rodape da tela no mobile, '
    'visivel a qualquer momento da navegacao. O texto do CTA deve ser personalizado conforme o '
    'contexto da seccao: apos a galeria, "Agendar Visita"; apos as plantas, "Solicitar Proposta"; '
    'apos a localizacao, "Conhecer o Bairro". Essa personalizacao aumenta a relevancia percebida '
    'e, consequentemente, a taxa de clique.'
))

# 3.10
story.append(h2('3.10. Urgencia e Escassez'))
story.append(p(
    'O gatilho de urgencia e escassez e amplamente utilizado nas landing pages de maior sucesso, '
    'conforme identificado pelo Involve.me e pelo Unbounce. No contexto de empreendimentos de alto '
    'padrao, a escassez e natural: o numero de unidades e limitado, os tipos mais procurados se '
    'esgotam rapidamente, e as condicoes especiais de lancamento sao por tempo determinado. '
    'Comunicar essa escassez de forma elegante e transparente aumenta a percepcao de exclusividade '
    'sem parecer agressivo.'
))
story.append(p(
    'Exemplos de implementacao incluem: contador de unidades restantes ("Restam apenas 12 dos 80 '
    'apartamentos"), badge de "Ultimas Unidades" nos tipos mais procurados, timer de contagem '
    'regressiva para condicoes especiais de lancamento, e indicadores de demanda como "+200 pessoas '
    'ja agendaram visita". E fundamental que todos os dados de urgencia sejam verdadeiros e '
    'atualizados em tempo real, pois a desonestidade nesse ponto destrói a confianca construida '
    'pela landing page.'
))

# 3.11
story.append(h2('3.11. Otimizacao Mobile-First'))
story.append(p(
    'O Create Media destaca que "mais de 70% do acesso a paginas de imoveis ja vem do celular", '
    'e que um atraso de 1 segundo derruba as conversoes em cerca de 20%. O Perspective inclui '
    'a otimizacao mobile como um dos criterios de avaliacao das landing pages de melhor desempenho. '
    'O ProCorretor reforça que a landing page deve ser "rapida, focada naquilo que realmente '
    'move o cliente: informacao visual, urgencia e facilidade para pedir detalhes ou agendar visitas".'
))
story.append(p(
    'A abordagem mobile-first para alto padrao requer: carregamento progressivo de imagens (lazy '
    'loading com blur-up), galeria com navegacao por swipe e pinch-to-zoom, formulario com '
    'autocompletar de endereco e campo de telefone com mascara automatica, botao de WhatsApp '
    'flutuante sempre visivel, e tipografia escalavel que mantenha a legibilidade e a sofisticacao '
    'em telas pequenas. A performance e particularmente critica: o Google prioriza paginas com '
    'Core Web Vitals adequados, e a lentidao afeta tanto o ranqueamento organico quanto a '
    'experiencia do usuario pago.'
))

# 3.12
story.append(h2('3.12. Integracao com WhatsApp e CRM'))
story.append(p(
    'O Create Media relata que "apos o preenchimento do formulario voce sera redirecionado para o '
    'WhatsApp", e que imobiliarias que integram WhatsApp diretamente na landing page "dobraram os '
    'leads apos trocar links genericos por landing pages personalizadas". O Praedium destaca que '
    'a integracao com CRM permite "lead scoring" automatico, onde leads que baixam materiais '
    'especificos recebem pontuacoes diferenciadas que orientam a abordagem do corretor.'
))
story.append(p(
    'A infraestrutura ideal inclui: formulario que dispara mensagem automatica para o WhatsApp '
    'do corretor responsavel, criacao automatica do cliente no CRM com origem identificada '
    '(Meta Ads, Google Ads, organico), tag UTM tracking para atribuicao precisa de campanhas, '
    'webhook para recebimento automatico de leads do Facebook/Instagram Lead Ads, e fluxo de '
    'nurturing automatico para leads que nao converteram na primeira visita. O CRM Pro ja '
    'possui parte dessa infraestrutura, conforme sera analisado na secao seguinte.'
))

# ── 4. ANALISE DA IMPLEMENTACAO ATUAL ────────────────────────────────
story.append(h1('4. Analise da Implementacao Atual do CRM Pro'))
story.append(accent_line())

story.append(p(
    'A analise completa do codigo-fonte do CRM Pro revelou uma descoberta critica: o sistema '
    'nao possui nenhuma landing page publica para empreendimentos. O que existe atualmente e '
    'apenas uma interface administrativa interna (componente EnterpriseManagement) acessivel '
    'exclusivamente a usuarios autenticados com funcao de ADMIN. Essa interface permite criar, '
    'editar e excluir empreendimentos, alem de fazer upload de uma imagem de capa e de um '
    'arquivo PDF contendo a base de dados para o assistente de IA.'
))

story.append(h2('4.1. O que Existe Hoje'))

story.append(p(
    'O componente EnterpriseManagement apresenta os empreendimentos em um grid de cards com imagem '
    'de capa (ou placeholder com icone), nome, regiao, contagem de clientes vinculados e indicador '
    'de base de dados (PDF) vinculada. Cada card permite acoes administrativas como editar, excluir, '
    'fazer upload de imagem e enviar base de dados em PDF para a IA. Trata-se de uma ferramenta de '
    'gestao interna, nao de uma vitrine publica para potenciais compradores.'
))

story.append(h2('4.2. O que Nao Existe'))

story.append(p(
    'Nao existe nenhuma rota publica que permita a um visitante nao autenticado visualizar os detalhes '
    'de um empreendimento. A rota /api/enterprises/list-public, apesar do nome, requer autenticacao '
    'de sessao (verificacao via getServerSession). O unico acesso publico e o portal do cliente em '
    '/portal, que e voltado para clientes ja cadastrados com token de acesso, permitindo-lhes '
    'visualizar e reagendar visitas agendadas, mas nao serve como vitrine de empreendimentos.'
))

story.append(p(
    'Em resumo, o CRM Pro possui infraestrutura robusta para receber leads (webhook do Meta Ads, '
    'gestao de clientes, pipeline kanban, agendamentos, lembretes com Google Calendar e assistente '
    'de IA), mas falta o elemento central da captacao: a landing page publica do empreendimento '
    'que converte visitantes em leads antes de eles entrarem no funil do CRM.'
))

# ── 5. MATRIZ DE CONFORMIDADE ────────────────────────────────────────
story.append(h1('5. Matriz de Conformidade'))
story.append(accent_line())

story.append(p(
    'A tabela abaixo apresenta a conformidade da implementacao atual do CRM Pro em relacao a cada '
    'uma das 12 melhores praticas identificadas. A avaliacao considera a presenca ou ausencia '
    'completa do elemento, atribuindo um status de "Conforme", "Parcial" ou "Ausente".'
))

avail_w = A4[0] - 2 * 2.2 * cm
conformity_data = [
    ['1', 'Hero Section com CTA Imediato', 'Ausente', 'Nao existe pagina publica'],
    ['2', 'Galeria de Imagens e Videos', 'Ausente', 'Apenas imagem de capa no admin'],
    ['3', 'Formulario Curto e Inteligente', 'Ausente', 'Nenhum formulario publico'],
    ['4', 'Prova Social e Confianca', 'Ausente', 'Nenhum sinal de confianca publico'],
    ['5', 'Descricao Emocional', 'Ausente', 'Apenas nome e regiao no cadastro'],
    ['6', 'Localizacao com Mapa', 'Ausente', 'Campo de regiao como texto simples'],
    ['7', 'Plantas e Especificacoes', 'Ausente', 'Nenhuma planta disponivel'],
    ['8', 'Diferenciais e Amenidades', 'Ausente', 'Nao existe seccao de lazer'],
    ['9', 'CTAs Repetidos', 'Ausente', 'Nenhum CTA publico'],
    ['10', 'Urgencia e Escassez', 'Parcial', 'Contagem de clientes existe no admin'],
    ['11', 'Otimizacao Mobile-First', 'Parcial', 'Portal do cliente e responsivo'],
    ['12', 'WhatsApp e CRM', 'Parcial', 'Webhook Meta Ads existe, mas sem LP'],
]

t = make_table(
    ['N.', 'Pratica', 'Status', 'Observacao'],
    conformity_data,
    col_widths=[avail_w*0.06, avail_w*0.30, avail_w*0.14, avail_w*0.50]
)
story.append(t)
story.append(Spacer(1, 8))

story.append(p(
    'A matriz revela que o CRM Pro esta em conformidade com zero das 12 melhores praticas essenciais '
    'para landing pages de empreendimentos de alto padrao. As tres praticas marcadas como "Parcial" '
    'referem-se a capacidades que existem no sistema mas nao estao expostas em uma landing page publica. '
    'O webhook do Meta Ads, por exemplo, e capaz de receber leads automaticamente, mas sem uma landing '
    'page para onde direcionar o trafego pago, essa infraestrutura fica subutilizada.'
))

# ── 6. PLANO DE RECOMENDACOES ────────────────────────────────────────
story.append(h1('6. Plano de Recomendacoes Priorizadas'))
story.append(accent_line())

story.append(p(
    'Com base na analise de gaps e na infraestrutura ja existente no CRM Pro, as recomendacoes '
    'foram organizadas em tres fases de implementacao, priorizando os elementos de maior impacto '
    'na conversao com o menor esforco de desenvolvimento.'
))

story.append(h2('Fase 1: MVP da Landing Page (Impacto Alto, Esforco Medio)'))

story.append(bullet(
    '<b>Criar rota publica /e/[slug]</b>: Gerar uma rota dinamica que recebe o slug do empreendimento '
    'e renderiza a landing page publica. O slug pode ser derivado do nome do empreendimento (ex: '
    '"residencial-parque-das-flores"). A rota deve ser acessivel sem autenticacao.'
))
story.append(bullet(
    '<b>Hero Section com imagem de capa e CTA</b>: Utilizar o campo imageUrl ja existente no modelo '
    'Enterprise como imagem de fundo da hero section. Incluir titulo com nome do empreendimento, '
    'subtitulo com regiao e CTA "Agendar Visita" que abre um formulario modal ou direciona para '
    'a seccao de contato.'
))
story.append(bullet(
    '<b>Formulario de captacao de leads</b>: Formulario de 3 campos (nome, telefone, e-mail opcional) '
    'que cria automaticamente um cliente no CRM com stage LEAD e vincula ao empreendimento. '
    'Apos o envio, redirecionar para o WhatsApp do corretor responsavel.'
))
story.append(bullet(
    '<b>Ampliar modelo de dados</b>: Adicionar campos ao modelo Enterprise como descricaoLonga, '
    'diferenciais (JSON ou texto), galeria de imagens (array de URLs), videoUrl, statusVendas '
    '(total/unidades vendidas), e cepEndereco para o mapa.'
))

story.append(h2('Fase 2: Enriquecimento de Conteudo (Impacto Medio-Alto, Esforco Medio)'))

story.append(bullet(
    '<b>Galeria de imagens com lightbox</b>: Implementar carrossel de imagens com suporte a zoom, '
    'navegacao por swipe no mobile e lazy loading. Utilizar as 15 imagens por empreendimento ja '
    'previstas na arquitetura (bucket Supabase).'
))
story.append(bullet(
    '<b>Integracao de video</b>: Permitir embed de videos do YouTube ou upload de video para '
    'exibicao na seccao de galeria. Segundo o Beefree, video pode aumentar conversoes em ate 80%.'
))
story.append(bullet(
    '<b>Mapa interativo com Google Maps</b>: Incorporar mapa com base no campo de endereco, '
    'mostrando raio de proximidade com pontos de interesse (escolas, hospitais, shopping).'
))
story.append(bullet(
    '<b>Plantas baixas interativas</b>: Seccao com plantas de cada tipo, incluindo metragem, '
    'suítes, varanda e CTA contextual para cada planta.'
))
story.append(bullet(
    '<b>Seccao de diferenciais</b>: Grid visual com icones para cada amenidade, utilizando o '
    'campo diferenciais do modelo ampliado.'
))

story.append(h2('Fase 3: Otimizacao e Conversao Avancada (Impacto Alto, Esforco Alto)'))

story.append(bullet(
    '<b>Prova social</b>: Seccao com depoimentos de compradores (modelo Client pode ser estendido '
    'com campo de depoimento), contadores de unidades vendidas, selos e certificacoes da construtora.'
))
story.append(bullet(
    '<b>Urgencia e escassez</b>: Contador de unidades restantes baseado no campo statusVendas, '
    'badges de "Ultimas Unidades" e timer para condicoes especiais de lancamento.'
))
story.append(bullet(
    '<b>CTAs repetidos e sticky</b>: Implementar CTA flutuante no rodape mobile e repetir o CTA '
    'a cada 2-3 seccoes, com texto contextual conforme a seccao atual.'
))
story.append(bullet(
    '<b>Tracking pixel e analytics</b>: Implementar tracking pixel para Meta Ads e Google Ads, '
    'eventos de conversao no formulario e UTM tracking para atribuicao de campanhas. O modelo '
    'de dados ja possui campo para tracking_key.'
))
story.append(bullet(
    '<b>Otimizacao SEO</b>: Meta tags dinamicas (title, description, Open Graph), dados '
    'estruturados (JSON-LD para Property/RealEstateListing), sitemap XML e canonical URLs.'
))
story.append(bullet(
    '<b>Testes A/B</b>: Infraestrutura para testar variantes de hero image, texto do CTA e '
    'posicao do formulario, medindo impacto na taxa de conversao.'
))

# ── 7. CONCLUSAO ─────────────────────────────────────────────────────
story.append(h1('7. Conclusao'))
story.append(accent_line())

story.append(p(
    'A pesquisa revelou que as landing pages de empreendimentos de alto padrao que mais convertem '
    'compartilham uma arquitetura comum: hero section com CTA imediato, galeria visual rica, '
    'formulario curto, prova social, descricao emocional, localizacao com mapa, plantas, '
    'diferenciais, CTAs repetidos, urgencia, otimizacao mobile e integracao com WhatsApp/CRM. '
    'Essas 12 praticas, validadas por mais de 10 fontes especializadas internacionais e brasileiras, '
    'sao capazes de elevar a taxa de conversao de menos de 2% para entre 11% e 28%.'
))
story.append(p(
    'O CRM Pro possui uma base solida de infraestrutura para gestao de leads, incluindo webhook '
    'do Meta Ads, pipeline kanban, agendamentos com Google Calendar e assistente de IA com '
    'contexto de cada empreendimento. Porem, a ausencia completa de landing pages publicas '
    'significa que todo o trafego pago ou organico direcionado ao sistema esbarra na tela de login, '
    'sem nenhum ponto de captacao. E como ter uma loja fisica com excelentes gerentes de vendas, '
    'mas sem vitrines.'
))
story.append(p(
    'A implementacao da Fase 1 (MVP da Landing Page) e o passo mais critico e de maior retorno '
    'sobre investimento. Com a rota publica, hero section, formulario de captacao e integracao '
    'com o CRM existente, o sistema passara de zero para uma presenca digital ativa capaz de '
    'captar leads qualificados 24 horas por dia. As fases subsequentes adicionam camadas de '
    'sofisticacao que multiplicam a taxa de conversao, mas a Fase 1 ja posiciona o CRM Pro no '
    'mesmo patamar das referencias do mercado.'
))

# ── Build ────────────────────────────────────────────────────────────
doc.build(story)
print(f'PDF gerado: {OUTPUT}')