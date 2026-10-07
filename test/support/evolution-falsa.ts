// T-078 (fase2c-whatsapp-conversa): servidor HTTP falso local da Evolution
// API (ASM-040), para os testes de POST /api/whatsapp/send exercitarem
// `src/lib/evolution-api.ts` de ponta a ponta sem depender de uma Evolution
// real. Grava cada chamada recebida (`chamadas`) para as rotas provarem o
// que foi de fato enviado (AC-136/AC-139/AC-140) e troca de comportamento em
// tempo real (`definirComportamento`) para os cenários de falha (AC-145).
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

export interface EvolutionFalsa {
  url: string;
  apiKey: string;
  chamadas: ChamadaEvolutionFalsa[];
  /** Troca o comportamento das próximas respostas (default: sucesso). */
  definirComportamento(comportamento: ComportamentoEvolutionFalsa): void;
  fechar(): Promise<void>;
}

const API_KEY = 'evolution-falsa-chave-de-teste';

/**
 * Sobe um servidor HTTP local que responde `/message/sendText/:instance`
 * como a Evolution API de verdade responderia — sucesso com `key.id`, erro
 * genérico (`AC-145`, "responde erro") ou o formato de "número não existe no
 * WhatsApp" (`exists: false`) que `sendTextMessage` reconhece para devolver
 * `numberNotFound` depois de retentar pelo JID.
 */
export async function subirEvolutionFalsa(): Promise<EvolutionFalsa> {
  const chamadas: ChamadaEvolutionFalsa[] = [];
  let comportamento: ComportamentoEvolutionFalsa = { tipo: 'sucesso' };
  let contadorMensagem = 0;

  const server: Server = createServer((req, res) => {
    const partes = (req.url ?? '').split('/').filter(Boolean);
    const instance = partes[partes.length - 1] ?? '';

    const pedaços: Buffer[] = [];
    req.on('data', (pedaco: Buffer) => pedaços.push(pedaco));
    req.on('end', () => {
      const corpoTexto = Buffer.concat(pedaços).toString('utf8');
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
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    apiKey: API_KEY,
    chamadas,
    definirComportamento(novo: ComportamentoEvolutionFalsa) {
      comportamento = novo;
    },
    fechar() {
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
