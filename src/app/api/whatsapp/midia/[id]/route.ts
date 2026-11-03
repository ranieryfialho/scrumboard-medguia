// T-290 (fase4-card-abas, US-114, AC-745/AC-747): rota GET /api/whatsapp/midia/:id — abre o arquivo (áudio, imagem, vídeo ou
// documento) de uma mensagem da empresa da sessão. Se o arquivo ainda não está no volume (mensagem recebida, ou envio em que o
// volume falhou), busca-o na Evolution uma vez e o guarda. Só entrega tipos da lista permitida (qualquer outro vai como download
// genérico), com `nosniff`; áudio, imagem e vídeo abrem na página, o resto baixa. Aceita `Range`, para o player poder pular.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../../db/client';
import { classificarMimetype, LIMITE_MIDIA_BYTES, mimetypeBase } from '../../../../../domain/whatsapp/midia';
import { contextoDaSessao } from '../../../../../lib/auth/sessao';
import { buildConfig, fetchMediaBase64 } from '../../../../../lib/evolution-api';
import { gravarMidia, lerMidia } from '../../../../../lib/whatsapp/midia-armazenamento';
import { buscarMidiaDaMensagem, guardarArquivoDaMidia } from '../../../../../repositories/whatsapp';
import { buscarNomeInstancia } from '../../../../../repositories/whatsapp-instancia';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const naoEncontrada = () => NextResponse.json({ codigo: 'MIDIA_NAO_ENCONTRADA' }, { status: 404 });

/** `bytes=0-99` → [0, 99]; `bytes=500-` → [500, fim]; qualquer outra forma → `null` (entrega inteiro). */
function intervalo(cabecalho: string | null, tamanho: number): [number, number] | 'invalido' | null {
  const m = cabecalho?.match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (m[1] === '' && m[2] === '')) return null;
  const inicio = m[1] === '' ? Math.max(0, tamanho - Number(m[2])) : Number(m[1]);
  const fim = m[1] === '' || m[2] === '' ? tamanho - 1 : Math.min(Number(m[2]), tamanho - 1);
  return inicio > fim || inicio >= tamanho ? 'invalido' : [inicio, fim];
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await contextoDaSessao(request);
  if (!contexto) return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return naoEncontrada();

  const db = getDb();
  const midia = await buscarMidiaDaMensagem(db, contexto, id);
  if (!midia) return naoEncontrada();

  let bytes: Uint8Array | null = null;
  let mimetype = midia.mimetype;
  if (midia.arquivo) bytes = await lerMidia(midia.arquivo).catch(() => null);

  if (!bytes && midia.evolutionMessageId) {
    const instancia = await buscarNomeInstancia(db, contexto);
    const buscada = instancia ? await fetchMediaBase64(buildConfig(instancia), midia.evolutionMessageId).catch(() => null) : null;
    if (buscada) {
      const recebidos = new Uint8Array(Buffer.from(buscada.base64, 'base64'));
      if (recebidos.length > 0 && recebidos.length <= LIMITE_MIDIA_BYTES) {
        bytes = recebidos;
        mimetype = buscada.mimetype ?? mimetype;
        const classe = classificarMimetype(mimetype);
        const caminho = await gravarMidia(classe?.extensao ?? 'bin', bytes).catch(() => null);
        if (caminho) await guardarArquivoDaMidia(db, contexto, id, caminho, mimetypeBase(mimetype) || 'application/octet-stream');
      }
    }
  }
  if (!bytes) return NextResponse.json({ codigo: 'MIDIA_INDISPONIVEL' }, { status: 404 });

  const classe = classificarMimetype(mimetype);
  const tipoDaResposta = classe ? mimetypeBase(mimetype) : 'application/octet-stream';
  const abreNaPagina = classe?.tipo === 'audio' || classe?.tipo === 'imagem' || classe?.tipo === 'video';
  const nomeDoArquivo = (midia.nome ?? `arquivo.${classe?.extensao ?? 'bin'}`).replace(/[^\w.\- ()]/g, '_');
  const cabecalhos: Record<string, string> = {
    'Content-Type': tipoDaResposta,
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, max-age=3600',
    'Content-Disposition': `${abreNaPagina ? 'inline' : 'attachment'}; filename="${nomeDoArquivo}"`,
  };

  const faixa = intervalo(request.headers.get('range'), bytes.length);
  if (faixa === 'invalido') return new NextResponse(null, { status: 416, headers: { 'Content-Range': `bytes */${bytes.length}` } });
  if (faixa) {
    const [inicio, fim] = faixa;
    return new NextResponse(Buffer.from(bytes.subarray(inicio, fim + 1)), {
      status: 206,
      headers: { ...cabecalhos, 'Content-Range': `bytes ${inicio}-${fim}/${bytes.length}`, 'Content-Length': String(fim - inicio + 1) },
    });
  }
  return new NextResponse(Buffer.from(bytes), { status: 200, headers: { ...cabecalhos, 'Content-Length': String(bytes.length) } });
}
