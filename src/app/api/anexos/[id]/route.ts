// T-056 (fase2c-anexos, US-035): GET /api/anexos/:id — com sessão, checa que o
// anexo é do tenant (404 se não, AC-102) e redireciona (302) para a URL
// assinada de 60 s (AC-101). Quem serve os bytes é /api/anexos/arquivo/:id.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../db/client';
import { rm } from 'node:fs/promises';
import path from 'node:path';

import { diretorioDeAnexos } from '../../../../lib/anexos/armazenamento';
import { assinarUrl } from '../../../../lib/anexos/assinatura';
import { getAuth } from '../../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../../lib/auth/tenant';
import { buscarAnexoPorId } from '../../../../repositories/anexos';
import { excluirAnexo } from '../../../../repositories/anexos-gestao';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await resolverContexto(request);
  if (!contexto) return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });

  const { id } = await params;
  // `id` que nem é uuid nunca existe — mesmo 404 de anexo alheio.
  const anexo = UUID.test(id) ? await buscarAnexoPorId(getDb(), contexto, id) : null;
  if (!anexo) return NextResponse.json({ codigo: 'ANEXO_NAO_ENCONTRADO' }, { status: 404 });

  const { url } = assinarUrl(anexo.id, anexo.empresaId);
  const resposta = NextResponse.redirect(new URL(url, request.url), 302);
  resposta.headers.set('Cache-Control', 'no-store');
  return resposta;
}

const STATUS_DA_EXCLUSAO = { ANEXO_NAO_ENCONTRADO: 404, SEM_PERMISSAO: 403, ANEXO_E_EVIDENCIA: 409 } as const;

/**
 * T-294 (AC-754/AC-755): exclui o anexo — o registro e o arquivo do volume. Gestor exclui qualquer um; os outros, só os que enviaram.
 * Anexo que é evidência não sai (409). O evento `anexo_excluido` na linha do tempo guarda o nome, o tipo, o tamanho e o SHA-256.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await resolverContexto(request);
  if (!contexto) return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });

  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ codigo: 'ANEXO_NAO_ENCONTRADO' }, { status: 404 });

  const resultado = await excluirAnexo(getDb(), contexto, id);
  if (!resultado.ok) return NextResponse.json({ codigo: resultado.codigo }, { status: STATUS_DA_EXCLUSAO[resultado.codigo] });

  // O registro já saiu; o arquivo some em seguida. Se o volume falhar, sobra só um arquivo órfão, sem nenhum registro apontando.
  const completo = path.resolve(diretorioDeAnexos(), resultado.caminho);
  if (path.dirname(completo) === diretorioDeAnexos()) await rm(completo, { force: true }).catch(() => undefined);
  return NextResponse.json({ excluido: true });
}
