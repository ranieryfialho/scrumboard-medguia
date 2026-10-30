// T-196 (fase4-campanhas, US-129/US-130): leitura da lista de campanhas com as
// contagens por status e os indicadores (AC-533, AC-534) e a prévia de
// destinatários por etapas (AC-540). Sempre por empresa (RLS + filtro
// explícito). O CRM só lê aqui: quem grava ENVIADO/ERRO é o motor externo.
import { and, desc, eq, gte, inArray, isNotNull, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { campanhas, enviosCampanha, leads, oportunidades } from '../db/schema';
import { dataLocalEmSaoPaulo } from '../domain/cadencia/turno';
import type { ContextoTenant } from '../lib/auth/tenant';
import { comTenant } from './contexto';
import { emailsDescadastrados } from './email-descadastros';
import { normalizarDestinatarios, type Campanha } from './campanhas';

export type FiltroStatusCampanha = 'rascunho' | 'enviando' | 'concluida';

const STATUS_DA_CAMPANHA: Record<FiltroStatusCampanha, string> = {
  rascunho: 'RASCUNHO',
  enviando: 'PROCESSANDO',
  concluida: 'FINALIZADA',
};

export interface ContagensDaCampanha {
  rascunho: number;
  pendente: number;
  enviado: number;
  aberto: number;
  clicado: number;
  erro: number;
  /** fase5-email-disparo (AC-712): o worker está enviando agora. */
  enviando: number;
  /** AC-709: pendentes parados pela pausa da campanha. */
  pausado: number;
  /** AC-722: quem a empresa descadastrou; não é falha. */
  descadastrado: number;
}

const VAZIA: ContagensDaCampanha = { rascunho: 0, pendente: 0, enviado: 0, aberto: 0, clicado: 0, erro: 0, enviando: 0, pausado: 0, descadastrado: 0 };

const CHAVE_DO_STATUS: Record<string, keyof ContagensDaCampanha> = {
  RASCUNHO: 'rascunho',
  PENDENTE: 'pendente',
  ENVIADO: 'enviado',
  ABERTO: 'aberto',
  CLICADO: 'clicado',
  ERRO: 'erro',
  ENVIANDO: 'enviando',
  PAUSADO: 'pausado',
  DESCADASTRADO: 'descadastrado',
};

export interface ResumoDasCampanhas {
  disparosNoMes: number;
  taxaEntrega: number | null;
  taxaAbertura: number | null;
  taxaCliques: number | null;
}

export interface ItemDaLista {
  campanha: Campanha;
  totalDestinatarios: number;
  contagens: ContagensDaCampanha;
}

export interface ListaDeCampanhas {
  itens: ItemDaLista[];
  /** Total depois dos filtros (antes da paginação). */
  total: number;
  resumo: ResumoDasCampanhas;
}

export interface FiltroLista {
  status?: FiltroStatusCampanha;
  busca?: string;
  dias?: number;
  pagina?: number;
  porPagina?: number;
  agora: Date;
}

/** Porcentagem com uma casa decimal, ou `null` sem base (AC-534). */
function porcentagem(parte: number, total: number): number | null {
  return total > 0 ? Math.round((parte / total) * 1000) / 10 : null;
}

/** "Enviado" para as taxas = ENVIADO, ABERTO ou CLICADO (ASM-182). */
export function calcularResumo(contagens: ContagensDaCampanha, disparosNoMes: number): ResumoDasCampanhas {
  const enviados = contagens.enviado + contagens.aberto + contagens.clicado;
  return {
    disparosNoMes,
    taxaEntrega: porcentagem(enviados, enviados + contagens.erro),
    taxaAbertura: porcentagem(contagens.aberto + contagens.clicado, enviados),
    taxaCliques: porcentagem(contagens.clicado, enviados),
  };
}

export async function listarCampanhasComResumo(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  filtro: FiltroLista
): Promise<ListaDeCampanhas> {
  const local = dataLocalEmSaoPaulo(filtro.agora);
  const inicioDoMes = new Date(Date.UTC(local.ano, local.mes - 1, 1, 3));

  return comTenant(db, contexto, async (tx) => {
    const todas = await tx
      .select()
      .from(campanhas)
      .where(eq(campanhas.empresaId, contexto.empresaId))
      .orderBy(desc(campanhas.criadoEm), desc(campanhas.id));

    const linhas = await tx
      .select({ campanhaId: enviosCampanha.campanhaId, status: enviosCampanha.status, total: sql<number>`count(*)::int` })
      .from(enviosCampanha)
      .where(eq(enviosCampanha.empresaId, contexto.empresaId))
      .groupBy(enviosCampanha.campanhaId, enviosCampanha.status);

    const [{ disparosNoMes }] = await tx
      .select({ disparosNoMes: sql<number>`count(*)::int` })
      .from(enviosCampanha)
      .where(and(eq(enviosCampanha.empresaId, contexto.empresaId), isNotNull(enviosCampanha.enviadoEm), gte(enviosCampanha.enviadoEm, inicioDoMes)));

    const porCampanha = new Map<string, ContagensDaCampanha>();
    const geral: ContagensDaCampanha = { ...VAZIA };
    for (const l of linhas) {
      const chave = CHAVE_DO_STATUS[l.status];
      if (!chave) continue;
      const c = porCampanha.get(l.campanhaId) ?? { ...VAZIA };
      c[chave] += l.total;
      porCampanha.set(l.campanhaId, c);
      geral[chave] += l.total;
    }

    const termo = filtro.busca?.trim().toLowerCase();
    const limite = filtro.dias ? filtro.agora.getTime() - filtro.dias * 86_400_000 : null;
    let filtradas = todas.filter((c) => {
      if (filtro.status && c.status !== STATUS_DA_CAMPANHA[filtro.status]) return false;
      if (termo && !c.nome.toLowerCase().includes(termo) && !c.assunto.toLowerCase().includes(termo)) return false;
      if (limite !== null && c.criadoEm.getTime() < limite) return false;
      return true;
    });
    const total = filtradas.length;
    if (filtro.pagina && filtro.porPagina) {
      filtradas = filtradas.slice((filtro.pagina - 1) * filtro.porPagina, filtro.pagina * filtro.porPagina);
    }

    const itens = filtradas.map((campanha) => {
      const contagens = porCampanha.get(campanha.id) ?? { ...VAZIA };
      const totalDestinatarios = Object.values(contagens).reduce((a, b) => a + b, 0);
      return { campanha, totalDestinatarios, contagens };
    });

    return { itens, total, resumo: calcularResumo(geral, disparosNoMes) };
  });
}

export interface PreviaDeDestinatarios {
  porEtapa: { etapaId: number; total: number }[];
  total: number;
  valorEmPipeline: number;
  /** fase5-email-descadastro (AC-718): e-mails da seleção que a empresa já descadastrou — ficam fora de `total`. */
  descadastrados: number;
}

/** AC-540: quantos leads com e-mail válido cada etapa tem, o total único e o valor em pipeline (ASM-187). */
export async function preverDestinatarios(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  etapaIds: number[]
): Promise<PreviaDeDestinatarios> {
  return comTenant(db, contexto, async (tx) => {
    const condicoes: SQL[] = [
      eq(oportunidades.empresaId, contexto.empresaId),
      eq(leads.empresaId, contexto.empresaId),
      inArray(oportunidades.etapaId, etapaIds),
      isNotNull(leads.email),
    ];
    const linhas = await tx
      .select({ etapaId: oportunidades.etapaId, leadId: leads.id, nome: leads.nome, email: leads.email, valor: oportunidades.valor })
      .from(oportunidades)
      .innerJoin(leads, eq(oportunidades.leadId, leads.id))
      .where(and(...condicoes));

    const comEmail = linhas.filter((l) => l.email !== null && l.email.trim() !== '');
    const fora = await emailsDescadastrados(tx, contexto.empresaId, comEmail.map((l) => l.email as string));
    const validos = (contatos: { nome: string; email: string }[]) => normalizarDestinatarios(contatos).destinatarios.filter((d) => !fora.has(d.email));
    const descadastrados = normalizarDestinatarios(comEmail.map((l) => ({ nome: l.nome, email: l.email as string }))).destinatarios.filter((d) => fora.has(d.email)).length;

    const porEtapa = etapaIds.map((etapaId) => ({
      etapaId,
      total: validos(comEmail.filter((l) => l.etapaId === etapaId).map((l) => ({ nome: l.nome, email: l.email as string }))).length,
    }));
    const total = validos(comEmail.map((l) => ({ nome: l.nome, email: l.email as string }))).length;

    const emailsValidos = new Set(validos(comEmail.map((l) => ({ nome: l.nome, email: l.email as string }))).map((d) => d.email));
    const leadsContados = new Set<string>();
    let valorEmPipeline = 0;
    for (const l of comEmail) {
      if (leadsContados.has(l.leadId) || !emailsValidos.has((l.email as string).trim().toLowerCase())) continue;
      leadsContados.add(l.leadId);
      valorEmPipeline += l.valor === null ? 0 : Number(l.valor);
    }

    return { porEtapa, total, valorEmPipeline, descadastrados };
  });
}
