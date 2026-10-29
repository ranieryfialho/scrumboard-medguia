// T-187 (fase4-tarefas-agenda, AC-496): chamadas das ações da agenda e as
// mensagens, em português, de cada código de recusa.
export type ResultadoAcaoAgenda = { ok: true } | { ok: false; codigo: string; mensagem: string };

const MENSAGENS: Record<string, string> = {
  DATA_NO_PASSADO: 'Escolha uma data e uma hora no futuro.',
  CARD_NAO_PODE_AGENDAR: 'Este card não está numa etapa que permita agendar reunião.',
  OPORTUNIDADE_NAO_ENCONTRADA: 'Card não encontrado.',
  REUNIAO_NAO_ENCONTRADA: 'Reunião não encontrada.',
  AINDA_NAO_ACONTECEU: 'A reunião ainda não aconteceu, então não dá para registrar no-show.',
  REUNIAO_NAO_PODE_CANCELAR: 'Só dá para cancelar uma reunião que ainda não aconteceu e não foi remarcada.',
  REUNIAO_JA_TEM_RESULTADO: 'Esta reunião já tem resultado registrado.',
  REUNIAO_REMARCADA: 'Esta reunião já foi remarcada.',
  EVIDENCIA_OBRIGATORIA: 'Falta enviar a evidência (anexo) da reunião.',
  TRANSICAO_NAO_PERMITIDA: 'O card não pode mudar de etapa a partir da etapa em que está.',
  PAPEL_NAO_PERMITIDO: 'Seu papel não tem permissão para essa mudança.',
  CONFLITO_DE_VERSAO: 'Outra pessoa mexeu neste card ao mesmo tempo. Tente de novo.',
  REQUISICAO_INVALIDA: 'Confira os dados informados.',
  NAO_AUTENTICADO: 'Sua sessão expirou. Entre novamente.',
};

export function mensagemDoCodigo(codigo: string | undefined): string {
  return (codigo && MENSAGENS[codigo]) || 'Não foi possível concluir a ação. Tente de novo.';
}

async function enviar(url: string, corpo: unknown): Promise<ResultadoAcaoAgenda> {
  try {
    const resposta = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo ?? {}) });
    if (resposta.ok) return { ok: true };
    const erro = (await resposta.json().catch(() => ({}))) as { codigo?: string };
    return { ok: false, codigo: erro.codigo ?? 'ERRO', mensagem: mensagemDoCodigo(erro.codigo) };
  } catch {
    return { ok: false, codigo: 'REDE', mensagem: 'Não foi possível falar com o servidor. Tente de novo.' };
  }
}

export const agendarReuniao = (oportunidadeId: string, agendadaPara: string) => enviar('/api/reunioes', { oportunidadeId, agendadaPara });
export const registrarNoShow = (id: string) => enviar(`/api/reunioes/${id}/no-show`, {});
export const concluirReuniao = (id: string, resumo: string, anexoId?: string) =>
  enviar(`/api/reunioes/${id}/concluir`, { resumo: resumo.trim() || undefined, anexoId });
export const reagendarReuniao = (id: string, agendadaPara: string) => enviar(`/api/reunioes/${id}/reagendar`, { agendadaPara });
export const cancelarReuniao = (id: string) => enviar(`/api/reunioes/${id}/cancelar`, {});
