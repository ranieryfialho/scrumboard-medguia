// T-036/T-037 (fase1-dominio-pipeline, US-023/US-024): guards de dados
// obrigatórios da etapa de destino (AC-053 a AC-060) e da justificativa de
// reabertura (AC-061/AC-062). `agora` é recebido como parâmetro — nunca
// `new Date()` interno — para o guard de "próxima ação no passado" ser
// determinístico em teste (ASM-013).
import type { CodigoErroTransicao, DadosTransicao, PipelineEtapa, PipelineTransicao } from './tipos';

export function validarGuardsDestino(
  etapaDestino: PipelineEtapa,
  dados: DadosTransicao,
  agora: Date
): CodigoErroTransicao | null {
  if (etapaDestino.exigeValor && !(typeof dados.valor === 'number' && dados.valor > 0)) {
    return 'VALOR_OBRIGATORIO';
  }

  if (etapaDestino.exigeMotivo && !dados.motivoPerdaId) {
    return 'MOTIVO_PERDA_OBRIGATORIO';
  }

  if (
    etapaDestino.exigeProximaAcao &&
    !(dados.proximaAcaoEm instanceof Date && dados.proximaAcaoEm.getTime() > agora.getTime())
  ) {
    return 'PROXIMA_ACAO_OBRIGATORIA';
  }

  if (etapaDestino.exigeEvidencia && !dados.anexoId) {
    return 'EVIDENCIA_OBRIGATORIA';
  }

  return null;
}

export function validarJustificativa(
  transicao: PipelineTransicao,
  dados: DadosTransicao
): CodigoErroTransicao | null {
  if (transicao.exigeJustificativa && !dados.justificativa?.trim()) {
    return 'JUSTIFICATIVA_OBRIGATORIA';
  }

  return null;
}
