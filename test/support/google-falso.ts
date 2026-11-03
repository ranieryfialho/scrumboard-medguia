// T-301 (fase4-tarefas-agenda, US-122): um Google falso local — a troca de tokens (OAuth) e os eventos do Calendar com a sala do Meet —
// para os testes da integração do Meet exercitarem `src/lib/google/calendario.ts` de ponta a ponta sem depender do Google de verdade.
// Grava cada chamada recebida e deixa trocar o comportamento (`falharTudo`) para provar que a agenda não depende do Google.
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface ChamadaAoGoogle {
  metodo: string;
  caminho: string;
  autorizacao: string | null;
  corpo: Record<string, unknown>;
}

export interface GoogleFalso {
  url: string;
  chamadas: ChamadaAoGoogle[];
  /** Os eventos que existem agora no "Calendar" (id → corpo enviado na criação, já com as mudanças). */
  eventos: Map<string, Record<string, unknown>>;
  /** Com `true`, o Calendar responde 500 (o OAuth segue funcionando). */
  falharCalendario: boolean;
  /** Com `true`, a troca do código responde 400. */
  recusarTroca: boolean;
  /** A conta devolvida no `id_token` da troca do código. */
  contaDoToken: string;
  /** Troca o que a troca do código devolve: sem refresh token. */
  semRefreshToken: boolean;
  fechar(): Promise<void>;
}

async function ler(req: IncomingMessage): Promise<string> {
  let texto = '';
  for await (const pedaco of req) texto += pedaco;
  return texto;
}

export async function subirGoogleFalso(): Promise<GoogleFalso> {
  let contador = 0;
  const falso: GoogleFalso = {
    url: '',
    chamadas: [],
    eventos: new Map(),
    falharCalendario: false,
    recusarTroca: false,
    contaDoToken: 'contato@medguia.com.br',
    semRefreshToken: false,
    fechar: () => new Promise((ok) => servidor.close(() => ok())),
  };

  const servidor: Server = createServer(async (req, res) => {
    const texto = await ler(req);
    const caminho = req.url ?? '';
    const ehForm = (req.headers['content-type'] ?? '').includes('x-www-form-urlencoded');
    const corpo = texto ? (ehForm ? Object.fromEntries(new URLSearchParams(texto)) : JSON.parse(texto)) : {};
    falso.chamadas.push({ metodo: req.method ?? '', caminho, autorizacao: (req.headers.authorization as string | undefined) ?? null, corpo });
    const responder = (status: number, json: unknown) => {
      res.statusCode = status;
      res.setHeader('content-type', 'application/json');
      res.end(json === null ? '' : JSON.stringify(json));
    };

    if (caminho === '/token') {
      if (falso.recusarTroca) return responder(400, { error: 'invalid_grant' });
      if (corpo.grant_type === 'refresh_token') return responder(200, { access_token: `acesso-de-${corpo.refresh_token}`, expires_in: 3600 });
      const idToken = ['x', Buffer.from(JSON.stringify({ email: falso.contaDoToken })).toString('base64url'), 'x'].join('.');
      return responder(200, {
        access_token: 'acesso-inicial',
        ...(falso.semRefreshToken ? {} : { refresh_token: 'refresh-do-google-1234567890' }),
        id_token: idToken,
      });
    }
    if (caminho === '/revoke') return responder(200, {});

    if (caminho.startsWith('/calendar/v3/calendars/primary/events')) {
      if (falso.falharCalendario) return responder(500, { error: 'quebrou' });
      const id = decodeURIComponent(caminho.split('?')[0].split('/events/')[1] ?? '');
      if (req.method === 'POST') {
        contador += 1;
        const novo = `evento-${contador}`;
        falso.eventos.set(novo, corpo);
        return responder(200, { id: novo, hangoutLink: `https://meet.google.com/aaa-bbbb-${String(contador).padStart(3, '0')}` });
      }
      if (req.method === 'PATCH') {
        if (!falso.eventos.has(id)) return responder(404, {});
        falso.eventos.set(id, { ...falso.eventos.get(id), ...corpo });
        return responder(200, { id });
      }
      if (req.method === 'DELETE') {
        if (!falso.eventos.delete(id)) return responder(404, {});
        return responder(204, null);
      }
    }
    return responder(404, {});
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  falso.url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  return falso;
}
