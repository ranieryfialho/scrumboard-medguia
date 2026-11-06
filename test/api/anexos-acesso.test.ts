// Testes de T-056 (fase2c-anexos, US-035): rotas GET /api/anexos/:id (emite a
// URL assinada) e GET /api/anexos/arquivo/:id (entrega os bytes), contra um
// Postgres 15 efêmero real com dois tenants.
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { assinarUrl } from '../../src/lib/anexos/assinatura';
import { PNG, prepararAmbienteAnexos, preencher, type AmbienteAnexos } from '../support/api-anexos';

const CONTEUDO = preencher(PNG, 2048);

describe('T-056: rotas de acesso a anexos', () => {
  let amb: AmbienteAnexos;
  let rotaUpload: typeof import('../../src/app/api/anexos/route');
  let rotaEmissao: typeof import('../../src/app/api/anexos/[id]/route');
  let rotaArquivo: typeof import('../../src/app/api/anexos/arquivo/[id]/route');
  let anexoId: string;

  async function emitir(id: string, cookie: string | null) {
    const request = new NextRequest(`http://localhost/api/anexos/${id}`, {
      headers: cookie ? { Cookie: cookie } : {},
    });
    return rotaEmissao.GET(request, { params: Promise.resolve({ id }) });
  }

  async function abrir(urlRelativa: string) {
    const request = new NextRequest(new URL(urlRelativa, 'http://localhost'));
    const id = request.nextUrl.pathname.split('/').pop()!;
    return rotaArquivo.GET(request, { params: Promise.resolve({ id }) });
  }

  beforeAll(async () => {
    amb = await prepararAmbienteAnexos();
    rotaUpload = await import('../../src/app/api/anexos/route');
    rotaEmissao = await import('../../src/app/api/anexos/[id]/route');
    rotaArquivo = await import('../../src/app/api/anexos/arquivo/[id]/route');

    const form = new FormData();
    form.set('oportunidadeId', amb.tenants.oportunidadeA);
    form.set('arquivo', new File([CONTEUDO as BlobPart], 'print.png', { type: 'image/png' }));
    const resposta = await rotaUpload.POST(
      new NextRequest('http://localhost/api/anexos', { method: 'POST', headers: { Cookie: amb.cookieA }, body: form })
    );
    anexoId = (await resposta.json()).anexoId;
  }, 120_000);

  afterAll(async () => {
    await amb?.parar();
  });

  test('dono do tenant: 302 para URL assinada que expira em 60 s @spec:AC-101', async () => {
    const antes = Math.floor(Date.now() / 1000);
    const resposta = await emitir(anexoId, amb.cookieA);

    expect(resposta.status).toBe(302);
    // Caminho relativo: não carrega o host interno do servidor (`0.0.0.0:3000` em produção), o navegador resolve no domínio de quem acessa.
    expect(resposta.headers.get('location')).toMatch(/^\/api\/anexos\/arquivo\//);
    const destino = new URL(resposta.headers.get('location')!, 'http://localhost');
    expect(destino.pathname).toBe(`/api/anexos/arquivo/${anexoId}`);
    expect(destino.searchParams.get('emp')).toBe(amb.tenants.empresaA);
    const exp = Number(destino.searchParams.get('exp'));
    expect(exp).toBeGreaterThanOrEqual(antes + 60);
    expect(exp).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 60);
    expect(destino.searchParams.get('sig')).toMatch(/^[0-9a-f]{64}$/);
  });

  test('outro tenant ou id inexistente: 404 e nenhuma URL emitida @spec:AC-102', async () => {
    const alheio = await emitir(anexoId, amb.cookieB);
    const inexistente = await emitir('ffffffff-ffff-ffff-ffff-ffffffffffff', amb.cookieA);

    expect(alheio.status).toBe(404);
    expect((await alheio.json()).codigo).toBe('ANEXO_NAO_ENCONTRADO');
    expect(alheio.headers.get('location')).toBeNull();
    expect(inexistente.status).toBe(404);
  });

  test('sem sessão: 401 e nenhuma URL emitida @spec:AC-100', async () => {
    const resposta = await emitir(anexoId, null);

    expect(resposta.status).toBe(401);
    expect((await resposta.json()).codigo).toBe('NAO_AUTENTICADO');
    expect(resposta.headers.get('location')).toBeNull();
  });

  test('URL assinada válida entrega os mesmos bytes com o tipo gravado, sem cookie @spec:AC-103', async () => {
    const emissao = await emitir(anexoId, amb.cookieA);
    const resposta = await abrir(emissao.headers.get('location')!);

    expect(resposta.status).toBe(200);
    expect(resposta.headers.get('content-type')).toBe('image/png');
    expect(resposta.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await resposta.arrayBuffer())).toEqual(Buffer.from(CONTEUDO));
  });

  test('URL expirada, adulterada ou de outra empresa: 403 sem entregar nada @spec:AC-104', async () => {
    // Expirada: assinada há 2 minutos.
    const expirada = assinarUrl(anexoId, amb.tenants.empresaA, Date.now() - 120_000).url;
    const respostaExpirada = await abrir(expirada);
    expect(respostaExpirada.status).toBe(403);
    expect((await respostaExpirada.json()).codigo).toBe('LINK_INVALIDO');

    const valida = assinarUrl(anexoId, amb.tenants.empresaA).url;
    // Assinatura adulterada.
    const sig = new URL(valida, 'http://localhost').searchParams.get('sig')!;
    const trocada = sig.slice(0, -1) + (sig.endsWith('0') ? '1' : '0');
    expect((await abrir(valida.replace(sig, trocada))).status).toBe(403);
    // Empresa trocada na URL (tentando ler pelo tenant B) invalida a assinatura.
    expect((await abrir(valida.replace(amb.tenants.empresaA, amb.tenants.empresaB))).status).toBe(403);
    // Sem parâmetros.
    expect((await abrir(`/api/anexos/arquivo/${anexoId}`)).status).toBe(403);
  });
});
