// T-266 (fase5-email-disparo, US-171, AC-701..AC-707, ASM-261/ASM-262): um ciclo do worker de e-mail das campanhas.
// Por empresa ativa, uma de cada vez e com falha isolada: recupera o que ficou `ENVIANDO` (AC-707), pega até 10 envios
// `PENDENTE` das campanhas em andamento (AC-701), manda cada um com a chave e o remetente DA EMPRESA esperando 2 s entre
// um e outro (AC-702), grava o resultado (AC-703) e finaliza as campanhas concluídas (AC-706). Sem chave, os pendentes viram
// `ERRO` `SEM_CHAVE_RESEND` (AC-704). Relógio, sono e transporte são injetáveis (testes sem Resend real).
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { empresas } from '../../db/schema';
import {
  ENVIOS_POR_CICLO,
  finalizarCampanhasConcluidas,
  marcarSemChave,
  pegarEnvios,
  recuperarInterrompidos,
  registrarEnviado,
  registrarFalha,
  type EnvioParaEnviar,
} from '../../repositories/campanhas-envio';
import { lerConfiguracaoDeEmail } from '../../repositories/email-config';
import { segredoDeConfiguracoes } from '../seguranca/cifra';
import { transporteResendDeCampanha, type TransporteDeCampanha } from './campanha-envio';
import { renderizarCorpoDeCampanha } from './campanha-corpo';
import { cabecalhosDeDescadastro, prepararCorpoComDescadastro } from './descadastro-rodape';
import { linkDeDescadastro } from './descadastro-token';

export const INTERVALO_ENTRE_ENVIOS_MS = 2_000;
export const INTERVALO_DO_CICLO_MS = 10_000;
const BASE_URL_PADRAO = 'https://app.medguia.cloud';

export interface OpcoesDoDisparo {
  agora?: () => Date;
  dormir?: (ms: number) => Promise<void>;
  transporte?: TransporteDeCampanha;
  /** O segredo que decifra a chave de cada empresa e assina o link de descadastro. */
  segredo?: string | null;
  baseUrl?: string;
}

export interface ResumoDoDisparo {
  empresas: number;
  enviados: number;
  falhas: number;
  descadastrados: number;
  semChave: number;
  interrompidos: number;
  finalizadas: number;
  /** Empresas cujo ciclo deu erro inesperado (as demais seguem). */
  empresasComErro: number;
}

type Dependencias = Required<OpcoesDoDisparo>;

async function enviarUm(db: NodePgDatabase, empresaId: string, envio: EnvioParaEnviar, config: { apiKey: string; remetente: string | null; replyTo?: string }, d: Dependencias, segredo: string): Promise<boolean> {
  const link = linkDeDescadastro(d.baseUrl, empresaId, envio.email, segredo);
  const html = prepararCorpoComDescadastro(renderizarCorpoDeCampanha(envio.corpoHtml, envio.nome), link);
  const resultado = await d
    .transporte({ apiKey: config.apiKey, remetente: config.remetente, ...(config.replyTo ? { replyTo: config.replyTo } : {}), destinatario: envio.email, assunto: envio.assunto, html, cabecalhos: cabecalhosDeDescadastro(link), envioId: envio.id, empresaId })
    .catch((): { ok: false; erro: 'FALHA_DE_REDE' } => ({ ok: false, erro: 'FALHA_DE_REDE' }));
  if (resultado.ok) await registrarEnviado(db, empresaId, envio.id, d.agora());
  else await registrarFalha(db, empresaId, envio.id, resultado.erro);
  return resultado.ok;
}

async function cicloDaEmpresa(db: NodePgDatabase, empresaId: string, d: Dependencias, resumo: ResumoDoDisparo): Promise<void> {
  resumo.interrompidos += await recuperarInterrompidos(db, empresaId, d.agora());

  const segredo = d.segredo;
  const config = segredo ? await lerConfiguracaoDeEmail(db, empresaId, segredo) : null;
  if (!segredo || !config) {
    resumo.semChave += await marcarSemChave(db, empresaId);
  } else {
    const { paraEnviar, descadastrados } = await pegarEnvios(db, empresaId, d.agora(), ENVIOS_POR_CICLO);
    resumo.descadastrados += descadastrados;
    for (const [indice, envio] of paraEnviar.entries()) {
      try {
        if (await enviarUm(db, empresaId, envio, config, d, segredo)) resumo.enviados += 1;
        else resumo.falhas += 1;
      } catch {
        // o resultado não foi gravado: o envio fica `ENVIANDO` e a recuperação o marca `INTERROMPIDO` (AC-707)
        resumo.falhas += 1;
      }
      if (indice < paraEnviar.length - 1) await d.dormir(INTERVALO_ENTRE_ENVIOS_MS);
    }
  }
  resumo.finalizadas += await finalizarCampanhasConcluidas(db, empresaId);
}

/** Um ciclo: todas as empresas ativas, uma por vez; o erro de uma não impede as outras (AC-703/AC-704). */
export async function rodarCicloDeEmail(db: NodePgDatabase, opcoes: OpcoesDoDisparo = {}): Promise<ResumoDoDisparo> {
  const d: Dependencias = {
    agora: opcoes.agora ?? (() => new Date()),
    dormir: opcoes.dormir ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    transporte: opcoes.transporte ?? transporteResendDeCampanha,
    segredo: opcoes.segredo === undefined ? segredoDeConfiguracoes() : opcoes.segredo,
    baseUrl: opcoes.baseUrl ?? (process.env['APP_URL'] || process.env.NEXT_PUBLIC_APP_URL) ?? BASE_URL_PADRAO,
  };
  const ativas = await db.select({ id: empresas.id }).from(empresas).where(eq(empresas.ativo, true));
  const resumo: ResumoDoDisparo = { empresas: ativas.length, enviados: 0, falhas: 0, descadastrados: 0, semChave: 0, interrompidos: 0, finalizadas: 0, empresasComErro: 0 };
  for (const { id } of ativas) {
    try {
      await cicloDaEmpresa(db, id, d, resumo);
    } catch {
      resumo.empresasComErro += 1;
    }
  }
  return resumo;
}
