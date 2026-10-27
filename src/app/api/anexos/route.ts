// T-055 (fase2c-anexos, US-034): POST /api/anexos — recebe um print/PDF
// (multipart: `oportunidadeId` + `arquivo`) e o guarda no volume. Ordem das
// checagens (nada é gravado antes de todas passarem): sessão (401) → card no
// tenant (404, AC-099) → tipo pelos bytes (415, AC-096) → tamanho (413,
// AC-097) → bytes no volume (nome gerado pelo servidor, AC-098) → registro.
import { createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../db/client';
import { detectarTipo, tamanhoPermitido } from '../../../lib/anexos/conteudo';
import { gravarAnexo } from '../../../lib/anexos/armazenamento';
import { limparNomeArquivo } from '../../../lib/anexos/nome';
import { getAuth } from '../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../lib/auth/tenant';
import { criarAnexo, ErroOportunidadeNaoEncontrada } from '../../../repositories/anexos';
import { buscarOportunidadePorId } from '../../../repositories/oportunidades';

export const dynamic = 'force-dynamic';

// Bytes iniciais bastam para reconhecer PNG/JPEG/WebP/PDF; o arquivo inteiro
// só é lido depois que o tipo e o tamanho foram aprovados.
const BYTES_DE_CABECALHO = 16;

/** AC-100 (mesmo padrão das outras rotas): `ContextoTenant` da sessão, ou `null` sem tocar em tabela de negócio. */
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

/** AC-095 a AC-100: envia um anexo para um card do tenant da sessão. */
export async function POST(request: NextRequest) {
  const contexto = await resolverContexto(request);
  if (!contexto) return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });

  const formulario = await request.formData().catch(() => null);
  const oportunidadeId = formulario?.get('oportunidadeId');
  const arquivo = formulario?.get('arquivo');
  if (typeof oportunidadeId !== 'string' || !(arquivo instanceof File)) {
    return NextResponse.json({ codigo: 'REQUISICAO_INVALIDA' }, { status: 400 });
  }

  const db = getDb();
  // `oportunidadeId` que nem é uuid nunca existe — mesmo 404 de card alheio.
  const oportunidade = /^[0-9a-f-]{36}$/i.test(oportunidadeId)
    ? await buscarOportunidadePorId(db, contexto, oportunidadeId)
    : null;
  if (!oportunidade) {
    return NextResponse.json({ codigo: 'OPORTUNIDADE_NAO_ENCONTRADA' }, { status: 404 });
  }

  const cabecalho = new Uint8Array(await arquivo.slice(0, BYTES_DE_CABECALHO).arrayBuffer());
  const tipo = detectarTipo(cabecalho);
  if (!tipo) {
    return NextResponse.json({ codigo: 'TIPO_NAO_PERMITIDO' }, { status: 415 });
  }
  if (!tamanhoPermitido(tipo, arquivo.size)) {
    return NextResponse.json({ codigo: 'ARQUIVO_GRANDE_DEMAIS' }, { status: 413 });
  }

  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  const caminho = await gravarAnexo(tipo, bytes);
  try {
    const anexo = await criarAnexo(db, contexto, {
      oportunidadeId: oportunidade.id,
      caminho,
      mime: tipo,
      tamanho: bytes.byteLength,
      hash: createHash('sha256').update(bytes).digest('hex'),
      nome: limparNomeArquivo(arquivo.name),
    });
    return NextResponse.json({ anexoId: anexo.id, url: `/api/anexos/${anexo.id}` }, { status: 201 });
  } catch (erro) {
    if (erro instanceof ErroOportunidadeNaoEncontrada) {
      return NextResponse.json({ codigo: 'OPORTUNIDADE_NAO_ENCONTRADA' }, { status: 404 });
    }
    throw erro;
  }
}
