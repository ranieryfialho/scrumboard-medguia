import { Lead } from '@/types/lead';

const STATUS_CONVERSAO = ['Logins Ativados', 'Fechamento de Clientes', 'Aguardando Ativação'];

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

export function generateReportMetrics(
  leads: Lead[], 
  tipoFiltro: "mes" | "periodo", 
  month: number, 
  year: number, 
  dataInicio: string, 
  dataFim: string
) {

  function getMonthYear(dataStr?: string | null): { month: number; year: number } | null {
    if (!dataStr) return null;
    const str = dataStr.trim();

    const matchBR = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (matchBR) {
      return { month: parseInt(matchBR[2], 10), year: parseInt(matchBR[3], 10) };
    }

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

  function getComparableDate(dataStr?: string | null): string | null {
    if (!dataStr) return null;
    const str = dataStr.trim();

    const matchBR = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (matchBR) {
      const d = matchBR[1].padStart(2, '0');
      const m = matchBR[2].padStart(2, '0');
      const y = matchBR[3];
      return `${y}-${m}-${d}`;
    }

    let safeStr = str;
    if (str.includes('-') && !str.includes('T')) {
      safeStr = `${str}T12:00:00`;
    }

    const dataObj = new Date(safeStr);
    if (!isNaN(dataObj.getTime())) {
      const d = String(dataObj.getDate()).padStart(2, '0');
      const m = String(dataObj.getMonth() + 1).padStart(2, '0');
      const y = dataObj.getFullYear();
      return `${y}-${m}-${d}`;
    }

    return null;
  }

  const leadsFiltrados = leads.filter(lead => {
    if (lead.situacao === 'Arquivado') return false;

    let ehCriadoNoPeriodo = false;
    let ehFechadoNoPeriodo = false;

    const dateCriacaoObj = getMonthYear(lead.created_time || '');
    const dateCriacaoStr = getComparableDate(lead.created_time || '');

    const leadEstendido = lead as Record<string, any>;
    const dataFechamento = leadEstendido.data_fechamento || lead.created_time || '';
    const dateFechamentoObj = getMonthYear(dataFechamento);
    const dateFechamentoStr = getComparableDate(dataFechamento);

    if (tipoFiltro === "mes") {
      ehCriadoNoPeriodo = dateCriacaoObj !== null && dateCriacaoObj.month === month && dateCriacaoObj.year === year;
      if (STATUS_CONVERSAO.includes(lead.situacao)) {
        ehFechadoNoPeriodo = dateFechamentoObj !== null && dateFechamentoObj.month === month && dateFechamentoObj.year === year;
      }
    } else {
      if (dateCriacaoStr) {
        ehCriadoNoPeriodo = (!dataInicio || dateCriacaoStr >= dataInicio) && (!dataFim || dateCriacaoStr <= dataFim);
      }
      if (STATUS_CONVERSAO.includes(lead.situacao) && dateFechamentoStr) {
        ehFechadoNoPeriodo = (!dataInicio || dateFechamentoStr >= dataInicio) && (!dataFim || dateFechamentoStr <= dataFim);
      }
    }

    return ehCriadoNoPeriodo || ehFechadoNoPeriodo;
  });

  const totalLeads = leadsFiltrados.length;

  const leadsConvertidos = leadsFiltrados.filter(lead => {
    if (!STATUS_CONVERSAO.includes(lead.situacao)) return false;
    const leadEstendido = lead as Record<string, any>;
    const dataFechamento = leadEstendido.data_fechamento || lead.created_time || '';
    
    if (tipoFiltro === "mes") {
      const dateFechamentoObj = getMonthYear(dataFechamento);
      return dateFechamentoObj !== null && dateFechamentoObj.month === month && dateFechamentoObj.year === year;
    } else {
      const dateFechamentoStr = getComparableDate(dataFechamento);
      return dateFechamentoStr !== null && (!dataInicio || dateFechamentoStr >= dataInicio) && (!dataFim || dateFechamentoStr <= dataFim);
    }
  });

  const conversoes = leadsConvertidos.length;

  const listaRecuperacao = leadsConvertidos.filter(lead => {
    if (tipoFiltro === "mes") {
      const dateCriacao = getMonthYear(lead.created_time || '');
      return dateCriacao !== null && (dateCriacao.year < year || (dateCriacao.year === year && dateCriacao.month < month));
    } else {
      const dateCriacaoStr = getComparableDate(lead.created_time || '');
      return dateCriacaoStr !== null && dataInicio ? dateCriacaoStr < dataInicio : false;
    }
  });
  const conversoesAnteriores = listaRecuperacao.length;

  const leadsDesqualificados = leadsFiltrados.filter(
    lead => lead.situacao === 'Desqualificado'
  );
  const desqualificados = leadsDesqualificados.length;

  const taxaDesqualificacao = totalLeads > 0
    ? ((desqualificados / totalLeads) * 100).toFixed(1)
    : '0.0';

  const desqPorOrigemMap: Record<string, number> = {};
  leadsDesqualificados.forEach(lead => {
    const origem = lead.origem || 'Desconhecida';
    desqPorOrigemMap[origem] = (desqPorOrigemMap[origem] || 0) + 1;
  });
  const desqPorOrigem = Object.entries(desqPorOrigemMap)
    .map(([origem, total]) => ({ origem, total }))
    .sort((a, b) => b.total - a.total);

  const taxaConversaoGeral = totalLeads > 0
    ? ((conversoes / totalLeads) * 100).toFixed(2)
    : '0.00';

  const porFonteMap: Record<string, {
    nome: string;
    leads: number;
    conversoes: number;
    desqualificados: number;
  }> = {};

  leadsFiltrados.forEach(lead => {
    const fonte = lead.origem || 'Outros / Desconhecida';
    if (!porFonteMap[fonte]) {
      porFonteMap[fonte] = { nome: fonte, leads: 0, conversoes: 0, desqualificados: 0 };
    }
    porFonteMap[fonte].leads += 1;
    if (lead.situacao === 'Desqualificado') {
      porFonteMap[fonte].desqualificados += 1;
    }
  });

  leadsConvertidos.forEach(lead => {
    const fonte = lead.origem || 'Outros / Desconhecida';
    porFonteMap[fonte].conversoes += 1;
  });

  const porFonte = Object.values(porFonteMap).map(f => ({
    ...f,
    taxa: f.leads > 0 ? ((f.conversoes / f.leads) * 100).toFixed(2) : '0.00',
  })).sort((a, b) => b.leads - a.leads);

  const porAnuncioMap: Record<string, {
    nome: string;
    fonte: string;
    leads: number;
    conversoes: number;
  }> = {};

  leadsFiltrados.forEach(lead => {
    const anuncio = resolverNomeAnuncio(lead);
    const fonte = lead.origem || 'Desconhecida';
    const chave = `${anuncio}-${fonte}`;
    if (!porAnuncioMap[chave]) {
      porAnuncioMap[chave] = { nome: anuncio, fonte, leads: 0, conversoes: 0 };
    }
    porAnuncioMap[chave].leads += 1;
  });

  leadsConvertidos.forEach(lead => {
    const anuncio = resolverNomeAnuncio(lead);
    const fonte = lead.origem || 'Desconhecida';
    const chave = `${anuncio}-${fonte}`;
    porAnuncioMap[chave].conversoes += 1;
  });

  const porAnuncio = Object.values(porAnuncioMap).map(a => ({
    ...a,
    taxa: a.leads > 0 ? ((a.conversoes / a.leads) * 100).toFixed(2) : '0.00',
  })).sort((a, b) => b.leads - a.leads);

  const diasSemana = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const porDiaMap = leadsFiltrados.reduce((acc, lead) => {
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
    geral: {
      totalLeads,
      conversoes,
      conversoesAnteriores,
      taxaConversaoGeral,
      desqualificados,
      taxaDesqualificacao,
      desqPorOrigem,
    },
    porFonte,
    porAnuncio,
    porDia,
    listaLeads: leadsFiltrados,
    listaConversoes: leadsConvertidos,
    listaRecuperacao,
    listaDesqualificados: leadsDesqualificados,
  };
}