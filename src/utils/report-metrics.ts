import { Lead } from '@/types/lead';

// Status que definem que o lead "converteu" (Login/Ativação)
const STATUS_CONVERSAO = ['Fechado', 'Aguardando Ativação'];

export function generateReportMetrics(leads: Lead[], month = 2, year = 2026) {
  // 0. FILTRO PRINCIPAL (Apenas filtro de data - Todos os status são incluídos no volume)
  const leadsFiltrados = leads.filter(lead => {
    
    // Filtro de Data Super Robusto
    if (!lead.created_time) return false;
    
    const dataStr = lead.created_time.trim();
    let leadMonth = -1;
    let leadYear = -1;

    // Tentativa 1: Formato Brasileiro (ex: 26/02/2026 ou 26/02/2026 14:30)
    const regexBR = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/;
    const matchBR = dataStr.match(regexBR);
    
    if (matchBR) {
      leadMonth = parseInt(matchBR[2], 10);
      leadYear = parseInt(matchBR[3], 10);
    } else {
      // Tentativa 2: Formato Padrão ISO/Inglês (ex: 2026-02-26T14:30:00 ou 2026-02-26)
      // O JS entende esse formato nativamente
      const dataObj = new Date(dataStr);
      if (!isNaN(dataObj.getTime())) {
        leadMonth = dataObj.getMonth() + 1; // getMonth() em JS vai de 0 a 11
        leadYear = dataObj.getFullYear();
      }
    }

    // Retorna true apenas se for exatamente do mês e ano solicitados
    return leadMonth === month && leadYear === year;
  });

  // 1. Métricas Gerais (Volume total sem excluir arquivados)
  const totalLeads = leadsFiltrados.length;
  const conversoes = leadsFiltrados.filter(l => STATUS_CONVERSAO.includes(l.situacao)).length;
  const taxaConversaoGeral = totalLeads > 0 ? ((conversoes / totalLeads) * 100).toFixed(2) : '0.00';

  // 2. Agrupamento por Fonte (Origem)
  const porFonteMap = leadsFiltrados.reduce((acc, lead) => {
    const fonte = lead.origem || 'Outros / Desconhecida';
    if (!acc[fonte]) acc[fonte] = { nome: fonte, leads: 0, conversoes: 0 };
    acc[fonte].leads += 1;
    if (STATUS_CONVERSAO.includes(lead.situacao)) acc[fonte].conversoes += 1;
    return acc;
  }, {} as Record<string, { nome: string; leads: number; conversoes: number }>);

  const porFonte = Object.values(porFonteMap).map(f => ({
    ...f,
    taxa: f.leads > 0 ? ((f.conversoes / f.leads) * 100).toFixed(2) : '0.00',
  })).sort((a, b) => b.leads - a.leads);

  // 3. Agrupamento por Anúncio (ad_name)
  const porAnuncioMap = leadsFiltrados.reduce((acc, lead) => {
    const anuncio = lead.anuncio && lead.anuncio.trim() !== '' ? lead.anuncio : 'Sem Anúncio Mapeado';
    const fonte = lead.origem || 'Desconhecida';
    const chave = `${anuncio}-${fonte}`; 
    
    if (!acc[chave]) acc[chave] = { nome: anuncio, fonte, leads: 0, conversoes: 0 };
    acc[chave].leads += 1;
    if (STATUS_CONVERSAO.includes(lead.situacao)) acc[chave].conversoes += 1;
    return acc;
  }, {} as Record<string, { nome: string; fonte: string; leads: number; conversoes: number }>);

  const porAnuncio = Object.values(porAnuncioMap).map(a => ({
    ...a,
    taxa: a.leads > 0 ? ((a.conversoes / a.leads) * 100).toFixed(2) : '0.00',
  })).sort((a, b) => b.leads - a.leads);

  // 4. Padrões Temporais (Dias da Semana)
  const diasSemana = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const porDiaMap = leadsFiltrados.reduce((acc, lead) => {
    if (lead.created_time) {
      let dataStr = lead.created_time;
      if (dataStr.includes('/')) {
        const parts = dataStr.split(' ')[0].split('/'); 
        if (parts.length === 3) {
           dataStr = `${parts[2]}-${parts[1]}-${parts[0]}T12:00:00`; 
        }
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

  return { geral: { totalLeads, conversoes, taxaConversaoGeral }, porFonte, porAnuncio, porDia };
}