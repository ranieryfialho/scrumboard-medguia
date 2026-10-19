// T-112 (fase3-etl-supabase, US-072/US-073): migra mensagens de WhatsApp e
// configurações das empresas do Supabase legado. Mesmo padrão de T-111
// (campanhas/envios): preserva o próprio `id` do legado — tanto em
// `whatsapp_mensagens` quanto em `empresa_configuracoes` o legado não tem
// `id_externo` separado — e usa esse `id` como `idExterno` em
// `migracao_registros` para a checagem de idempotência (AC-267).
//
// AC-263/AC-264: toda mensagem migra com direção, número, texto, status e
// horário originais (`criadoEm` é gravado explicitamente — nunca o
// `defaultNow()` do schema, que apagaria o horário real). O vínculo com o
// lead (`leadId`) só é preenchido quando o lead correspondente já foi
// migrado nesta execução (achado via `buscarIdDestino`, entidade `lead`,
// registrado por T-110); mensagem sem `leadId` no legado ou com `leadId`
// que não bate com nenhum lead migrado entra sem vínculo (`leadId: null`)
// — nunca bloqueia a migração — e conta para `semVinculo` (AC-264).
//
// AC-265: configuração migra para a mesma empresa, mesma chave, com o
// valor texto do legado virando o valor jsonb do destino — `valor` da
// coluna é `jsonb`, então gravar a string bruta do legado já faz essa
// conversão (o Postgres serializa a string como um JSON string válido).
import { buscarIdDestino, registrarMigracao, type ContextoExecucao, type TransacaoEtl } from '../comum';
import { empresaConfiguracoes, whatsappMensagens } from '../../db/schema';

export const ENTIDADE_MENSAGEM = 'mensagem_whatsapp';
export const ENTIDADE_CONFIGURACAO = 'configuracao_empresa';

export type DirecaoMensagem = 'enviada' | 'recebida';

export interface MensagemLegado {
  id: string;
  empresaId: string;
  /** Id do lead no legado, ou `null` quando a mensagem nunca teve vínculo (AC-264). */
  leadId: string | null;
  numero: string;
  mensagem: string;
  direcao: DirecaoMensagem;
  status: string;
  evolutionMessageId: string | null;
  lidaEm: Date | null;
  criadoEm: Date;
}

export interface ConfiguracaoLegado {
  id: string;
  empresaId: string;
  chave: string;
  valor: string;
}

export interface ResultadoMigracao {
  lidas: number;
  criadas: number;
  ignoradas: number;
}

export interface ResultadoMigracaoMensagens extends ResultadoMigracao {
  /** Quantas mensagens migraram sem vínculo com lead (AC-264). */
  semVinculo: number;
}

/**
 * Migra as mensagens de WhatsApp do legado (AC-263), resolvendo o vínculo
 * com o lead já migrado quando existir (AC-264). Idempotente: mensagem já
 * registrada em `migracao_registros` é ignorada, não duplicada (AC-267) —
 * como o `id` é preservado do legado, a constraint única de `(origem,
 * id_externo)` cobre reexecução.
 */
export async function migrarMensagens(
  tx: TransacaoEtl,
  contexto: ContextoExecucao,
  mensagensLegado: MensagemLegado[]
): Promise<ResultadoMigracaoMensagens> {
  let criadas = 0;
  let ignoradas = 0;
  let semVinculo = 0;

  for (const mensagem of mensagensLegado) {
    const existente = await buscarIdDestino(tx, contexto.origem, mensagem.id);
    if (existente) {
      ignoradas++;
      continue;
    }

    const leadIdDestino = mensagem.leadId
      ? await buscarIdDestino(tx, contexto.origem, mensagem.leadId)
      : undefined;

    if (!leadIdDestino) {
      semVinculo++;
    }

    await tx.insert(whatsappMensagens).values({
      id: mensagem.id,
      empresaId: mensagem.empresaId,
      leadId: leadIdDestino ?? null,
      numero: mensagem.numero,
      mensagem: mensagem.mensagem,
      direcao: mensagem.direcao,
      status: mensagem.status,
      evolutionMessageId: mensagem.evolutionMessageId,
      lidaEm: mensagem.lidaEm,
      criadoEm: mensagem.criadoEm,
    });

    await registrarMigracao(tx, contexto, {
      entidade: ENTIDADE_MENSAGEM,
      idExterno: mensagem.id,
      idDestino: mensagem.id,
    });
    criadas++;
  }

  return { lidas: mensagensLegado.length, criadas, ignoradas, semVinculo };
}

/**
 * Migra as configurações de empresa do legado (AC-265): mesma empresa,
 * mesma chave, valor texto do legado gravado na coluna jsonb do destino.
 * Idempotente pelo mesmo mecanismo das demais etapas (AC-267).
 */
export async function migrarConfiguracoes(
  tx: TransacaoEtl,
  contexto: ContextoExecucao,
  configuracoesLegado: ConfiguracaoLegado[]
): Promise<ResultadoMigracao> {
  let criadas = 0;
  let ignoradas = 0;

  for (const configuracao of configuracoesLegado) {
    const existente = await buscarIdDestino(tx, contexto.origem, configuracao.id);
    if (existente) {
      ignoradas++;
      continue;
    }

    await tx.insert(empresaConfiguracoes).values({
      id: configuracao.id,
      empresaId: configuracao.empresaId,
      chave: configuracao.chave,
      valor: configuracao.valor,
    });

    await registrarMigracao(tx, contexto, {
      entidade: ENTIDADE_CONFIGURACAO,
      idExterno: configuracao.id,
      idDestino: configuracao.id,
    });
    criadas++;
  }

  return { lidas: configuracoesLegado.length, criadas, ignoradas };
}
