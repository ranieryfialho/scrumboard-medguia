// T-078 (fase2c-whatsapp-conversa): servidor HTTP falso local da Evolution
// API (ASM-040), para os testes de POST /api/whatsapp/send exercitarem
// `src/lib/evolution-api.ts` de ponta a ponta sem depender de uma Evolution
// real. Grava cada chamada recebida (`chamadas`) para as rotas provarem o
// que foi de fato enviado (AC-136/AC-139/AC-140) e troca de comportamento em
// tempo real (`definirComportamento`) para os cenários de falha (AC-145).
//
// T-082 (fase2c-whatsapp-conexao, ASM-054): acrescenta `/instance/create`,
// `/webhook/set/:instancia`, `/instance/connect/:instancia` e
// `/instance/connectionState/:instancia`, cada um com comportamento
// configurável e registro em ordem (`ordemChamadas`) para provar que a rota
// de QR code cria a instância, registra o webhook e só então pede a conexão
// (AC-180).
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface ChamadaEvolutionFalsa {
  instance: string;
  numero: string;
  texto: string;
}

export type ComportamentoEvolutionFalsa =
  | { tipo: 'sucesso' }
  | { tipo: 'erro'; status: number }
  | { tipo: 'numero_sem_whatsapp' };

export interface ChamadaCriarInstancia {
  instance: string;
}

export type ComportamentoCriarInstancia =
  | { tipo: 'sucesso' }
  | { tipo: 'ja_existe' }
  | { tipo: 'erro'; status: number };

export interface ChamadaWebhook {
  instance: string;
  corpo: unknown;
}

export type ComportamentoWebhook = { tipo: 'sucesso' } | { tipo: 'erro'; status: number };

export interface ChamadaConectar {
  instance: string;
}

export type ComportamentoConectar =
  | { tipo: 'qrcode'; base64: string }
  | { tipo: 'aberto' };

export interface ChamadaEstado {
  instance: string;
}

export type ComportamentoEstado = { tipo: 'estado'; state: string };

export interface EvolutionFalsa {
  url: string;
  apiKey: string;
  chamadas: ChamadaEvolutionFalsa[];
  chamadasCriarInstancia: ChamadaCriarInstancia[];
  chamadasWebhook: ChamadaWebhook[];
  chamadasConectar: ChamadaConectar[];
  chamadasEstado: ChamadaEstado[];
  /** Ordem em que os endpoints foram chamados, para provar a sequência (AC-180). */
  ordemChamadas: string[];
  /** Troca o comportamento das próximas respostas (default: sucesso). */
  definirComportamento(comportamento: ComportamentoEvolutionFalsa): void;
  definirComportamentoCriarInstancia(comportamento: ComportamentoCriarInstancia): void;
  definirComportamentoWebhook(comportamento: ComportamentoWebhook): void;
  definirComportamentoConectar(comportamento: ComportamentoConectar): void;
  definirComportamentoEstado(comportamento: ComportamentoEstado): void;
  fechar(): Promise<void>;
}

const API_KEY = 'evolution-falsa-chave-de-teste';

/**
 * Sobe um servidor HTTP local que responde `/message/sendText/:instance`
 * como a Evolution API de verdade responderia — sucesso com `key.id`, erro
 * genérico (`AC-145`, "responde erro") ou o formato de "número não existe no
 * WhatsApp" (`exists: false`) que `sendTextMessage` reconhece para devolver
 * `numberNotFound` depois de retentar pelo JID — e também os endpoints de
 * conexão usados pela rota de QR code: criar instância, registrar webhook,
 * pedir conexão (QR code) e consultar o estado da conexão.
 */
export async function subirEvolutionFalsa(): Promise<EvolutionFalsa> {
  const chamadas: ChamadaEvolutionFalsa[] = [];
  const chamadasCriarInstancia: ChamadaCriarInstancia[] = [];
  const chamadasWebhook: ChamadaWebhook[] = [];
  const chamadasConectar: ChamadaConectar[] = [];
  const chamadasEstado: ChamadaEstado[] = [];
  const ordemChamadas: string[] = [];

  let comportamento: ComportamentoEvolutionFalsa = { tipo: 'sucesso' };
  let comportamentoCriarInstancia: ComportamentoCriarInstancia = { tipo: 'sucesso' };
  let comportamentoWebhook: ComportamentoWebhook = { tipo: 'sucesso' };
  let comportamentoConectar: ComportamentoConectar = {
    tipo: 'qrcode',
    base64: 'data:image/png;base64,qrcode-falso',
  };
  let comportamentoEstado: ComportamentoEstado = { tipo: 'estado', state: 'close' };
  let contadorMensagem = 0;

  function lerCorpo(req: Parameters<NonNullable<Parameters<typeof createServer>[0]>>[0]): Promise<string> {
    return new Promise((resolve) => {
      const pedaços: Buffer[] = [];
      req.on('data', (pedaco: Buffer) => pedaços.push(pedaco));
      req.on('end', () => resolve(Buffer.concat(pedaços).toString('utf8')));
    });
  }

  const server: Server = createServer((req, res) => {
    const url = req.url ?? '';
    const partes = url.split('?')[0].split('/').filter(Boolean);

    void (async () => {
      // /message/sendText/:instance
      if (req.method === 'POST' && partes[0] === 'message' && partes[1] === 'sendText') {
        const instance = partes[2] ?? '';
        const corpoTexto = await lerCorpo(req);
        const dados = corpoTexto ? JSON.parse(corpoTexto) : {};
        chamadas.push({ instance, numero: dados.number, texto: dados.text });

        if (comportamento.tipo === 'erro') {
          res.writeHead(comportamento.status, { 'Content-Type': 'text/plain' });
          res.end('erro simulado da Evolution falsa');
          return;
        }

        if (comportamento.tipo === 'numero_sem_whatsapp') {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ response: { message: [{ exists: false, number: dados.number }] } }));
          return;
        }

        contadorMensagem += 1;
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ key: { id: `evo-fake-${contadorMensagem}` } }));
        return;
      }

      // POST /instance/create
      if (req.method === 'POST' && partes[0] === 'instance' && partes[1] === 'create') {
        const corpoTexto = await lerCorpo(req);
        const dados = corpoTexto ? JSON.parse(corpoTexto) : {};
        const instance = dados.instanceName ?? '';
        chamadasCriarInstancia.push({ instance });
        ordemChamadas.push(`criar:${instance}`);

        if (comportamentoCriarInstancia.tipo === 'erro') {
          res.writeHead(comportamentoCriarInstancia.status, { 'Content-Type': 'text/plain' });
          res.end('erro simulado ao criar instância');
          return;
        }

        if (comportamentoCriarInstancia.tipo === 'ja_existe') {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'instância já existe' }));
          return;
        }

        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ instance: { instanceName: instance } }));
        return;
      }

      // POST /webhook/set/:instancia
      if (req.method === 'POST' && partes[0] === 'webhook' && partes[1] === 'set') {
        const instance = partes[2] ?? '';
        const corpoTexto = await lerCorpo(req);
        const corpo = corpoTexto ? JSON.parse(corpoTexto) : {};
        chamadasWebhook.push({ instance, corpo });
        ordemChamadas.push(`webhook:${instance}`);

        if (comportamentoWebhook.tipo === 'erro') {
          res.writeHead(comportamentoWebhook.status, { 'Content-Type': 'text/plain' });
          res.end('erro simulado ao registrar webhook');
          return;
        }

        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ webhook: { enabled: true } }));
        return;
      }

      // GET /instance/connect/:instancia
      if (req.method === 'GET' && partes[0] === 'instance' && partes[1] === 'connect') {
        const instance = partes[2] ?? '';
        chamadasConectar.push({ instance });
        ordemChamadas.push(`conectar:${instance}`);

        if (comportamentoConectar.tipo === 'aberto') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ instance: { state: 'open' } }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ base64: comportamentoConectar.base64 }));
        return;
      }

      // GET /instance/connectionState/:instancia
      if (req.method === 'GET' && partes[0] === 'instance' && partes[1] === 'connectionState') {
        const instance = partes[2] ?? '';
        chamadasEstado.push({ instance });
        ordemChamadas.push(`estado:${instance}`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ instance: { state: comportamentoEstado.state } }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('rota desconhecida na Evolution falsa');
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    apiKey: API_KEY,
    chamadas,
    chamadasCriarInstancia,
    chamadasWebhook,
    chamadasConectar,
    chamadasEstado,
    ordemChamadas,
    definirComportamento(novo: ComportamentoEvolutionFalsa) {
      comportamento = novo;
    },
    definirComportamentoCriarInstancia(novo: ComportamentoCriarInstancia) {
      comportamentoCriarInstancia = novo;
    },
    definirComportamentoWebhook(novo: ComportamentoWebhook) {
      comportamentoWebhook = novo;
    },
    definirComportamentoConectar(novo: ComportamentoConectar) {
      comportamentoConectar = novo;
    },
    definirComportamentoEstado(novo: ComportamentoEstado) {
      comportamentoEstado = novo;
    },
    fechar() {
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
