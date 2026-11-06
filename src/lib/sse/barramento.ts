// T-061 (fase2c-sse, US-038): barramento de eventos de tempo real. Mantém
// uma única conexão `pg.Client` em `LISTEN oportunidade` por instância (uma
// por `criarBarramento`, nunca uma por usuário conectado — AC-115) e
// distribui `oportunidade.movida` só para quem se inscreveu com o mesmo
// `empresaId` do payload (AC-109, ASM-029); quem não é do tenant nunca
// recebe a chamada do ouvinte. Se a conexão de LISTEN cair, reconecta com
// backoff exponencial e, ao voltar a escutar, avisa todo mundo com
// `stream.reconectado` (AC-117) — eventos perdidos durante a queda não são
// recuperados (fora de escopo: replay).
//
// T-070 (fase2c-whatsapp-entrada, US-042): o mesmo canal `oportunidade`
// também carrega `mensagem.recebida` (migration 0008, ASM-038) — o `tipo`
// do payload (presente em todo NOTIFY desde a 0008) decide qual evento
// montar, mas o filtro por `empresaId` e o roteamento só-para-o-tenant
// (AC-133) são os mesmos de `oportunidade.movida`. Quando o trigger de
// INSERT não dispara — mensagem ignorada antes de chegar ao banco (AC-123)
// ou retentativa absorvida pelo índice único (AC-124/AC-134) — nenhum
// NOTIFY chega aqui, então nenhum ouvinte é chamado; não há nada a filtrar
// nesse caso.
//
// T-096 (fase2b-fila-tarefas, US-060): mesmo canal, mesmo filtro por
// `empresaId` (AC-218), agora também para `cadencia.fila_alterada`
// (migration 0012) — o payload do trigger só traz `empresaId` e
// `oportunidadeId` (sem dado de negócio), então o evento aqui é só esses
// dois campos.
import { Client } from 'pg';

export interface EventoOportunidadeMovida {
  tipo: 'oportunidade.movida';
  empresaId: string;
  oportunidadeId: string;
  etapaOrigemId: number;
  etapaDestinoId: number;
  atorId: string;
  ocorridoEm: string;
}

export interface EventoMensagemRecebida {
  tipo: 'mensagem.recebida';
  empresaId: string;
  leadId: string | null;
  mensagemId: string;
  ocorridoEm: string;
}

/** Check/lida de uma mensagem que a empresa enviou (`messages.update` da Evolution) — a conversa aberta se atualiza sem recarregar. */
export interface EventoMensagemStatus {
  tipo: 'mensagem.status';
  empresaId: string;
  leadId: string | null;
  mensagemId: string;
  status: string;
}

/** Reação (emoji) posta ou retirada numa mensagem — a conversa aberta se atualiza sem recarregar. */
export interface EventoMensagemReacao {
  tipo: 'mensagem.reacao';
  empresaId: string;
  leadId: string | null;
  mensagemId: string;
}

export interface EventoCadenciaFilaAlterada {
  tipo: 'cadencia.fila_alterada';
  empresaId: string;
  oportunidadeId: string;
}

export interface EventoStreamReconectado {
  tipo: 'stream.reconectado';
}

export type EventoBarramento =
  | EventoOportunidadeMovida
  | EventoMensagemRecebida
  | EventoMensagemStatus
  | EventoMensagemReacao
  | EventoCadenciaFilaAlterada
  | EventoStreamReconectado;

export type OuvinteBarramento = (evento: EventoBarramento) => void;

export interface OpcoesBarramento {
  connectionString: string;
  /** Canal do LISTEN/NOTIFY. Default: 'oportunidade' (o mesmo da migration 0007). */
  canal?: string;
  /** Atraso inicial do backoff de reconexão, em ms. Default 1000. */
  backoffInicialMs?: number;
  /** Atraso máximo do backoff de reconexão, em ms. Default 30000. */
  backoffMaximoMs?: number;
  /** Chamado em falhas de conexão/parse — para log; nunca lança. */
  onErro?: (erro: unknown) => void;
}

export interface Barramento {
  /** Inscreve um ouvinte para eventos do tenant `empresaId`; devolve a função que cancela a inscrição (AC-116). */
  inscrever(empresaId: string, ouvinte: OuvinteBarramento): () => void;
  /** Número de inscrições ativas (não é o número de conexões Postgres — essa é sempre 1 por instância). */
  contarInscricoes(): number;
  /** Encerra a conexão de LISTEN e cancela qualquer reconexão pendente. Idempotente. */
  encerrar(): Promise<void>;
}

const CANAL_PADRAO = 'oportunidade';
const BACKOFF_INICIAL_PADRAO_MS = 1000;
const BACKOFF_MAXIMO_PADRAO_MS = 30_000;

interface Inscricao {
  empresaId: string;
  ouvinte: OuvinteBarramento;
}

export function criarBarramento(opcoes: OpcoesBarramento): Barramento {
  const canal = opcoes.canal ?? CANAL_PADRAO;
  const backoffInicialMs = opcoes.backoffInicialMs ?? BACKOFF_INICIAL_PADRAO_MS;
  const backoffMaximoMs = opcoes.backoffMaximoMs ?? BACKOFF_MAXIMO_PADRAO_MS;

  const inscricoes = new Set<Inscricao>();
  let client: Client | undefined;
  let conectando: Promise<void> | undefined;
  let encerrado = false;
  let tentativaReconexao = 0;
  let timerReconexao: ReturnType<typeof setTimeout> | undefined;

  function notificar(empresaId: string | undefined, evento: EventoBarramento): void {
    for (const inscricao of inscricoes) {
      if (empresaId === undefined || inscricao.empresaId === empresaId) {
        inscricao.ouvinte(evento);
      }
    }
  }

  function agendarReconexao(): void {
    if (encerrado || timerReconexao) return;
    const atraso = Math.min(backoffMaximoMs, backoffInicialMs * 2 ** tentativaReconexao);
    tentativaReconexao += 1;
    timerReconexao = setTimeout(() => {
      timerReconexao = undefined;
      void conectar(true);
    }, atraso);
  }

  function limparClient(alvo: Client): void {
    // Não usa `alvo.removeAllListeners()` aqui: o `pg.Client` pode emitir
    // 'error' de novo internamente depois que já tratamos a primeira queda
    // (ex.: o 'end' do socket que segue um FATAL do servidor) — remover os
    // listeners deixaria esse 'error' sem ouvinte e o Node lançaria uma
    // excepção não tratada. Os handlers abaixo são seguros para repetir
    // (agendarReconexao já é idempotente), então basta soltar a referência.
    if (client === alvo) {
      client = undefined;
    }
  }

  async function conectar(reconectando: boolean): Promise<void> {
    if (encerrado) return;

    const novoClient = new Client({ connectionString: opcoes.connectionString });
    novoClient.on('error', (erro) => {
      opcoes.onErro?.(erro);
      limparClient(novoClient);
      agendarReconexao();
    });
    novoClient.on('end', () => {
      limparClient(novoClient);
      agendarReconexao();
    });
    novoClient.on('notification', (mensagem) => {
      if (mensagem.channel !== canal || !mensagem.payload) return;
      try {
        const payload = JSON.parse(mensagem.payload) as Record<string, unknown>;
        const empresaId = String(payload.empresaId);
        if (payload.tipo === 'mensagem.recebida') {
          notificar(empresaId, {
            tipo: 'mensagem.recebida',
            empresaId,
            leadId: payload.leadId == null ? null : String(payload.leadId),
            mensagemId: String(payload.mensagemId),
            ocorridoEm: String(payload.ocorridoEm),
          });
          return;
        }
        if (payload.tipo === 'mensagem.status') {
          notificar(empresaId, {
            tipo: 'mensagem.status',
            empresaId,
            leadId: payload.leadId == null ? null : String(payload.leadId),
            mensagemId: String(payload.mensagemId),
            status: String(payload.status),
          });
          return;
        }
        if (payload.tipo === 'mensagem.reacao') {
          notificar(empresaId, {
            tipo: 'mensagem.reacao',
            empresaId,
            leadId: payload.leadId == null ? null : String(payload.leadId),
            mensagemId: String(payload.mensagemId),
          });
          return;
        }
        if (payload.tipo === 'cadencia.fila_alterada') {
          notificar(empresaId, {
            tipo: 'cadencia.fila_alterada',
            empresaId,
            oportunidadeId: String(payload.oportunidadeId),
          });
          return;
        }
        notificar(empresaId, {
          tipo: 'oportunidade.movida',
          empresaId,
          oportunidadeId: String(payload.oportunidadeId),
          etapaOrigemId: Number(payload.etapaOrigemId),
          etapaDestinoId: Number(payload.etapaDestinoId),
          atorId: String(payload.atorId),
          ocorridoEm: String(payload.ocorridoEm),
        });
      } catch (erro) {
        opcoes.onErro?.(erro);
      }
    });

    try {
      await novoClient.connect();
      await novoClient.query(`LISTEN ${canal}`);
    } catch (erro) {
      opcoes.onErro?.(erro);
      agendarReconexao();
      return;
    }

    if (encerrado) {
      novoClient.removeAllListeners();
      await novoClient.end().catch(() => {});
      return;
    }

    client = novoClient;
    tentativaReconexao = 0;

    if (reconectando) {
      notificar(undefined, { tipo: 'stream.reconectado' });
    }
  }

  function garantirConexao(): void {
    if (client || conectando || encerrado) return;
    conectando = conectar(false).finally(() => {
      conectando = undefined;
    });
  }

  return {
    inscrever(empresaId, ouvinte) {
      const inscricao: Inscricao = { empresaId, ouvinte };
      inscricoes.add(inscricao);
      garantirConexao();
      return () => {
        inscricoes.delete(inscricao);
      };
    },

    contarInscricoes() {
      return inscricoes.size;
    },

    async encerrar() {
      encerrado = true;
      if (timerReconexao) {
        clearTimeout(timerReconexao);
        timerReconexao = undefined;
      }
      inscricoes.clear();
      const atual = client;
      client = undefined;
      if (atual) {
        atual.removeAllListeners();
        await atual.end().catch(() => {});
      }
    },
  };
}

let singleton: Barramento | undefined;

/** Singleton usado pelas rotas da aplicação (uma conexão de LISTEN por instância — AC-115). */
export function getBarramento(): Barramento {
  if (!singleton) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL não definida — necessária para o barramento de eventos SSE.');
    }
    singleton = criarBarramento({ connectionString: databaseUrl });
  }
  return singleton;
}
