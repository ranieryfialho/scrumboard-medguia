// T-111 (fase3-etl-supabase, US-071): migra campanhas e envios do Supabase
// legado. Como `campanhas`/`envios_campanha` não têm coluna `id_externo`
// (ao contrário de `leads`), a migração preserva o próprio `id` do legado —
// mesmo padrão de T-109 (empresa/usuário) — e usa esse `id` como `idExterno`
// em `migracao_registros` para a checagem de idempotência (AC-267).
//
// AC-262 é o ponto central desta tarefa: uma campanha que estava
// `PROCESSANDO` no legado sempre migra como `FINALIZADA` (Q-029 — o
// disparador novo só consome envio `PENDENTE`, e `FINALIZADA` é estado
// terminal), e qualquer envio dela que ainda estivesse `PENDENTE` ou
// `RASCUNHO` — ou seja, nunca chegou a sair no legado — migra como `ERRO`
// em vez do status original, para nunca ficar elegível ao disparador novo.
// Campanha que já não estava `PROCESSANDO` (RASCUNHO/FINALIZADA) migra com
// o status original e os envios dela preservam o status original tal como
// vieram (AC-261).
import { buscarIdDestino, registrarMigracao, type ContextoExecucao, type TransacaoEtl } from '../comum';
import { campanhas, enviosCampanha } from '../../db/schema';

export const ENTIDADE_CAMPANHA = 'campanha';
export const ENTIDADE_ENVIO_CAMPANHA = 'envio_campanha';

const STATUS_CAMPANHA_PROCESSANDO = 'PROCESSANDO';
const STATUS_CAMPANHA_FINALIZADA = 'FINALIZADA';
const STATUS_ENVIO_NAO_DISPARADO = new Set(['PENDENTE', 'RASCUNHO']);
const STATUS_ENVIO_ERRO = 'ERRO';

export interface CampanhaLegado {
  id: string;
  empresaId: string;
  nome: string;
  assunto: string;
  corpoHtml: string;
  status: string;
  criadoPor: string | null;
}

export interface EnvioLegado {
  id: string;
  empresaId: string;
  campanhaId: string;
  nomeDestinatario: string;
  emailDestinatario: string;
  status: string;
  tentativas: number;
}

export interface ResultadoMigracao {
  lidas: number;
  criadas: number;
  ignoradas: number;
}

export interface ResultadoMigracaoCampanhas {
  campanhas: ResultadoMigracao;
  envios: ResultadoMigracao;
}

/**
 * Migra campanhas e envios do legado, ligados entre si (AC-261) e com a
 * campanha `PROCESSANDO` nunca voltando a disparar depois da migração
 * (AC-262). Idempotente: campanha ou envio já registrado em
 * `migracao_registros` é ignorado, não duplicado (AC-267) — e, como os dois
 * ids são preservados do legado, a constraint única de `(origem,
 * id_externo)` cobre reexecução mesmo sem checar o conteúdo de novo.
 */
export async function migrarCampanhas(
  tx: TransacaoEtl,
  contexto: ContextoExecucao,
  campanhasLegado: CampanhaLegado[],
  enviosLegado: EnvioLegado[]
): Promise<ResultadoMigracaoCampanhas> {
  const estavaProcessandoPorCampanhaId = new Map(
    campanhasLegado.map((campanha) => [campanha.id, campanha.status === STATUS_CAMPANHA_PROCESSANDO])
  );

  let campanhasCriadas = 0;
  let campanhasIgnoradas = 0;

  for (const campanha of campanhasLegado) {
    const existente = await buscarIdDestino(tx, contexto.origem, campanha.id);
    if (existente) {
      campanhasIgnoradas++;
      continue;
    }

    const statusDestino =
      campanha.status === STATUS_CAMPANHA_PROCESSANDO ? STATUS_CAMPANHA_FINALIZADA : campanha.status;

    await tx.insert(campanhas).values({
      id: campanha.id,
      empresaId: campanha.empresaId,
      nome: campanha.nome,
      assunto: campanha.assunto,
      corpoHtml: campanha.corpoHtml,
      status: statusDestino,
      criadoPor: campanha.criadoPor,
    });

    await registrarMigracao(tx, contexto, {
      entidade: ENTIDADE_CAMPANHA,
      idExterno: campanha.id,
      idDestino: campanha.id,
    });
    campanhasCriadas++;
  }

  let enviosCriados = 0;
  let enviosIgnorados = 0;

  for (const envio of enviosLegado) {
    const existente = await buscarIdDestino(tx, contexto.origem, envio.id);
    if (existente) {
      enviosIgnorados++;
      continue;
    }

    const campanhaEstavaProcessando = estavaProcessandoPorCampanhaId.get(envio.campanhaId) ?? false;
    const statusDestino =
      campanhaEstavaProcessando && STATUS_ENVIO_NAO_DISPARADO.has(envio.status)
        ? STATUS_ENVIO_ERRO
        : envio.status;

    await tx.insert(enviosCampanha).values({
      id: envio.id,
      empresaId: envio.empresaId,
      campanhaId: envio.campanhaId,
      nomeDestinatario: envio.nomeDestinatario,
      emailDestinatario: envio.emailDestinatario,
      status: statusDestino,
      tentativas: envio.tentativas,
    });

    await registrarMigracao(tx, contexto, {
      entidade: ENTIDADE_ENVIO_CAMPANHA,
      idExterno: envio.id,
      idDestino: envio.id,
    });
    enviosCriados++;
  }

  return {
    campanhas: { lidas: campanhasLegado.length, criadas: campanhasCriadas, ignoradas: campanhasIgnoradas },
    envios: { lidas: enviosLegado.length, criadas: enviosCriados, ignoradas: enviosIgnorados },
  };
}
