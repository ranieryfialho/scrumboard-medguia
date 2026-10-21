// Testes de T-121 (fase3-etl-lp): leitor somente leitura da LP
// (src/etl/lp/origem.ts). `fetch` é mockado — nenhum teste aqui faz rede
// de verdade.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  buscarPagina,
  COLUNAS_SELECIONADAS,
  CredenciaisOrigemLp,
  ErroLeituraOrigem,
  ErroOrigemSemCredencial,
  lerTodosCadastros,
  VARIAVEL_AMBIENTE_CHAVE,
  VARIAVEL_AMBIENTE_URL,
} from '../../src/etl/lp/origem';

const CREDENCIAIS: CredenciaisOrigemLp = {
  url: 'https://lp-exemplo.supabase.co',
  chaveServico: 'servico-segredo-abcdef123456',
};

function respostaFetch(
  corpo: unknown,
  opcoes: { status?: number; contentRange?: string } = {}
) {
  const status = opcoes.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (nome: string) => (nome.toLowerCase() === 'content-range' ? opcoes.contentRange ?? null : null),
    },
    json: async () => corpo,
  } as unknown as Response;
}

describe('T-121: select= nunca inclui password_hash (@spec:AC-299)', () => {
  test('COLUNAS_SELECIONADAS não contém password_hash', () => {
    expect(COLUNAS_SELECIONADAS).not.toContain('password_hash');
  });

  test('a URL pedida ao PostgREST nunca inclui password_hash no select=', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaFetch([], { contentRange: '0-0/0' }));

    await buscarPagina(0, 10, CREDENCIAIS, fetchMock);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [urlChamada] = fetchMock.mock.calls[0];
    expect(String(urlChamada)).not.toContain('password_hash');
    expect(String(urlChamada)).toContain(`select=${COLUNAS_SELECIONADAS.join(',')}`);
  });

  test('o erro de leitura nunca expõe password_hash (não há como vazar o que nunca foi lido)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaFetch({ message: 'erro' }, { status: 500 }));

    await expect(buscarPagina(0, 10, CREDENCIAIS, fetchMock)).rejects.toThrow(ErroLeituraOrigem);
    try {
      await buscarPagina(0, 10, CREDENCIAIS, fetchMock);
    } catch (erro) {
      expect(String(erro)).not.toContain('password_hash');
    }
  });
});

describe('T-121: só leitura (GET), nunca escreve na LP (@spec:AC-306)', () => {
  test('a requisição usa método GET', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaFetch([], { contentRange: '0-0/0' }));

    await buscarPagina(0, 10, CREDENCIAIS, fetchMock);

    const [, opcoesChamada] = fetchMock.mock.calls[0];
    expect(opcoesChamada.method).toBe('GET');
  });

  test('o módulo não exporta nenhuma função de escrita', async () => {
    const modulo = await import('../../src/etl/lp/origem');
    const nomesExportados = Object.keys(modulo);
    const nomesDeEscrita = nomesExportados.filter((nome) =>
      /inserir|gravar|atualizar|excluir|deletar|escrever/i.test(nome)
    );
    expect(nomesDeEscrita).toEqual([]);
  });

  test('a chave de acesso nunca aparece crua na mensagem de erro — só mascarada', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaFetch({ message: 'erro' }, { status: 403 }));

    try {
      await buscarPagina(0, 10, CREDENCIAIS, fetchMock);
      throw new Error('deveria ter lançado ErroLeituraOrigem');
    } catch (erro) {
      expect(String(erro)).not.toContain(CREDENCIAIS.chaveServico);
    }
  });

  test('sem as duas variáveis de ambiente, lança ErroOrigemSemCredencial sem fazer rede', async () => {
    const urlOriginal = process.env[VARIAVEL_AMBIENTE_URL];
    const chaveOriginal = process.env[VARIAVEL_AMBIENTE_CHAVE];
    delete process.env[VARIAVEL_AMBIENTE_URL];
    delete process.env[VARIAVEL_AMBIENTE_CHAVE];
    const fetchMock = vi.fn();

    try {
      await expect(buscarPagina(0, 10, undefined, fetchMock)).rejects.toThrow(ErroOrigemSemCredencial);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      if (urlOriginal !== undefined) process.env[VARIAVEL_AMBIENTE_URL] = urlOriginal;
      if (chaveOriginal !== undefined) process.env[VARIAVEL_AMBIENTE_CHAVE] = chaveOriginal;
    }
  });
});

describe('T-121: paginação e total via Content-Range', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
  });

  afterEach(() => {
    fetchMock.mockReset();
  });

  test('buscarPagina devolve as linhas e o total do Content-Range', async () => {
    fetchMock.mockResolvedValue(
      respostaFetch([{ id: 1, name: 'Ana' }], { contentRange: '0-0/3' })
    );

    const resultado = await buscarPagina(0, 1, CREDENCIAIS, fetchMock);

    expect(resultado.linhas).toEqual([{ id: 1, name: 'Ana' }]);
    expect(resultado.total).toBe(3);
  });

  test('lerTodosCadastros percorre todas as páginas até atingir o total', async () => {
    fetchMock
      .mockResolvedValueOnce(respostaFetch([{ id: 1 }, { id: 2 }], { contentRange: '0-1/3' }))
      .mockResolvedValueOnce(respostaFetch([{ id: 3 }], { contentRange: '2-2/3' }));

    const resultado = await lerTodosCadastros(CREDENCIAIS, fetchMock, 2);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(resultado.total).toBe(3);
    expect(resultado.cadastros).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  test('tabela vazia na LP não faz segunda chamada e devolve total 0', async () => {
    fetchMock.mockResolvedValueOnce(respostaFetch([], { contentRange: '*/0' }));

    const resultado = await lerTodosCadastros(CREDENCIAIS, fetchMock, 10);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(resultado).toEqual({ cadastros: [], total: 0 });
  });
});
