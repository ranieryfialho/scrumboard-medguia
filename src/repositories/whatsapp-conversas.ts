// T-189 (fase4-whatsapp, US-124): lista de conversas da caixa de entrada e
// "marcar todas como lidas". A conversa é a mesma unidade das não lidas
// (ASM-171): uma por lead (todos os telefones) ou por número canônico. As
// mensagens mais recentes (até `LIMITE_MENSAGENS`) são agrupadas aqui em memória —
// o agrupamento por número canônico (nono dígito) não existe em SQL.
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { leads, oportunidades, usuarios, whatsappAvulsos, whatsappMensagens } from '../db/schema';
import { dataLocalEmSaoPaulo } from '../domain/cadencia/turno';
import type { ContextoTenant } from '../lib/auth/tenant';
import { comTenant } from './contexto';
import { chaveCanonicaNumero } from './whatsapp';

const LIMITE_MENSAGENS = 5000;
const LIMITE_PADRAO = 100;
const LIMITE_MAXIMO = 200;

export type FiltroConversas = 'nao_lidas' | 'minhas' | 'todas' | 'avulsas';

export interface ConversaDaCaixa {
  chave: string;
  leadId: string | null;
  numero: string;
  nome: string | null;
  /** T-303: motivo da abordagem, só nas avulsas que informaram. */
  categoria?: string | null;
  ultimaMensagem: string;
  ultimaEm: string;
  ultimaDirecao: 'enviada' | 'recebida';
  naoLidas: number;
  /** Já houve ao menos uma mensagem recebida nesta conversa. */
  respondida: boolean;
  card: {
    id: string;
    etapaId: number;
    valor: string | null;
    responsavel: { id: string; nome: string } | null;
  } | null;
}

export interface RespostaConversas {
  conversas: ConversaDaCaixa[];
  contagens: { naoLidas: number; minhas: number; todas: number };
  resumo: {
    ativasHoje: number;
    naoLidas: number;
    mensagensHoje: { recebidas: number; enviadas: number };
  };
}

export interface OpcoesConversas {
  filtro: FiltroConversas;
  busca?: string;
  /** Só MASTER/GERENTE: restringe aos cards desta pessoa. */
  responsavelId?: string;
  /** ATENDENTE: só os cards dele, as avulsas e as de leads sem card (ASM-173). */
  somenteDoUsuario: boolean;
  limite?: number;
  agora: Date;
}

function inicioDoDia(agora: Date): number {
  const l = dataLocalEmSaoPaulo(agora);
  return Date.UTC(l.ano, l.mes - 1, l.dia, 3);
}

export async function listarConversas(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  opcoes: OpcoesConversas
): Promise<RespostaConversas> {
  const hoje = inicioDoDia(opcoes.agora);

  return comTenant(db, contexto, async (tx) => {
    const mensagens = await tx
      .select({
        leadId: whatsappMensagens.leadId,
        numero: whatsappMensagens.numero,
        mensagem: whatsappMensagens.mensagem,
        direcao: whatsappMensagens.direcao,
        lidaEm: whatsappMensagens.lidaEm,
        criadoEm: whatsappMensagens.criadoEm,
        leadNome: leads.nome,
      })
      .from(whatsappMensagens)
      .leftJoin(leads, eq(whatsappMensagens.leadId, leads.id))
      .where(eq(whatsappMensagens.empresaId, contexto.empresaId))
      .orderBy(desc(whatsappMensagens.criadoEm))
      .limit(LIMITE_MENSAGENS);

    interface Acumulada extends Omit<ConversaDaCaixa, 'card' | 'ultimaEm'> {
      ultimaEmData: Date;
      recebidasHoje: number;
      enviadasHoje: number;
    }
    const porChave = new Map<string, Acumulada>();
    for (const m of mensagens) {
      const chave = m.leadId ?? chaveCanonicaNumero(m.numero);
      let c = porChave.get(chave);
      if (!c) {
        c = {
          chave,
          leadId: m.leadId,
          numero: m.numero,
          nome: m.leadNome,
          ultimaMensagem: m.mensagem,
          ultimaEmData: m.criadoEm,
          ultimaDirecao: m.direcao,
          naoLidas: 0,
          respondida: false,
          recebidasHoje: 0,
          enviadasHoje: 0,
        };
        porChave.set(chave, c);
      }
      if (m.direcao === 'recebida') {
        c.respondida = true;
        if (!m.lidaEm) c.naoLidas += 1;
      }
      if (m.criadoEm.getTime() >= hoje) {
        if (m.direcao === 'recebida') c.recebidasHoje += 1;
        else c.enviadasHoje += 1;
      }
    }

    const leadIds = [...new Set([...porChave.values()].map((c) => c.leadId).filter((id): id is string => id !== null))];
    const cardPorLead = new Map<string, NonNullable<ConversaDaCaixa['card']> & { responsavelId: string | null }>();
    if (leadIds.length > 0) {
      const cards = await tx
        .select({
          id: oportunidades.id,
          leadId: oportunidades.leadId,
          etapaId: oportunidades.etapaId,
          valor: oportunidades.valor,
          responsavelId: oportunidades.responsavelId,
          responsavelNome: usuarios.nome,
        })
        .from(oportunidades)
        .leftJoin(usuarios, eq(oportunidades.responsavelId, usuarios.id))
        .where(and(eq(oportunidades.empresaId, contexto.empresaId), inArray(oportunidades.leadId, leadIds)))
        .orderBy(desc(oportunidades.criadoEm));
      for (const card of cards) {
        if (cardPorLead.has(card.leadId)) continue;
        cardPorLead.set(card.leadId, {
          id: card.id,
          etapaId: card.etapaId,
          valor: card.valor,
          responsavelId: card.responsavelId,
          responsavel: card.responsavelId && card.responsavelNome ? { id: card.responsavelId, nome: card.responsavelNome } : null,
        });
      }
    }

    // T-303: o nome e o motivo que quem enviou a avulsa informou.
    const avulsoPorNumero = new Map<string, { nome: string | null; categoria: string | null }>();
    if ([...porChave.values()].some((c) => !c.leadId)) {
      const avulsos = await tx
        .select({ numero: whatsappAvulsos.numero, nome: whatsappAvulsos.nome, categoria: whatsappAvulsos.categoria })
        .from(whatsappAvulsos)
        .where(eq(whatsappAvulsos.empresaId, contexto.empresaId));
      for (const a of avulsos) avulsoPorNumero.set(chaveCanonicaNumero(a.numero), a);
    }
    for (const c of porChave.values()) {
      if (c.leadId) continue;
      const a = avulsoPorNumero.get(chaveCanonicaNumero(c.numero));
      if (a) {
        c.nome = a.nome ?? c.nome;
        c.categoria = a.categoria;
      }
    }

    let visiveis = [...porChave.values()].map((c) => {
      const card = c.leadId ? (cardPorLead.get(c.leadId) ?? null) : null;
      return { conversa: c, card };
    });

    // ASM-173: o atendente vê as dos próprios cards, as avulsas e as de leads sem card.
    if (opcoes.somenteDoUsuario) {
      visiveis = visiveis.filter(({ conversa, card }) => !conversa.leadId || !card || card.responsavelId === contexto.usuarioId);
    } else if (opcoes.responsavelId) {
      visiveis = visiveis.filter(({ card }) => card?.responsavelId === opcoes.responsavelId);
    }

    const resumo: RespostaConversas['resumo'] = {
      ativasHoje: visiveis.filter(({ conversa }) => conversa.recebidasHoje + conversa.enviadasHoje > 0).length,
      naoLidas: visiveis.reduce((soma, { conversa }) => soma + conversa.naoLidas, 0),
      mensagensHoje: {
        recebidas: visiveis.reduce((soma, { conversa }) => soma + conversa.recebidasHoje, 0),
        enviadas: visiveis.reduce((soma, { conversa }) => soma + conversa.enviadasHoje, 0),
      },
    };

    const dosCards = (v: (typeof visiveis)[number]) => v.card?.responsavelId === contexto.usuarioId;
    const contagens = {
      naoLidas: visiveis.filter((v) => v.conversa.naoLidas > 0).length,
      minhas: visiveis.filter(dosCards).length,
      todas: visiveis.length,
    };

    let filtradas = visiveis;
    if (opcoes.filtro === 'nao_lidas') filtradas = filtradas.filter((v) => v.conversa.naoLidas > 0);
    else if (opcoes.filtro === 'minhas') filtradas = filtradas.filter(dosCards);
    else if (opcoes.filtro === 'avulsas') filtradas = filtradas.filter((v) => !v.conversa.leadId);

    const termo = opcoes.busca?.trim().toLowerCase();
    if (termo) {
      const digitos = termo.replace(/\D/g, '');
      filtradas = filtradas.filter(
        ({ conversa }) => (conversa.nome ?? '').toLowerCase().includes(termo) || (digitos.length > 0 && conversa.numero.includes(digitos))
      );
    }

    const limite = Math.min(Math.max(opcoes.limite ?? LIMITE_PADRAO, 1), LIMITE_MAXIMO);
    const conversas: ConversaDaCaixa[] = filtradas.slice(0, limite).map(({ conversa, card }) => ({
      chave: conversa.chave,
      leadId: conversa.leadId,
      numero: conversa.numero,
      nome: conversa.nome,
      categoria: conversa.categoria ?? null,
      ultimaMensagem: conversa.ultimaMensagem,
      ultimaEm: conversa.ultimaEmData.toISOString(),
      ultimaDirecao: conversa.ultimaDirecao,
      naoLidas: conversa.naoLidas,
      respondida: conversa.respondida,
      card: card ? { id: card.id, etapaId: card.etapaId, valor: card.valor, responsavel: card.responsavel } : null,
    }));

    return { conversas, contagens, resumo };
  });
}

/** AC-505: marca como lidas todas as recebidas não lidas da empresa; devolve quantas. */
export async function marcarTodasComoLidas(db: NodePgDatabase, contexto: Pick<ContextoTenant, 'empresaId'>): Promise<number> {
  return comTenant(db, contexto, async (tx) => {
    const atualizadas = await tx
      .update(whatsappMensagens)
      .set({ lidaEm: new Date() })
      .where(
        and(
          eq(whatsappMensagens.empresaId, contexto.empresaId),
          eq(whatsappMensagens.direcao, 'recebida'),
          isNull(whatsappMensagens.lidaEm)
        )
      )
      .returning({ id: whatsappMensagens.id });
    return atualizadas.length;
  });
}
