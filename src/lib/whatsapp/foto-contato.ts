// Foto de perfil do contato no WhatsApp. A Evolution devolve uma URL TEMPORÁRIA (`pps.whatsapp.net`, com assinatura que expira), então o CRM
// baixa a imagem uma vez e guarda no mesmo volume dos anexos (`ANEXOS_DIR`), numa pasta própria, por empresa e número. Quem não tem foto (ou
// a deixou oculta pela privacidade do WhatsApp) também é lembrado por um tempo, para não perguntar à Evolution a cada tela aberta.
// O caminho do arquivo só usa o id da empresa (uuid da sessão) e o número (só dígitos): nada que veio da Evolution entra nele.
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { diretorioDeAnexos } from '../anexos/armazenamento';

const PASTA = 'whatsapp-fotos';

export const VALIDADE_FOTO_MS = 12 * 60 * 60 * 1000;
export const VALIDADE_SEM_FOTO_MS = 2 * 60 * 60 * 1000;
const LIMITE_BYTES = 2 * 1024 * 1024;
const HOST_DA_FOTO = /(^|\.)whatsapp\.net$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SO_DIGITOS = /^\d{8,15}$/;

export interface PedidoDeFoto {
  empresaId: string;
  numero: string;
  /** Pergunta à Evolution pela URL da foto; `null` = sem foto. Só é chamada quando o cache não vale mais. */
  buscarUrl: () => Promise<string | null>;
  /** Relógio injetável (testes). */
  agora?: () => number;
  /** Baixa a imagem (testes). */
  baixar?: (url: string) => Promise<{ ok: boolean; tipo: string | null; bytes: Uint8Array }>;
}

const emAndamento = new Map<string, Promise<Uint8Array | null>>();

// O funil mostra dezenas de cards de uma vez: sem limite, a primeira abertura dispararia dezenas de consultas simultâneas à Evolution.
const MAX_BUSCAS_SIMULTANEAS = 4;
let buscasAtivas = 0;
const fila: (() => void)[] = [];

async function comLimite<T>(tarefa: () => Promise<T>): Promise<T> {
  if (buscasAtivas >= MAX_BUSCAS_SIMULTANEAS) await new Promise<void>((liberar) => fila.push(liberar));
  buscasAtivas += 1;
  try {
    return await tarefa();
  } finally {
    buscasAtivas -= 1;
    fila.shift()?.();
  }
}

function caminhos(empresaId: string, numero: string) {
  const pasta = path.join(diretorioDeAnexos(), PASTA, empresaId);
  return { pasta, foto: path.join(pasta, `${numero}.jpg`), semFoto: path.join(pasta, `${numero}.sem`) };
}

async function idadeMs(arquivo: string, agora: number): Promise<number | null> {
  try {
    return agora - (await stat(arquivo)).mtimeMs;
  } catch {
    return null;
  }
}

/** URL da foto confiável? Só `https` num host do WhatsApp (`*.whatsapp.net`): a Evolution não nos leva a baixar de qualquer lugar. */
export function urlDeFotoPermitida(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && HOST_DA_FOTO.test(u.hostname);
  } catch {
    return false;
  }
}

async function baixarPadrao(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'error' });
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { ok: res.ok, tipo: res.headers.get('content-type'), bytes };
}

async function buscarEGuardar(pedido: PedidoDeFoto, agora: number): Promise<Uint8Array | null> {
  const { pasta, foto, semFoto } = caminhos(pedido.empresaId, pedido.numero);
  await mkdir(pasta, { recursive: true });

  const lembrarSemFoto = () => writeFile(semFoto, '').catch(() => undefined);

  const url = await pedido.buscarUrl();
  if (!url || !urlDeFotoPermitida(url)) {
    await lembrarSemFoto();
    return null;
  }

  try {
    const resposta = await (pedido.baixar ?? baixarPadrao)(url);
    if (!resposta.ok || !resposta.tipo?.startsWith('image/') || resposta.bytes.length === 0 || resposta.bytes.length > LIMITE_BYTES) {
      await lembrarSemFoto();
      return null;
    }
    await writeFile(foto, resposta.bytes);
    return resposta.bytes;
  } catch {
    // Falha de rede ao baixar: se já havia uma foto (vencida), ela ainda serve mais do que nada.
    const antiga = (await idadeMs(foto, agora)) !== null ? await readFile(foto).catch(() => null) : null;
    if (!antiga) await lembrarSemFoto();
    return antiga;
  }
}

/** A foto do contato (bytes) ou `null` quando não há. Usa o cache enquanto vale; senão busca de novo (uma busca por vez para o mesmo contato). */
export async function obterFotoDoContato(pedido: PedidoDeFoto): Promise<Uint8Array | null> {
  if (!UUID.test(pedido.empresaId) || !SO_DIGITOS.test(pedido.numero)) return null;

  const agora = (pedido.agora ?? Date.now)();
  const { foto, semFoto } = caminhos(pedido.empresaId, pedido.numero);

  const idadeFoto = await idadeMs(foto, agora);
  if (idadeFoto !== null && idadeFoto < VALIDADE_FOTO_MS) return readFile(foto);

  const idadeSem = await idadeMs(semFoto, agora);
  if (idadeSem !== null && idadeSem < VALIDADE_SEM_FOTO_MS) return null;

  const chave = `${pedido.empresaId}/${pedido.numero}`;
  const existente = emAndamento.get(chave);
  if (existente) return existente;

  const busca = comLimite(() => buscarEGuardar(pedido, agora)).finally(() => emAndamento.delete(chave));
  emAndamento.set(chave, busca);
  return busca;
}
