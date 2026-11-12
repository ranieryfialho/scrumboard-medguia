// fase6-periodo-personalizado (AC-824): as rotas de lista e de arquivados (e as exportações) recusam período inválido com 400
// `PERIODO_INVALIDO` antes de consultar o banco, e passam o período válido ao repositório. Sem Postgres: a sessão, o tenant e o
// repositório são trocados por dublês, porque aqui só interessa a leitura do `de`/`ate`/`data` na rota.
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { lerPeriodoDaConsulta } from '../../src/domain/pipeline/periodo';

const listarLista = vi.fn();
const listarArquivados = vi.fn();
const exportarLista = vi.fn();
const exportarArquivados = vi.fn();

vi.mock('../../src/db/client', () => ({ getDb: () => ({}) }));
vi.mock('../../src/lib/auth/instancia', () => ({
  getAuth: () => ({ api: { getSession: async () => ({ session: { token: 'token-falso' } }) } }),
}));
vi.mock('../../src/lib/auth/tenant', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/auth/tenant')>()),
  resolverContextoTenant: async () => ({ usuarioId: 'u', empresaId: 'e', papel: 'GERENTE', isSuperAdmin: false }),
}));
vi.mock('../../src/repositories/pipeline-lista', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/repositories/pipeline-lista')>()),
  listarLista: (...args: unknown[]) => listarLista(...args),
  listarArquivados: (...args: unknown[]) => listarArquivados(...args),
}));
vi.mock('../../src/repositories/exportar-carteira', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/repositories/exportar-carteira')>()),
  exportarLista: (...args: unknown[]) => exportarLista(...args),
  exportarArquivados: (...args: unknown[]) => exportarArquivados(...args),
}));

const vazio = { itens: [], total: 0, pagina: 1, porPagina: 10 };
const pedido = (caminho: string) => new NextRequest(`http://localhost${caminho}`);

describe('fase6-periodo-personalizado: leitura e validação do período', () => {
  beforeEach(() => {
    listarLista.mockReset().mockResolvedValue(vazio);
    listarArquivados.mockReset().mockResolvedValue(vazio);
    exportarLista.mockReset().mockResolvedValue({ itens: [], total: 0, excedeu: false });
    exportarArquivados.mockReset().mockResolvedValue({ itens: [], total: 0, excedeu: false });
  });

  test('a função pura aceita o período certo e recusa o errado @spec:AC-824', () => {
    const ler = (consulta: string) => lerPeriodoDaConsulta(new URLSearchParams(consulta));
    expect(ler('de=2026-02-01&ate=2026-02-28&data=movimentacao')).toEqual({ ok: true, periodo: { de: '2026-02-01', ate: '2026-02-28', data: 'movimentacao' } });
    expect(ler('')).toEqual({ ok: true, periodo: { de: undefined, ate: undefined, data: undefined } });
    expect(ler('de=2026-02-01').ok).toBe(true);
    expect(ler('de=01/02/2026').ok).toBe(false); // formato
    expect(ler('de=2026-02-30').ok).toBe(false); // dia que não existe
    expect(ler('de=2026-02-10&ate=2026-02-09').ok).toBe(false); // ate antes de de
    expect(ler('de=2026-02-01&data=criacao').ok).toBe(false); // data desconhecida
  });

  test('a lista responde 400 PERIODO_INVALIDO sem consultar, e repassa o período válido @spec:AC-824', async () => {
    const { GET } = await import('../../src/app/api/oportunidades/lista/route');

    const ruim = await GET(pedido('/api/oportunidades/lista?de=2026-02-10&ate=2026-02-09'));
    expect(ruim.status).toBe(400);
    expect(await ruim.json()).toEqual({ codigo: 'PERIODO_INVALIDO' });
    expect(listarLista).not.toHaveBeenCalled();

    const bom = await GET(pedido('/api/oportunidades/lista?de=2026-02-01&ate=2026-02-28&data=movimentacao'));
    expect(bom.status).toBe(200);
    expect(listarLista.mock.calls[0][2]).toMatchObject({ de: '2026-02-01', ate: '2026-02-28', data: 'movimentacao' });

    listarLista.mockClear();
    await GET(pedido('/api/oportunidades/lista'));
    expect(listarLista.mock.calls[0][2].de).toBeUndefined(); // sem período, o filtro de datas não vale
  });

  test('os arquivados e as duas exportações aplicam a mesma regra @spec:AC-824', async () => {
    const { GET: arquivados } = await import('../../src/app/api/oportunidades/arquivados/route');
    const { GET: exportarDaLista } = await import('../../src/app/api/oportunidades/lista/exportar/route');
    const { GET: exportarDosArquivados } = await import('../../src/app/api/oportunidades/arquivados/exportar/route');

    expect((await arquivados(pedido('/api/oportunidades/arquivados?de=ontem'))).status).toBe(400);
    expect((await exportarDaLista(pedido('/api/oportunidades/lista/exportar?data=criacao'))).status).toBe(400);
    expect((await exportarDosArquivados(pedido('/api/oportunidades/arquivados/exportar?ate=2026-13-01'))).status).toBe(400);
    expect(listarArquivados).not.toHaveBeenCalled();
    expect(exportarLista).not.toHaveBeenCalled();
    expect(exportarArquivados).not.toHaveBeenCalled();

    await arquivados(pedido('/api/oportunidades/arquivados?de=2026-02-01&ate=2026-02-28&data=entrada'));
    expect(listarArquivados.mock.calls[0][2]).toMatchObject({ de: '2026-02-01', ate: '2026-02-28', data: 'entrada' });
  });
});
