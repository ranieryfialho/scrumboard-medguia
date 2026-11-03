// T-290 (fase4-card-abas, US-114, AC-744/AC-746/AC-747): rota POST /api/whatsapp/send-midia — envia um áudio gravado (`modo=audio`)
// ou um arquivo anexado (`modo=arquivo`: imagem, vídeo, PDF, Office, texto) a um telefone de um lead, como multipart/form-data.
// Mesma ordem de `send/route.ts`: sessão (401) → corpo (400) → arquivo (413 grande, 415 tipo, 400 bytes que não combinam) → destino
// (lead 404 / telefone 404 / sem telefone 422) → instância (409) → Evolution fora do banco (502/422) → guarda o arquivo no volume e
// grava a mensagem `enviada` com a mídia. Enviar mídia nunca move card nem encerra cadência (mesmo AC-146 do texto).
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../db/client';
import { bytesCombinamComMimetype, classificarMimetype, LIMITE_MIDIA_BYTES, mimetypeBase, TEXTO_PADRAO_DA_MIDIA, type TipoMidia } from '../../../../domain/whatsapp/midia';
import { contextoDaSessao } from '../../../../lib/auth/sessao';
import { buildConfig, sendAudioMessage, sendMediaMessage } from '../../../../lib/evolution-api';
import { gravarMidia } from '../../../../lib/whatsapp/midia-armazenamento';
import { listarTelefonesLead } from '../../../../repositories/lead-telefones';
import { registrarMensagemEnviada } from '../../../../repositories/whatsapp';
import { buscarNomeInstancia } from '../../../../repositories/whatsapp-instancia';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEGENDA_MAX = 1024;

const erro = (codigo: string, status: number) => NextResponse.json({ codigo }, { status });

export async function POST(request: NextRequest) {
  const contexto = await contextoDaSessao(request);
  if (!contexto) return erro('NAO_AUTENTICADO', 401);

  const formulario = await request.formData().catch(() => null);
  if (!formulario) return erro('REQUISICAO_INVALIDA', 400);

  const arquivo = formulario.get('arquivo');
  const modo = formulario.get('modo');
  const leadId = formulario.get('leadId');
  const telefoneId = formulario.get('telefoneId');
  const legendaBruta = formulario.get('legenda');
  if (!(arquivo instanceof File) || (modo !== 'audio' && modo !== 'arquivo') || typeof leadId !== 'string' || !UUID.test(leadId)) {
    return erro('REQUISICAO_INVALIDA', 400);
  }
  if (telefoneId !== null && (typeof telefoneId !== 'string' || !UUID.test(telefoneId))) return erro('REQUISICAO_INVALIDA', 400);
  if (legendaBruta !== null && (typeof legendaBruta !== 'string' || legendaBruta.length > LEGENDA_MAX)) return erro('REQUISICAO_INVALIDA', 400);
  const legenda = typeof legendaBruta === 'string' ? legendaBruta.trim() : '';

  if (arquivo.size === 0) return erro('REQUISICAO_INVALIDA', 400);
  if (arquivo.size > LIMITE_MIDIA_BYTES) return erro('ARQUIVO_GRANDE', 413);

  const classe = classificarMimetype(arquivo.type);
  // O áudio gravado precisa ser áudio; no anexo, áudio vai como documento (quem quer mensagem de voz usa o gravador).
  if (!classe || (modo === 'audio' && classe.tipo !== 'audio')) return erro('TIPO_NAO_PERMITIDO', 415);
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  if (!bytesCombinamComMimetype(arquivo.type, bytes)) return erro('TIPO_NAO_PERMITIDO', 415);

  const db = getDb();
  const telefones = await listarTelefonesLead(db, contexto, leadId);
  if (!telefones) return erro('LEAD_NAO_ENCONTRADO', 404);
  let numeroDestino: string;
  if (telefoneId) {
    const extra = telefones.extras.find((telefone) => telefone.id === telefoneId);
    if (!extra) return erro('TELEFONE_NAO_ENCONTRADO', 404);
    numeroDestino = extra.numero;
  } else {
    if (!telefones.principal) return erro('LEAD_SEM_TELEFONE', 422);
    numeroDestino = telefones.principal;
  }

  const nomeInstancia = await buscarNomeInstancia(db, contexto);
  if (!nomeInstancia) return erro('WHATSAPP_NAO_CONFIGURADO', 409);
  const config = buildConfig(nomeInstancia);

  const tipo: TipoMidia = modo === 'audio' ? 'audio' : classe.tipo === 'audio' ? 'documento' : classe.tipo;
  const nome = (arquivo.name || `arquivo.${classe.extensao}`).replace(/[\\/\r\n]/g, '_').slice(0, 120);
  const base64 = Buffer.from(bytes).toString('base64');

  let resultado;
  try {
    resultado =
      modo === 'audio'
        ? await sendAudioMessage(config, numeroDestino, base64)
        : await sendMediaMessage(config, numeroDestino, {
            mediatype: tipo === 'imagem' ? 'image' : tipo === 'video' ? 'video' : 'document',
            mimetype: mimetypeBase(arquivo.type),
            fileName: nome,
            caption: legenda,
            base64,
          });
  } catch {
    return erro('FALHA_ENVIO', 502);
  }
  if (resultado.error) return resultado.numberNotFound ? erro('NUMERO_SEM_WHATSAPP', 422) : erro('FALHA_ENVIO', 502);

  try {
    // A Evolution já entregou; se o volume falhar, a mensagem ainda é registrada e a mídia é buscada nela na hora de abrir.
    const caminho = await gravarMidia(classe.extensao, bytes).catch(() => null);
    const registrado = await registrarMensagemEnviada(db, contexto, {
      numero: numeroDestino,
      texto: modo === 'audio' ? TEXTO_PADRAO_DA_MIDIA.audio : legenda || (tipo === 'documento' ? nome : TEXTO_PADRAO_DA_MIDIA[tipo]),
      evolutionMessageId: resultado.key?.id ?? null,
      midia: { tipo, mimetype: mimetypeBase(arquivo.type), nome: tipo === 'documento' ? nome : null, arquivo: caminho },
    });
    return NextResponse.json({ success: true, messageId: resultado.key?.id ?? null, mensagemId: registrado.mensagemId, leadId: registrado.leadId });
  } catch {
    return erro('ENVIADO_SEM_REGISTRO', 500);
  }
}
