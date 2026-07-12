// ============================================================
// Script para atualizar o cachedInfo de todos os empreendimentos
// Execute no console do navegador (F12 → Console) com o app rodando
// ============================================================

const updates = [
  {
    id: 'cmqgx6u2h0000l2041cln88pf',
    cachedInfo: {
      location: {
        address: 'Quadra 02, Conjunto B-8, Projeção B',
        neighborhood: 'Sobradinho',
        city: 'Brasília',
        state: 'DF',
        region: 'Sobradinho',
        additionalInfo: 'Aproximadamente 14 km do Plano Piloto. Excelente região de Sobradinho, próximo a centros comerciais, supermercados, clínicas, hospitais, farmácias, bancos, escolas e universidades.'
      },
      builder: 'MC Engenharia — como parte do Residencial Quattre, complexo de 4 torres com nomes inspirados em cidades europeias (Belgrado, Istambul, Atenas, Bucareste).',
      architecture: 'Residencial de conceito "boutique" com fachada moderna, 6 andares e 72 apartamentos. Projeto com aproveitamento de iluminação e ventilação naturais. Lazer no topo do edifício (cobertura) como conceito diferenciado. Acabamento de alto padrão com infraestrutura para ar condicionado e fechadura eletrônica.',
      landscaping: 'Área de lazer na cobertura com vista panorâmica de Sobradinho. Belíssimo projeto de paisagismo. Áreas comuns entregues decoradas e equipadas sem cobrança de taxa adicional.',
      differentials: [
        'Primeiro residencial boutique de Sobradinho',
        'Piscina na cobertura com vista panorâmica',
        'Áreas de lazer decoradas e equipadas sem custo adicional',
        'Churrasqueiras na cobertura',
        'Salão de festas',
        'Academia equipada',
        'Brinquedoteca',
        'Bicicletário',
        'Segurança 24h com guarita',
        'Vagas de garagem cobertas no subsolo',
        'Fechadura eletrônica'
      ],
      apartmentTypes: [
        { name: '2 Quartos', area: '66m² a 69m²', bedrooms: '2 quartos (1 suíte)', description: '1 vaga de garagem, 2 banheiros.' },
        { name: '3 Quartos', area: '100m²', bedrooms: '3 quartos (1 suíte)', description: '1 a 2 vagas de garagem, 3 banheiros, varanda.' },
      ],
      summary: 'O Quattre Torre Istambul é o segundo capítulo do Residencial Quattre, descrito como o "primeiro residencial boutique de Sobradinho". São 6 andares com 72 apartamentos de 2 e 3 quartos, com lazer completo, incluindo piscinas, churrasqueiras, academia e salão de festas. As áreas comuns são entregues decoradas e equipadas sem custo adicional. O empreendimento traz um conceito de alto padrão para Sobradinho. Previsão de entrega para novembro de 2027.'
    }
  },
  {
    id: 'cmqgzg7uq0000kz04r66bh6de',
    cachedInfo: {
      location: {
        address: 'SQNW 104, Bloco F',
        neighborhood: 'Setor Noroeste',
        city: 'Brasília',
        state: 'DF',
        region: 'Noroeste',
        additionalInfo: 'Central de Vendas no CRNW 511, Bloco A, Lote 1. Bairro mais desejado de Brasília, com comércio variado, praças, playgrounds, ciclovias e quadras poliesportivas.'
      },
      builder: 'Parceria entre Apex Engenharia (fundada em 1976, +5 mil unidades entregues, +530.000 m² de obras) e Jarjour Empreendimentos (+60 anos de mercado, sinônimo de solidez e segurança imobiliária em Brasília).',
      architecture: 'Empreendimento residencial de alto padrão com conceito moderno — o espaço premium do prédio é convertido em área de lazer coletiva. Apartamentos vazados com ventilação cruzada e plantas inteligentes. Áreas comuns entregues mobiliadas e decoradas, com taxa de decoração.',
      landscaping: 'Paisagismo entregue com plantas de pequeno porte. Áreas de lazer no topo do edifício, com vista privilegiada.',
      differentials: [
        'Lazer no topo do edifício',
        'Apartamentos vazados com ventilação cruzada',
        'Piscinas (adulto e infantil)',
        'Academia equipada',
        'Sauna integrada à área das piscinas',
        'Espaço Gourmet com churrasqueira a carvão',
        'Car Wash (lavagem de veículos)',
        'Closet na suíte principal',
        'Lavabo na maioria das plantas',
      ],
      apartmentTypes: [
        { name: 'Tipo 1 — 3 Quartos', area: '88m² a 89m²', bedrooms: '3 quartos (1 suíte), closet', description: '2 banheiros, 2 vagas.' },
        { name: 'Tipo 2 — 3 Quartos', area: '105m²', bedrooms: '3 quartos (3 suítes)', description: '4 banheiros, 3 vagas.' },
        { name: 'Tipo 3 — 3 Quartos', area: '112m²', bedrooms: '3 quartos (1 suíte, 2 semissuítes)', description: 'Piscina, 2 banheiros, 3 vagas.' },
        { name: 'Tipo 4 — Cobertura Duplex', area: '186m²', bedrooms: '3 quartos (1 suíte), closet', description: '3 banheiros, piscina privativa, 3 vagas.' },
        { name: 'Tipo 5 - Cobertura Duplex', area: '210m²', bedrooms: '3 quartos (3 suítes)', description: '5 banheiros, piscina privativa, 3 vagas.' },
        { name: 'Tipo 6 - Cobertura Duplex', area: '261m²', bedrooms: '3 quartos (1 suíte e 2 semissuítes)', description: '3 banheiros, piscina privativa, 3 vagas.' }
      ],
      summary: 'O Moment Noroeste é um empreendimento de alto padrão resultado da parceria entre Apex Engenharia e Jarjour Empreendimentos, localizado no bairro mais desejado de Brasília. Com o conceito inovador de churrasqueira com piscina privativa na cobertura social, o espaço premium do topo do edifício se diferencia. Oferece apartamentos de 3 quartos (88m² a 112m²) e coberturas duplex (186m² a 261m² com piscina privativa). Previsão de entrega para fevereiro de 2028.'
    }
  },
  {
    id: 'cmqs6lmun0000i104ohjtyghy',
    cachedInfo: {
      location: {
        address: 'QNM 29, Área Especial C',
        neighborhood: 'Ceilândia Sul',
        city: 'Brasília',
        state: 'DF',
        region: 'Ceilândia',
        additionalInfo: 'Terreno de 5.000 m². Fácil acesso à Av. Elmo Serejo e Via Estrutural. Próximo ao Hospital Regional de Ceilândia, metrô, shopping center, supermercados e comércio diversificado e futuro Centro Administrativo do DF (CAD).'
      },
      builder: 'Joint venture entre Habitar Empreendimentos (incorporadora líder), Grupo Attos (Attos Incorporadora) e HC Construtora. Selo Imóvel Legal ADEMI-DF — empreendimento 100% regularizado.',
      architecture: '2 torres residenciais de 13 andares cada, totalizando 291 apartamentos e 6 lojas comerciais no térreo. 11 unidades por andar, posição nascente. Condomínio fechado com laje maciça (maior conforto acústico). Unidades Garden no térreo com área de jardim até 80m².',
      landscaping: 'Áreas de lazer completas entregues mobiliadas, equipadas e decoradas sem custo adicional. Espaço Pet, playground externo e áreas verdes integradas.',
      differentials: [
        'Lazer completo mobiliado e decorado sem custo adicional',
        'Coworking moderno no condomínio',
        'Espaço Bike completo (bicicletário + lavagem/manutenção)',
        'Mini Mercado 24h no condomínio',
        'Espaço Delivery seguro para entregas',
        'Vagas verdes para carros elétricos',
        'Laje maciça (superior em conforto acústico)',
        'Selo Imóvel Legal ADEMI-DF',
        'Unidade decorada para visitação',
        'Piscina com deck molhado',
        'Brinquedoteca com playground externo',
        'Espaço Pet Place',
        'Portaria remota e monitoramento perimetral',
        'Wi-Fi nas áreas comuns',
        'Iluminação LED e sensores de presença',
      ],
      apartmentTypes: [
        { name: '1 Quarto', area: '32m² a 33m²', bedrooms: '1 quarto (1 suíte)', description: '1 banheiro, 1 vaga de garagem.' },
        { name: '2 Quartos (sem varanda)', area: '45m² a 48m²', bedrooms: '2 quartos', description: '1 banheiro, 1 vaga de garagem.' },
        { name: '2 Quartos com suíte e varanda', area: '54m²', bedrooms: '2 quartos (1 suíte)', description: '2 banheiros, 1 vaga de garagem, varanda.' },
        { name: 'Garden', area: '75m²', bedrooms: '2 quartos (1 suíte)', description: '2 banheiros, 1 vaga, jardim privativo.' },
        { name: 'Garden', area: '80m²', bedrooms: '2 quartos', description: '1 banheiro, 1 vaga, jardim privativo.' },
        { name: 'Garden', area: '105m²', bedrooms: '2 quartos', description: '1 banheiro, 1 vaga, jardim privativo.' }
      ],
      summary: 'O Residencial Vitta é um empreendimento em Ceilândia Sul desenvolvido pela parceria Habitar, Attos e HC Construtora. São 2 torres de 13 andares com 291 apartamentos de 1 e 2 quartos (32m² a 54²) e unidades Garden no térreo. Destaque para a localização e o lazer completo entregue mobiliado e decorado sem custo adicional, incluindo coworking, espaço bike, mini mercado 24h e espaço delivery.'
    }
  },
  {
    id: 'cmqh25wxc0000l204zyyptts8',
    cachedInfo: {
      location: {
        address: 'CRNW 511, Lote 01, Bloco A',
        neighborhood: 'Setor Noroeste',
        city: 'Brasília',
        state: 'DF',
        region: 'Noroeste, Brasília',
        additionalInfo: 'Quadra inteira, em frente a supermercado, ~400 metros do Parque Burle Marx. Lojas no térreo.'
      },
      builder: 'Parceria entre Apex Engenharia (5 mil+ unidades entregues) e Jarjour Empreendimentos (60+ anos de mercado). Projeto arquitetônico: Estrela Arquitetura. Design de interiores: Liê Arquitetura. Paisagismo: Fábio Camargo.',
      architecture: 'UNION 511 RESIDENCE MALL — primeiro condomínio fechado residencial do Noroeste. 4 blocos residenciais com 336 unidades e lojas no térreo (mix controlado). Fachada em granito branco e granito ecológico. Porcelanato amadeirado nos apartamentos. Plantas reversíveis (layout personalizável). TOTALMENTE PET FRIENDLY.',
      landscaping: 'Paisagismo assinado por Fábio Camargo com mais de 2.000 m² de área de lazer e convivência. Pergolados em madeira plástica (TecnoVerde — material sustentável e zero manutenção). Área de lazer central entre os blocos.',
      differentials: [
        'Primeiro condomínio fechado residencial do Noroeste',
        'Lojas comerciais no térreo (mix controlado)',
        'Sports Bar estilo americano com TVs e choppeira',
        'Coworking com 4 salas e Conference Room',
        'Union Delivery (refrigerador para entregas)',
        'Union Storage (armários compartilháveis)',
        'Union Locker (lockers inteligentes com código digital)',
        'Lavanderia self-service por QR Code',
        'Pet Care e Car Care',
        'Bike Care com bricolagem',
        'Bicicletas compartilhadas (5 unidades)',
        'Placas solares para aquecimento de água',
        'Preparação para carregamento elétrico em 100% das vagas',
        'Acesso biométrico e CFTV de alta resolução',
        'Gerador de energia para áreas comuns',
        'Fechadura eletrônica e tomadas USB',
        'PRONTO PARA MORAR'
      ],
      apartmentTypes: [
        { name: 'Union Style — 1 Quarto', area: '34m² a 43m²', bedrooms: '1 quarto (integrado)', description: '1 vaga vinculada, planta reversível.' },
        { name: 'Union Two — 2 Quartos', area: '48m² a 51m²', bedrooms: '2 quartos', description: '1 vaga vinculada, planta reversível.' },
        { name: 'Union Family — 2 Quartos (1 suíte)', area: '51m²', bedrooms: '2 quartos (1 suíte)', description: '1 vaga vinculada, planta reversível.' }
      ],
      summary: 'O Union 511 Residence Mall é o primeiro condomínio fechado residencial do Noroeste, construído pela parceria Apex Engenharia e Jarjour. Ocupa uma quadra inteira com 4 blocos, 336 unidades e lojas no térreo. Oferece mais de 2.000 m² de lazer, incluindo Sports Bar, coworking com 4 salas, piscina, sauna e academia. Destaque para serviços inovadores como Union Delivery, Union Locker, lavanderia por QR Code. EMPREENDIMENTO ENTREGUE.'
    }
  },
  {
    id: 'cmqh38n7t0000kw04o5lbg00y',
    cachedInfo: {
      location: {
        address: 'SGCV/SUL, Lote 10',
        neighborhood: 'Park Sul',
        city: 'Brasília',
        state: 'DF',
        region: 'Park Sul, Brasília',
        additionalInfo: 'Terreno de 15.000 m². Ao lado do Park Shopping. 10-12 minutos do Aeroporto Internacional. Próximo ao metrô, Parque da Cidade, Park Design, Casa Park e Carrefour.'
      },
      builder: 'Soltec Engenharia — fundada em Brasília em 1984, com mais de 40 anos de mercado no DF. Inicialmente especializada em fundações e patologia de estruturas, evoluiu para incorporadora completa.',
      architecture: 'Condomínio fechado tipo "Resort Urbano" com 5 torres. Conceito "Residence Service" com concierge 24h, gestão de serviços. Torres A, B, C3, D e E já entregues. Torre C1 em construção (entrega out/2027). Fachada moderna inspirada na Califórnia.',
      landscaping: 'Terreno de 15.000 m² com apenas 5 torres, proporcionando amplo espaço entre os blocos. Hall de acesso central com paisagismo integrado.',
      differentials: [
        'Conceito "Resort Urbano" — um clube para morar',
        'Conceito "Residence Service" com concierge 24h',
        'Mais de 40 itens de lazer',
        'Complexo aquático com +1.000 m² de piscina',
        'Piscina com raia semiolímpica',
        'Spa Hot Springs com acesso por mergulho à sauna',
        'Home Cinema / cinema privativo',
        'Business Center com Coworking',
        'Salão de jogos adulto (sinuca)',
        'Mall com 8 lojas (Gallery)',
        'Serviços pay-per-use (limpeza, arrumação, reparos)',
        'Lavanderia coletiva profissional',
        'Financiamento direto em até 100 meses',
        'Alta rentabilidade para locação',
        'Torres PRONTAS para morar',
        'Opões com vista livre'
      ],
      apartmentTypes: [
        { name: 'Flats', area: '26m a 33m²', bedrooms: 'Flat', description: 'Opções com varanda, 1 vaga rotativa.' },
        { name: '1 Quarto', area: '34m² a 42m²', bedrooms: '1 quarto', description: 'Opções vazadas com 2 varandas, 1 vaga rotativa.' },
        { name: '2 Quartos', area: '47m² a 53m²', bedrooms: '2 quartos', description: 'Opções com varanda, 1 vaga rotativa.' },
        { name: 'Cobertura Duplex', area: '60m² a 102m²', bedrooms: '1 quarto', description: '2 vagas vinculadas.' }
      ],
      summary: 'O Venice Park é um condomínio estilo "Resort Urbano" no Park Sul, ao lado do Park Shopping, desenvolvido pela Soltec Engenharia (40+ anos). Com terreno de 15.000 m² e 5 torres, oferece mais de 40 itens de lazer incluindo complexo aquático de 1.000+ m², piscina semiolímpica, spa, home cinema e business center. Conceito "Residence Service" com concierge 24h e serviços pay-per-use. Unidades de flats a coberturas duplex (26m² a 102m²). Opções de unidades já entregues.'
    }
  },
  {
    id: 'cmpx3sfjt0000lj04y125cn1y',
    cachedInfo: {
      location: {
        address: 'SQPS 103, Lote 01-D',
        neighborhood: 'Park Sul',
        city: 'Brasília',
        state: 'DF',
        region: 'Park Sul, Brasília',
        additionalInfo: 'Ao lado da Decathlon. 5 minutos do Metrô e do Plano Piloto, 10 minutos do Parque da Cidade. Próximo ao Park Shopping, Casapark, Park Design e Carrefour.'
      },
      builder: 'HC Construtora (HC Incorporadora) — parte do Grupo HC, com 60 anos de atuação em Brasília.',
      architecture: 'Condomínio fechado de alto padrão com conceito de "resort". 4 torres (A, B, C e D) com apartamentos tipo, gardens e coberturas lineares. Padrão construtivo de alta performance com tratamento acústico, térmico e lumínico. Esquadrias de piso ao teto.',
      landscaping: '3.400 m² de áreas de lazer completas em estrutura de resort. Projeto paisagístico elaborado por Martha Gavião para integrar as áreas de lazer ao conjunto.',
      differentials: [
        '3.400 m² de lazer em estrutura de resort',
        'Piscina semiolímpica para natação',
        'Spas e Saunas',
        'Quadra e Lounge de Beach Tennis',
        'Espaço Funcional (yoga, peso livre)',
        'Unidades Garden (térreo com jardim, até 351m²)',
        'Coberturas lineares com piscina privativa',
        'Chuveiro duplo e duas cubas na suíte master',
        'Depósitos privativos no subsolo para todos',
        'Tomadas USB-C',
        'Medição individualizada de gás e água',
        'Tratamento acústico entre unidades',
        'Ventilação natural na área de serviço e banheiros',
        'Gardens com capacidade para piscina ou SPA',
        'Unidade decorada para visitação',
      ],
      apartmentTypes: [
        { name: '2 Suítes (Torre A)', area: '86m²', bedrooms: '2 quartos (2 suítes)', description: '2 vagas de garagem.' },
        { name: '3 Quartos', area: '104m²', bedrooms: '3 quartos (1 suíte e 2 semissuítes)', description: '3 vagas.' },
        { name: '3 Suítes (Torre A e D)', area: '126m²', bedrooms: '3 quartos (3 suítes)', description: '3 vagas.' },
        { name: 'Garden 4 quartos (Torres B/C)', area: '267m²', bedrooms: '4 quartos (2 suítes e 2 semi-suítes)', description: 'Jardim privativo.' },
        { name: 'Garden 3 quartos (Torres A e D)', area: '229m² a 351m²', bedrooms: '3 suítes', description: 'Jardim privativo.' },
        { name: 'Cobertura Linear 3 quartos (Torre A)', area: '153m² a 154m²', bedrooms: '3 quartos (1 suíte e 2 semi-suítes)', description: '3 vagas, piscina privativa.' },
        { name: 'Cobertura Linear 3 quartos (Torre A)', area: '167m²', bedrooms: '3 quartos (3 suítes)', description: '4 vagas, piscina privativa.' },
        { name: 'Cobertura Linear 4 quartos (Torres B e C)', area: '295m²', bedrooms: '4 quartos', description: '4 vagas, piscina privativa, elevador privativo' },
        { name: 'Cobertura Linear (Torre D)', area: '173,31m²', bedrooms: '3 suítes', description: 'Lazer privativo. Preço sob consulta.' }
      ],
      summary: 'O Villa Bianco é um condomínio fechado de alto padrão no Park Sul, desenvolvido pela HC Construtora (Grupo HC, 60 anos). Com 4 torres oferecendo apartamentos de 2 a 3 suítes (85m² a 351m²), gardens e coberturas lineares com lazer privativo. Destaque para os 3.400 m² de lazer em estrutura de resort, incluindo piscina com raia semiolímpica, spa, beach tennis, academia e espaço funcional. Tratamento acústico, térmico e lumínico conforme norma de desempenho. Previsão de entrega para outubro de 2027.'
    }
  }
];

fetch('/api/enterprises/update-cached-info', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ updates })
})
.then(r => r.json())
.then(d => {
  console.log('✅ Resultado:', d.message);
  if (d.results) d.results.forEach(r => console.log(r.success ? `  ✅ ${r.name}` : `  ❌ ${r.name}: ${r.error}`));
})
.catch(e => console.error('❌ Erro:', e));
