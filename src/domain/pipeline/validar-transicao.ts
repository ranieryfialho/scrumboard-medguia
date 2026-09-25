// T-038 (fase1-dominio-pipeline, US-025, AC-063/AC-064): orquestra T-034 a
// T-037 numa ordem fixa — grafo → papel → guards de destino → justificativa
// — e para no primeiro erro, para que a resposta HTTP (TDD-001 §4.6) mostre
// sempre um único código de erro nomeado por vez.
import { encontrarTransicao } from './grafo';
import { validarGuardsDestino, validarJustificativa } from './guards';
import { papelPodeTransicionar } from './papel';
import type { AtorTransicao, DadosTransicao, PipelineEtapa, PipelineTransicao, ResultadoValidacao } from './tipos';

export interface ValidarTransicaoInput {
  transicoes: readonly PipelineTransicao[];
  etapaOrigemId: number;
  etapaDestino: PipelineEtapa;
  ator: AtorTransicao;
  dados: DadosTransicao;
  /** Instante de referência para os guards de data (ex.: próxima ação futura). Default: `new Date()`. */
  agora?: Date;
}

export function validarTransicao(input: ValidarTransicaoInput): ResultadoValidacao {
  const transicao = encontrarTransicao(input.transicoes, input.etapaOrigemId, input.etapaDestino.id);
  if (!transicao) {
    return { ok: false, erro: 'TRANSICAO_NAO_PERMITIDA' };
  }

  if (!papelPodeTransicionar(transicao.papeisPermitidos, input.ator)) {
    return { ok: false, erro: 'PAPEL_NAO_PERMITIDO' };
  }

  const agora = input.agora ?? new Date();
  const erroGuard = validarGuardsDestino(input.etapaDestino, input.dados, agora);
  if (erroGuard) {
    return { ok: false, erro: erroGuard };
  }

  const erroJustificativa = validarJustificativa(transicao, input.dados);
  if (erroJustificativa) {
    return { ok: false, erro: erroJustificativa };
  }

  return { ok: true };
}
