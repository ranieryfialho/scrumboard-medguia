import { Lead } from '@/types/lead';

// Status que definem que o lead "converteu" (Login/Ativação)
const STATUS_CONVERSAO = ['Fechado', 'Aguardando Ativação'];

// Resolve o nome do anúncio a exibir na tabela
function resolverNomeAnuncio(lead: Lead): string {
  const anuncio = (lead.anuncio || '').trim();
  const anuncioValido = anuncio !== '' && anuncio.toLowerCase() !== 'desconhecido';

  if (anuncioValido) {
    return anuncio;
  }

  const origem = (lead.origem || '').trim();
  if (origem.toLowerCase().startsWith('manual')) {
    const partes = origem.split('-');
    if (partes.length >= 2) {
      const subtipo = partes.slice(1).join('-').trim();
      const mapaSubtipos: Record<string, string> = {
        'lp':        'Landing Page',
        'indicação': 'Indicação',
        'indicacao': 'Indicação',
        'outro':     'Outro',
      };
      return mapaSubtipos[subtipo.toLowerCase()] ?? subtipo;
    }
    return 'Manual';
  }

  return 'Sem Anúncio Mapeado';
}

export function generateReportMetrics(leads: Lead[], month: number, year: number) {
  
  // Helper robusto: agora aceita string, null ou undefined sem o TypeScript reclamar
  function getMonthYear(dataStr?: string | null): { month: number; year: number } | null {
    if (!dataStr) return null;
    const str = dataStr.trim();
    
    // Formato BR: DD/MM/AAAA
    const regexBR = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/;
    const matchBR = str.match(regexBR);
    if (matchBR) {
      return { month: parseInt(matchBR[2], 10), year: parseInt(matchBR[3], 10) };
    }
    
    // Formato ISO: AAAA-MM-DD
    let safeStr = str;
    if (str.includes('-') && !str.includes('T')) {
      safeStr = `${str}T12:00:00`;
    }
    
    const dataObj = new Date(safeStr);
    if (!isNaN(dataObj.getTime())) {
      return { month: dataObj.getMonth() + 1, year: dataObj.getFullYear() };
    }
    
    return null;
  }

  // 1. O UNIVERSO DO MÊS (Paridade com o Kanban)
  const leadsDoMes = leads.filter(lead => {
    if (lead.situacao === 'Arquivado') return false;

    const dateCriacao = getMonthYear(lead.created_time || '');
    // CORREÇÃO: Força ser estritamente boolean com !== null
    const ehCriadoNoMes = dateCriacao !== null && dateCriacao.month === month && dateCriacao.year === year;

    let ehFechadoNoMes = false;
    if (STATUS_CONVERSAO.includes(lead.situacao)) {
      const leadEstendido = lead as Record<string, any>;
      const dataFechamento = leadEstendido.data_fechamento || lead.created_time || '';
      
      const dateFechamento = getMonthYear(dataFechamento);
      // CORREÇÃO PRINCIPAL: Impede que retorne null para a variável boolean
      ehFechadoNoMes = dateFechamento !== null && dateFechamento.month === month && dateFechamento.year === year;
    }

    return ehCriadoNoMes || ehFechadoNoMes;
  });

  const totalLeads = leadsDoMes.length;

  // 2. Separar as Conversões exatas do mês
  const leadsConvertidosNoMes = leadsDoMes.filter(lead => {
    if (!STATUS_CONVERSAO.includes(lead.situacao)) return false;
    
    const leadEstendido = lead as Record<string, any>;
    const dataFechamento = leadEstendido.data_fechamento || lead.created_time || '';
    
    const dateFechamento = getMonthYear(dataFechamento);
    // CORREÇÃO: Força ser estritamente boolean com !== null
    return dateFechamento !== null && dateFechamento.month === month && dateFechamento.year === year;
  });

  const conversoes = leadsConvertidosNoMes.length;

  // 3. NOVA MÉTRICA: Recuperação de Base (Criados em meses anteriores, fechados neste mês)
  const conversoesAnteriores = leadsConvertidosNoMes.filter(lead => {
    const dateCriacao = getMonthYear(lead.created_time || '');
    if (!dateCriacao) return false;
    
    // CORREÇÃO: Força ser estritamente boolean com !== null
    return dateCriacao !== null && (dateCriacao.year < year || (dateCriacao.year === year && dateCriacao.month < month));
  }).length;

  const taxaConversaoGeral = totalLeads > 0 ? ((conversoes / totalLeads) * 100).toFixed(2) : '0.00';

  // 4. Agrupamento por Fonte
  const porFonteMap: Record<string, { nome: string; leads: number; conversoes: number }> = {};
  
  leadsDoMes.forEach(lead => {
    const fonte = lead.origem || 'Outros / Desconhecida';
    if (!porFonteMap[fonte]) porFonteMap[fonte] = { nome: fonte, leads: 0, conversoes: 0 };
    porFonteMap[fonte].leads += 1;
  });

  leadsConvertidosNoMes.forEach(lead => {
    const fonte = lead.origem || 'Outros / Desconhecida';
    porFonteMap[fonte].conversoes += 1;
  });

  const porFonte = Object.values(porFonteMap).map(f => ({
    ...f,
    taxa: f.leads > 0 ? ((f.conversoes / f.leads) * 100).toFixed(2) : '0.00',
  })).sort((a, b) => b.leads - a.leads);

  // 5. Agrupamento por Anúncio
  const porAnuncioMap: Record<string, { nome: string; fonte: string; leads: number; conversoes: number }> = {};

  leadsDoMes.forEach(lead => {
    const anuncio = resolverNomeAnuncio(lead);
    const fonte = lead.origem || 'Desconhecida';
    const chave = `${anuncio}-${fonte}`;
    if (!porAnuncioMap[chave]) porAnuncioMap[chave] = { nome: anuncio, fonte, leads: 0, conversoes: 0 };
    porAnuncioMap[chave].leads += 1;
  });

  leadsConvertidosNoMes.forEach(lead => {
    const anuncio = resolverNomeAnuncio(lead);
    const fonte = lead.origem || 'Desconhecida';
    const chave = `${anuncio}-${fonte}`;
    porAnuncioMap[chave].conversoes += 1;
  });

  const porAnuncio = Object.values(porAnuncioMap).map(a => ({
    ...a,
    taxa: a.leads > 0 ? ((a.conversoes / a.leads) * 100).toFixed(2) : '0.00',
  })).sort((a, b) => b.leads - a.leads);

  // 6. Padrões Temporais 
  const diasSemana = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const porDiaMap = leadsDoMes.reduce((acc, lead) => {
    if (lead.created_time) {
      let dataStr = lead.created_time;
      if (dataStr.includes('/')) {
        const parts = dataStr.split(' ')[0].split('/');
        if (parts.length >= 3) {
          dataStr = `${parts[2]}-${parts[1]}-${parts[0]}T12:00:00`;
        }
      } else if (dataStr.includes('-') && !dataStr.includes('T')) {
        dataStr = `${dataStr}T12:00:00`;
      }
      const data = new Date(dataStr);
      if (!isNaN(data.getTime())) {
        const dia = diasSemana[data.getDay()];
        if (!acc[dia]) acc[dia] = 0;
        acc[dia] += 1;
      }
    }
    return acc;
  }, {} as Record<string, number>);

  const porDia = diasSemana.map(dia => ({ nome: dia, leads: porDiaMap[dia] || 0 }));

  return { 
    geral: { totalLeads, conversoes, conversoesAnteriores, taxaConversaoGeral }, 
    porFonte, 
    porAnuncio, 
    porDia,
    listaLeads: leadsDoMes 
  };
}