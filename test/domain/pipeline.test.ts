import { describe, expect, test } from 'vitest';

import { validarTransicao } from '../../src/domain/pipeline/validar-transicao';
import type {
  AtorTransicao,
  DadosTransicao,
  PipelineEtapa,
  PipelineTransicao,
} from '../../src/domain/pipeline/tipos';

const AGORA = new Date('2026-10-01T12:00:00-03:00');

function etapa(overrides: Partial<PipelineEtapa> = {}): PipelineEtapa {
  return {
    id: 11,
    exigeValor: false,
    exigeMotivo: false,
    exigeProximaAcao: false,
    exigeEvidencia: false,
    ...overrides,
  };
}

function transicao(overrides: Partial<PipelineTransicao> = {}): PipelineTransicao {
  return {
    etapaOrigemId: 10,
    etapaDestinoId: 11,
    exigeJustificativa: false,
    papeisPermitidos: ['MASTER', 'GERENTE', 'ATENDENTE'],
    ...overrides,
  };
}

function ator(overrides: Partial<AtorTransicao> = {}): AtorTransicao {
  return { papel: 'ATENDENTE', isSuperAdmin: false, ...overrides };
}

const SEM_DADOS: DadosTransicao = {};

// US-021 — Bloquear transição fora do grafo do playbook
describe('grafo de transições', () => {
  test('AC-048: transição sem registro no grafo é rejeitada @spec:AC-048', () => {
    const resultado = validarTransicao({
      transicoes: [transicao({ etapaOrigemId: 10, etapaDestinoId: 11 })],
      etapaOrigemId: 10,
      etapaDestino: etapa({ id: 12 }), // 10 -> 12 não está no grafo acima
      ator: ator(),
      dados: SEM_DADOS,
      agora: AGORA,
    });

    expect(resultado).toEqual({ ok: false, erro: 'TRANSICAO_NAO_PERMITIDA' });
  });

  test('AC-049: transição registrada no grafo passa a checagem de existência @spec:AC-049', () => {
    const resultado = validarTransicao({
      transicoes: [transicao({ etapaOrigemId: 10, etapaDestinoId: 11 })],
      etapaOrigemId: 10,
      etapaDestino: etapa({ id: 11 }),
      ator: ator(),
      dados: SEM_DADOS,
      agora: AGORA,
    });

    expect(resultado.ok ? undefined : resultado.erro).not.toBe('TRANSICAO_NAO_PERMITIDA');
  });
});

// US-022 — Bloquear transição por papel sem permissão
describe('papel do ator', () => {
  test('AC-050: papel fora da lista é rejeitado @spec:AC-050', () => {
    const resultado = validarTransicao({
      transicoes: [transicao({ papeisPermitidos: ['MASTER', 'GERENTE'] })],
      etapaOrigemId: 10,
      etapaDestino: etapa(),
      ator: ator({ papel: 'ATENDENTE', isSuperAdmin: false }),
      dados: SEM_DADOS,
      agora: AGORA,
    });

    expect(resultado).toEqual({ ok: false, erro: 'PAPEL_NAO_PERMITIDO' });
  });

  test('AC-051: papel presente na lista é aceito @spec:AC-051', () => {
    const resultado = validarTransicao({
      transicoes: [transicao({ papeisPermitidos: ['MASTER', 'GERENTE'] })],
      etapaOrigemId: 10,
      etapaDestino: etapa(),
      ator: ator({ papel: 'GERENTE', isSuperAdmin: false }),
      dados: SEM_DADOS,
      agora: AGORA,
    });

    expect(resultado.ok ? undefined : resultado.erro).not.toBe('PAPEL_NAO_PERMITIDO');
  });

  test('AC-052: super admin ignora papeis_permitidos @spec:AC-052', () => {
    const resultado = validarTransicao({
      transicoes: [transicao({ papeisPermitidos: ['MASTER'] })],
      etapaOrigemId: 10,
      etapaDestino: etapa(),
      ator: ator({ papel: 'ATENDENTE', isSuperAdmin: true }),
      dados: SEM_DADOS,
      agora: AGORA,
    });

    expect(resultado.ok ? undefined : resultado.erro).not.toBe('PAPEL_NAO_PERMITIDO');
  });
});

// US-023 — Exigir os dados obrigatórios de cada etapa antes de mover o card
describe('guards de dados obrigatórios da etapa de destino', () => {
  test('AC-053: valor obrigatório ausente ou <= 0 é rejeitado @spec:AC-053', () => {
    const transicoes = [transicao()];
    const destino = etapa({ exigeValor: true });

    const semValor = validarTransicao({
      transicoes,
      etapaOrigemId: 10,
      etapaDestino: destino,
      ator: ator(),
      dados: {},
      agora: AGORA,
    });
    const valorZero = validarTransicao({
      transicoes,
      etapaOrigemId: 10,
      etapaDestino: destino,
      ator: ator(),
      dados: { valor: 0 },
      agora: AGORA,
    });

    expect(semValor).toEqual({ ok: false, erro: 'VALOR_OBRIGATORIO' });
    expect(valorZero).toEqual({ ok: false, erro: 'VALOR_OBRIGATORIO' });
  });

  test('AC-054: valor positivo é aceito @spec:AC-054', () => {
    const resultado = validarTransicao({
      transicoes: [transicao()],
      etapaOrigemId: 10,
      etapaDestino: etapa({ exigeValor: true }),
      ator: ator(),
      dados: { valor: 1290 },
      agora: AGORA,
    });

    expect(resultado.ok ? undefined : resultado.erro).not.toBe('VALOR_OBRIGATORIO');
  });

  test('AC-055: motivo de perda ausente é rejeitado @spec:AC-055', () => {
    const resultado = validarTransicao({
      transicoes: [transicao()],
      etapaOrigemId: 10,
      etapaDestino: etapa({ exigeMotivo: true }),
      ator: ator(),
      dados: {},
      agora: AGORA,
    });

    expect(resultado).toEqual({ ok: false, erro: 'MOTIVO_PERDA_OBRIGATORIO' });
  });

  test('AC-056: motivo de perda presente é aceito @spec:AC-056', () => {
    const resultado = validarTransicao({
      transicoes: [transicao()],
      etapaOrigemId: 10,
      etapaDestino: etapa({ exigeMotivo: true }),
      ator: ator(),
      dados: { motivoPerdaId: 'motivo-1' },
      agora: AGORA,
    });

    expect(resultado.ok ? undefined : resultado.erro).not.toBe('MOTIVO_PERDA_OBRIGATORIO');
  });

  test('AC-057: próxima ação ausente ou no passado é rejeitada @spec:AC-057', () => {
    const transicoes = [transicao()];
    const destino = etapa({ exigeProximaAcao: true });

    const semProximaAcao = validarTransicao({
      transicoes,
      etapaOrigemId: 10,
      etapaDestino: destino,
      ator: ator(),
      dados: {},
      agora: AGORA,
    });
    const proximaAcaoPassada = validarTransicao({
      transicoes,
      etapaOrigemId: 10,
      etapaDestino: destino,
      ator: ator(),
      dados: { proximaAcaoEm: new Date(AGORA.getTime() - 60_000) },
      agora: AGORA,
    });

    expect(semProximaAcao).toEqual({ ok: false, erro: 'PROXIMA_ACAO_OBRIGATORIA' });
    expect(proximaAcaoPassada).toEqual({ ok: false, erro: 'PROXIMA_ACAO_OBRIGATORIA' });
  });

  test('AC-058: próxima ação futura é aceita @spec:AC-058', () => {
    const resultado = validarTransicao({
      transicoes: [transicao()],
      etapaOrigemId: 10,
      etapaDestino: etapa({ exigeProximaAcao: true }),
      ator: ator(),
      dados: { proximaAcaoEm: new Date(AGORA.getTime() + 60_000) },
      agora: AGORA,
    });

    expect(resultado.ok ? undefined : resultado.erro).not.toBe('PROXIMA_ACAO_OBRIGATORIA');
  });

  test('AC-059: evidência obrigatória ausente é rejeitada @spec:AC-059', () => {
    const resultado = validarTransicao({
      transicoes: [transicao()],
      etapaOrigemId: 10,
      etapaDestino: etapa({ exigeEvidencia: true }),
      ator: ator(),
      dados: {},
      agora: AGORA,
    });

    expect(resultado).toEqual({ ok: false, erro: 'EVIDENCIA_OBRIGATORIA' });
  });

  test('AC-060: evidência presente é aceita @spec:AC-060', () => {
    const resultado = validarTransicao({
      transicoes: [transicao()],
      etapaOrigemId: 10,
      etapaDestino: etapa({ exigeEvidencia: true }),
      ator: ator(),
      dados: { anexoId: 'anexo-1' },
      agora: AGORA,
    });

    expect(resultado.ok ? undefined : resultado.erro).not.toBe('EVIDENCIA_OBRIGATORIA');
  });
});

// US-024 — Exigir justificativa para reabrir um card terminal
describe('justificativa de reabertura', () => {
  test('AC-061: reabertura sem justificativa é rejeitada @spec:AC-061', () => {
    const transicoes = [transicao({ exigeJustificativa: true })];

    const semJustificativa = validarTransicao({
      transicoes,
      etapaOrigemId: 10,
      etapaDestino: etapa(),
      ator: ator(),
      dados: {},
      agora: AGORA,
    });
    const justificativaEmBranco = validarTransicao({
      transicoes,
      etapaOrigemId: 10,
      etapaDestino: etapa(),
      ator: ator(),
      dados: { justificativa: '   ' },
      agora: AGORA,
    });

    expect(semJustificativa).toEqual({ ok: false, erro: 'JUSTIFICATIVA_OBRIGATORIA' });
    expect(justificativaEmBranco).toEqual({ ok: false, erro: 'JUSTIFICATIVA_OBRIGATORIA' });
  });

  test('AC-062: reabertura com justificativa preenchida é aceita @spec:AC-062', () => {
    const resultado = validarTransicao({
      transicoes: [transicao({ exigeJustificativa: true })],
      etapaOrigemId: 10,
      etapaDestino: etapa(),
      ator: ator(),
      dados: { justificativa: 'Cliente retomou contato, negociação reaberta.' },
      agora: AGORA,
    });

    expect(resultado).toEqual({ ok: true });
  });
});

// US-025 — Reportar sempre uma única causa de rejeição, numa ordem previsível
describe('ordem determinística de erro', () => {
  test('AC-063: só a primeira regra violada é reportada (grafo → papel → dados obrigatórios → justificativa) @spec:AC-063', () => {
    const foraDoGrafo = validarTransicao({
      transicoes: [transicao({ etapaOrigemId: 10, etapaDestinoId: 11, papeisPermitidos: [] })],
      etapaOrigemId: 10,
      etapaDestino: etapa({ id: 999, exigeValor: true }), // 10 -> 999 não existe
      ator: ator({ papel: 'ATENDENTE' }), // também seria barrado por papel, se a transição existisse
      dados: {}, // e também violaria o guard de valor
      agora: AGORA,
    });
    expect(foraDoGrafo).toEqual({ ok: false, erro: 'TRANSICAO_NAO_PERMITIDA' });

    const papelSemPermissaoEGuardViolado = validarTransicao({
      transicoes: [transicao({ papeisPermitidos: ['MASTER'] })],
      etapaOrigemId: 10,
      etapaDestino: etapa({ exigeValor: true }), // guard também violado (sem valor)
      ator: ator({ papel: 'ATENDENTE' }),
      dados: {},
      agora: AGORA,
    });
    expect(papelSemPermissaoEGuardViolado).toEqual({ ok: false, erro: 'PAPEL_NAO_PERMITIDO' });
  });

  test('AC-064: quando todas as regras aplicáveis passam, retorna sucesso sem erro @spec:AC-064', () => {
    const resultado = validarTransicao({
      transicoes: [transicao({ papeisPermitidos: ['GERENTE'], exigeJustificativa: false })],
      etapaOrigemId: 10,
      etapaDestino: etapa({ exigeValor: true, exigeMotivo: false }),
      ator: ator({ papel: 'GERENTE' }),
      dados: { valor: 500 },
      agora: AGORA,
    });

    expect(resultado).toEqual({ ok: true });
  });
});
