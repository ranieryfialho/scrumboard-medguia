// T-062 (fase2c-sse, US-038): rota `GET /api/stream` — canal SSE que repassa
// os eventos do barramento (T-061, `src/lib/sse/barramento.ts`) para o
// navegador. Resolve a sessão (401 antes de abrir qualquer `ReadableStream`
// ou tocar no barramento — AC-113), devolve `text/event-stream` com
// `Cache-Control: no-cache, no-transform` (AC-114) e um comentário `: ping`
// a cada 25 s para proxies não derrubarem a conexão ociosa por inatividade
// (ASM-031). O evento `oportunidade.movida` chega já filtrado por tenant
// pelo barramento (`inscrever(empresaId, ...)`) — esta rota só formata o
// envelope SSE (AC-108). Quando o cliente fecha a conexão
// (`request.signal` aborta), cancela a inscrição no barramento e limpa o
// timer do batimento (AC-116).
import { NextRequest } from 'next/server';

import { getDb } from '../../../db/client';
import { getAuth } from '../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../lib/auth/tenant';
import { getBarramento, type EventoBarramento } from '../../../lib/sse/barramento';

export const dynamic = 'force-dynamic';

export const INTERVALO_PING_MS = 25_000;

/** Mesmo padrão das demais rotas protegidas: sessão primeiro, sem tocar em nada de negócio antes dela (AC-113). */
async function resolverContexto(request: NextRequest): Promise<ContextoTenant | null> {
  const sessao = await getAuth().api.getSession({ headers: request.headers });
  if (!sessao) return null;

  try {
    return await resolverContextoTenant(getDb(), { token: sessao.session.token });
  } catch (erro) {
    if (erro instanceof ErroSessaoInvalida) return null;
    throw erro;
  }
}

function semSessao(): Response {
  return new Response(JSON.stringify({ codigo: 'NAO_AUTENTICADO' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** `event:` com o nome do tipo e `data:` só com o payload (sem repetir `tipo`, já carregado pelo `event:`). */
function formatarEventoSse(evento: EventoBarramento): string {
  const { tipo, ...dados } = evento;
  return `event: ${tipo}\ndata: ${JSON.stringify(dados)}\n\n`;
}

export async function GET(request: NextRequest): Promise<Response> {
  const contexto = await resolverContexto(request);
  if (!contexto) return semSessao();

  const encoder = new TextEncoder();
  let cancelarInscricao: (() => void) | undefined;
  let timerPing: ReturnType<typeof setInterval> | undefined;

  function limpar(): void {
    cancelarInscricao?.();
    cancelarInscricao = undefined;
    if (timerPing) {
      clearInterval(timerPing);
      timerPing = undefined;
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Linha de abertura: faz os cabeçalhos chegarem já (o navegador dispara
      // `open` na hora) em vez de só no primeiro ping, 25 s depois (AC-416).
      controller.enqueue(encoder.encode(': conectado\n\n'));
      cancelarInscricao = getBarramento().inscrever(contexto.empresaId, (evento) => {
        controller.enqueue(encoder.encode(formatarEventoSse(evento)));
      });
      timerPing = setInterval(() => {
        controller.enqueue(encoder.encode(': ping\n\n'));
      }, INTERVALO_PING_MS);
    },
    cancel() {
      limpar();
    },
  });

  request.signal.addEventListener('abort', limpar);

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      // Proxy reverso (nginx) não pode segurar o fluxo em buffer.
      'X-Accel-Buffering': 'no',
    },
  });
}
