// T-293 (fase4-card-abas, US-112, AC-750/AC-751): GET /api/oportunidades/:id/dossie — o dossiê do card num ZIP: todos os anexos
// (pasta `anexos/`, com o nome original) e o `manifesto.csv` com tipo, tamanho, SHA-256 gravado no envio, quem enviou, quando, a
// etapa de evidência e se o arquivo ainda confere com o SHA-256 (ok, divergente ou ausente). Mesmo padrão de sessão e tenant das
// demais rotas de `/api/oportunidades`: 401 antes de tocar no banco; card de outra empresa ou inexistente é 404 (fail-closed).
// Card sem anexo é 422; mais de 100 MB é 413. Um arquivo que sumiu do volume não derruba o dossiê: entra no manifesto como ausente.
import { createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../../db/client';
import { LIMITE_DOSSIE_BYTES, montarManifesto, nomeDoArquivoDoDossie, nomeSeguroNoZip, nomesUnicos, type IntegridadeDoAnexo, type LinhaDoManifesto } from '../../../../../domain/pipeline/dossie';
import { lerAnexo } from '../../../../../lib/anexos/armazenamento';
import { contextoDaSessao } from '../../../../../lib/auth/sessao';
import { criarZip, type ArquivoDoZip } from '../../../../../lib/zip';
import { listarAnexosParaDossie, nomeDoLeadDoCard, registrarDossieExportado } from '../../../../../repositories/anexos-dossie';
import { buscarOportunidadePorId } from '../../../../../repositories/oportunidades';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await contextoDaSessao(request);
  if (!contexto) return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const oportunidade = UUID.test(id) ? await buscarOportunidadePorId(db, contexto, id) : null;
  if (!oportunidade) return NextResponse.json({ codigo: 'OPORTUNIDADE_NAO_ENCONTRADA' }, { status: 404 });

  const anexos = await listarAnexosParaDossie(db, contexto, id);
  if (anexos.length === 0) return NextResponse.json({ codigo: 'SEM_ANEXOS' }, { status: 422 });
  if (anexos.reduce((soma, a) => soma + a.tamanho, 0) > LIMITE_DOSSIE_BYTES) return NextResponse.json({ codigo: 'DOSSIE_GRANDE' }, { status: 413 });

  // Do mais antigo ao mais novo, para o dossiê contar a história na ordem em que aconteceu.
  const ordenados = [...anexos].reverse();
  const nomes = nomesUnicos(ordenados.map((a) => nomeSeguroNoZip(a.nome, a.mime, a.id)));

  const arquivos: ArquivoDoZip[] = [];
  const linhas: LinhaDoManifesto[] = [];
  for (const [i, anexo] of ordenados.entries()) {
    let integridade: IntegridadeDoAnexo = 'ausente';
    const bytes = await lerAnexo(anexo.caminho).catch(() => null);
    if (bytes) {
      integridade = createHash('sha256').update(bytes).digest('hex') === anexo.hash ? 'ok' : 'divergente';
      arquivos.push({ nome: `anexos/${nomes[i]}`, bytes, data: anexo.criadoEm });
    }
    linhas.push({
      arquivo: bytes ? `anexos/${nomes[i]}` : '',
      nomeOriginal: anexo.nome,
      tipo: anexo.mime,
      tamanho: anexo.tamanho,
      sha256: anexo.hash,
      enviadoPor: anexo.enviadoPorNome,
      enviadoEm: anexo.criadoEm,
      evidencia: anexo.evidencia?.etapaNome ?? null,
      integridade,
    });
  }
  const agora = new Date();
  arquivos.push({ nome: 'manifesto.csv', bytes: new TextEncoder().encode(montarManifesto(linhas)), data: agora });
  const zip = criarZip(arquivos);

  await registrarDossieExportado(db, contexto, id, {
    arquivos: arquivos.length - 1,
    divergentes: linhas.filter((l) => l.integridade === 'divergente').length,
    ausentes: linhas.filter((l) => l.integridade === 'ausente').length,
  });

  const leadNome = await nomeDoLeadDoCard(db, contexto, id);
  return new NextResponse(new Uint8Array(zip), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Length': String(zip.length),
      'Content-Disposition': `attachment; filename="${nomeDoArquivoDoDossie(leadNome, agora)}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
