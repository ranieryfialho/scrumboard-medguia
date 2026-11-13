// Próxima ação de um card, derivada da etapa e do que o CRM já sabe (reunião, cadência, data manual).
// Domínio puro: sem I/O e sem `Date.now()` — o relógio chega por parâmetro.

export const ETAPA_ENTRADA = 1;
export const ETAPA_QUALIFICANDO = 5;
export const ETAPA_QUALIFICADO_P_REUNIAO = 6;
export const ETAPA_REUNIAO_AGENDADA = 8;
export const ETAPA_NO_SHOW = 9;
export const ETAPA_PERDIDO = 14;
export const ETAPA_GANHO = 15;

/** Etapas em que a cadência de contato manda na próxima ação (1º, 2º e 3º dia). */
const ETAPAS_DE_CADENCIA: readonly number[] = [2, 3, 4];

export type TipoProximaAcao = 'reuniao' | 'remarcar' | 'toque' | 'aguardando_resposta' | 'iniciar_cadencia' | 'agendar_reuniao' | 'manual' | 'encerrado' | 'nenhuma';

export interface ReuniaoParaProximaAcao {
  agendadaPara: Date;
  meetUrl: string | null;
  encerradaEm: Date | null;
  noShow: boolean;
}

export interface ToqueParaProximaAcao {
  dia: 1 | 2 | 3;
  turno: 'manha' | 'tarde';
  tipo: 'ligacao' | 'mensagem' | 'breakup';
  /** Quando o toque foi liberado para o time (início do turno). */
  liberadaEm: Date | null;
  /** WhatsApp aguardando resposta: o prazo enquanto vale. */
  aguardandoAte: Date | null;
}

export interface EntradaProximaAcao {
  etapaId: number;
  agora: Date;
  /** `oportunidades.proxima_acao_em`: a data informada à mão ao mover o card. */
  proximaAcaoEm: Date | null;
  /** A reunião mais recente do card (só é consultada nas etapas 8 e 9). */
  reuniao: ReuniaoParaProximaAcao | null;
  /** O toque da vez da cadência (só é consultado nas etapas 1 a 7). */
  toqueDaVez: ToqueParaProximaAcao | null;
  cadenciaIniciada: boolean;
}

export interface ProximaAcao {
  tipo: TipoProximaAcao;
  titulo: string;
  detalhe: string | null;
  /** ISO do momento; `null` quando a ação não tem data. */
  quando: string | null;
  /** Quando `quando` é só o turno (a cadência trabalha por manhã/tarde), a UI mostra o período em vez da hora. */
  periodo: 'manha' | 'tarde' | null;
  vencida: boolean;
  /** Data de um fato que explica a ação (ex.: a reunião a que o lead faltou); a UI escreve "Reunião de dd/mm". */
  referenciaEm: string | null;
}

const ROTULO_DO_TOQUE: Record<ToqueParaProximaAcao['tipo'], string> = {
  ligacao: 'Ligar para o lead',
  mensagem: 'Enviar mensagem no WhatsApp',
  breakup: 'Enviar mensagem de despedida',
};

function montar(
  entrada: Pick<EntradaProximaAcao, 'agora'>,
  tipo: TipoProximaAcao,
  titulo: string,
  quando: Date | null,
  opcoes: { detalhe?: string | null; periodo?: 'manha' | 'tarde' | null; referenciaEm?: Date | null } = {}
): ProximaAcao {
  const periodo = opcoes.periodo ?? null;
  return {
    tipo,
    titulo,
    detalhe: opcoes.detalhe ?? null,
    quando: quando ? quando.toISOString() : null,
    periodo,
    // Só marca "vencida" quando há uma hora de verdade; o turno vencido é tratado pelo selo "atrasado" da cadência.
    vencida: quando !== null && periodo === null && quando.getTime() < entrada.agora.getTime(),
    referenciaEm: opcoes.referenciaEm ? opcoes.referenciaEm.toISOString() : null,
  };
}

function doToque(entrada: EntradaProximaAcao, toque: ToqueParaProximaAcao): ProximaAcao {
  const ondeNaRegua = `${toque.turno === 'manha' ? 'Manhã' : 'Tarde'} do ${toque.dia}º dia de contato`;
  if (toque.aguardandoAte) {
    return montar(entrada, 'aguardando_resposta', 'Aguardando resposta do lead', toque.aguardandoAte, { detalhe: ondeNaRegua });
  }
  return montar(entrada, 'toque', ROTULO_DO_TOQUE[toque.tipo], toque.liberadaEm, { detalhe: ondeNaRegua, periodo: toque.liberadaEm ? toque.turno : null });
}

function manual(entrada: EntradaProximaAcao): ProximaAcao | null {
  return entrada.proximaAcaoEm ? montar(entrada, 'manual', 'Próxima ação combinada', entrada.proximaAcaoEm) : null;
}

export function calcularProximaAcao(entrada: EntradaProximaAcao): ProximaAcao {
  const { etapaId, reuniao, toqueDaVez } = entrada;

  if (etapaId === ETAPA_GANHO) return montar(entrada, 'encerrado', 'Contrato fechado', null, { detalhe: 'Não há próxima ação.' });
  if (etapaId === ETAPA_PERDIDO) return montar(entrada, 'encerrado', 'Lead perdido', null, { detalhe: 'Não há próxima ação.' });

  if (etapaId === ETAPA_REUNIAO_AGENDADA) {
    if (reuniao && !reuniao.encerradaEm && !reuniao.noShow) {
      return montar(entrada, 'reuniao', 'Reunião marcada', reuniao.agendadaPara, { detalhe: reuniao.meetUrl ? 'Com link do Google Meet' : 'Sem link do Meet ainda' });
    }
    return manual(entrada) ?? montar(entrada, 'agendar_reuniao', 'Reunião sem data registrada', null, { detalhe: 'Marque a reunião na Agenda.' });
  }

  if (etapaId === ETAPA_NO_SHOW) {
    return montar(entrada, 'remarcar', 'Remarcar a reunião', entrada.proximaAcaoEm, {
      detalhe: 'O lead não compareceu.',
      referenciaEm: reuniao ? reuniao.agendadaPara : null,
    });
  }

  // Cadência: nos 3 dias de contato ela é a dona da próxima ação; nas demais, a data combinada à mão vem primeiro.
  if (ETAPAS_DE_CADENCIA.includes(etapaId) && toqueDaVez) return doToque(entrada, toqueDaVez);

  const combinada = manual(entrada);
  if (combinada) return combinada;

  if (toqueDaVez) return doToque(entrada, toqueDaVez);
  if (etapaId === ETAPA_ENTRADA && !entrada.cadenciaIniciada) {
    return montar(entrada, 'iniciar_cadencia', 'Iniciar a cadência de contato', null);
  }
  if (etapaId === ETAPA_QUALIFICADO_P_REUNIAO) return montar(entrada, 'agendar_reuniao', 'Agendar a reunião', null);

  return montar(entrada, 'nenhuma', 'Nenhuma próxima ação agendada', null);
}
