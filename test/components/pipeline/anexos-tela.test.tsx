// @vitest-environment jsdom
//
// Testes de T-172 (fase4-card-abas, US-112): a tela de anexos e evidências do
// card (`/pipeline/[id]/anexos`), dentro do `MoldeDoCard`. Fetch falso; o
// molde (cabeçalho e abas) já tem a prova própria em molde-do-card.test.tsx.
import { Suspense } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import PipelineAnexosPage from '../../../src/app/(app)/pipeline/[id]/anexos/page';

const CARD_ID = 'cccccccc-0000-0000-0000-0000000000c1';
const CARD = { id: CARD_ID, leadId: 'lead-1', etapaId: 11, leadNome: 'Clínica Santa Luzia', responsavelNome: 'Karol Mendes', version: 3 };

interface AnexoTeste {
  id: string;
  nome: string | null;
  mime: string;
  tamanho: number;
  hash: string;
  enviadoPorNome: string | null;
  criadoEm: string;
  evidencia: { etapaId: number; etapaNome: string } | null;
}

const PROPOSTA: AnexoTeste = {
  id: 'anx-1',
  nome: 'Proposta Comercial v1.2.pdf',
  mime: 'application/pdf',
  tamanho: 2516582,
  hash: '7f9a0000000000000000000000000000000000000000000000000000000f3c21',
  enviadoPorNome: 'Dra. Juliana Rocha',
  criadoEm: '2026-10-27T14:20:00.000Z',
  evidencia: { etapaId: 11, etapaNome: 'Proposta' },
};
const PRINT: AnexoTeste = {
  id: 'anx-2',
  nome: 'print-aceite.png',
  mime: 'image/png',
  tamanho: 860160,
  hash: 'abcd0000000000000000000000000000000000000000000000000000000012ef',
  enviadoPorNome: 'Ana Clara',
  criadoEm: '2026-10-26T10:00:00.000Z',
  evidencia: null,
};
const ANTIGO: AnexoTeste = {
  id: 'anx-3',
  nome: null,
  mime: 'application/pdf',
  tamanho: 1024,
  hash: '1234000000000000000000000000000000000000000000000000000000005678',
  enviadoPorNome: null,
  criadoEm: '2026-10-20T10:41:00.000Z',
  evidencia: null,
};

function resposta(status: number, corpo: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) } as Response);
}

const fetchOriginal = globalThis.fetch;
let fetchFalso: ReturnType<typeof vi.fn>;
let anexosDoServidor: AnexoTeste[];
let respostaDaLista: () => Promise<Response>;
let respostaDoUpload: () => Promise<Response>;

function chamadas(metodo: 'GET' | 'POST', caminho: string) {
  return fetchFalso.mock.calls.filter(
    ([url, init]) => url === caminho && ((init as RequestInit | undefined)?.method ?? 'GET') === metodo
  );
}

beforeEach(() => {
  anexosDoServidor = [PROPOSTA, PRINT, ANTIGO];
  respostaDaLista = () => resposta(200, { anexos: anexosDoServidor });
  respostaDoUpload = () => resposta(201, { anexoId: 'novo', url: '/api/anexos/novo' });
  fetchFalso = vi.fn((url: string, init?: RequestInit) => {
    if (url === `/api/oportunidades/${CARD_ID}`) return resposta(200, CARD);
    if (url === `/api/oportunidades/${CARD_ID}/anexos`) return respostaDaLista();
    if (url === `/api/oportunidades/${CARD_ID}/cadencia`) return resposta(200, { iniciada: false, concluidos: 0, total: 18 });
    if (url === '/api/anexos' && init?.method === 'POST') return respostaDoUpload();
    return resposta(404, { codigo: 'NAO_ENCONTRADO' });
  });
  globalThis.fetch = fetchFalso as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = fetchOriginal;
});

async function montar() {
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <PipelineAnexosPage params={Promise.resolve({ id: CARD_ID })} />
      </Suspense>
    );
  });
}

async function abrirTela() {
  await montar();
  await screen.findByText('Proposta Comercial v1.2.pdf');
}

function linhaDe(nome: string): HTMLElement {
  return screen.getByRole('heading', { name: nome }).closest('div.bg-surface-card') as HTMLElement;
}

describe('T-172: tela de anexos e evidências', () => {
  describe('AC-424: cada anexo mostra o que o protótipo mostra, e só o que existe', () => {
    test('mostra nome, tamanho, quem enviou, data, início do hash e o selo de evidência com a etapa @spec:AC-424', async () => {
      await abrirTela();

      const linha = within(linhaDe('Proposta Comercial v1.2.pdf'));
      expect(linha.getByText('2,4 MB')).toBeTruthy();
      expect(linha.getByText('Dra. Juliana Rocha')).toBeTruthy();
      expect(linha.getByText(/SHA-256: 7f9a\.\.\.3c21/)).toBeTruthy();
      expect(linha.getByText(/Evidência · Proposta/)).toBeTruthy();
      expect(linha.getByText(/27\/10\/2026|27\/10\/26/)).toBeTruthy();
    });

    test('anexo que nunca foi evidência não tem o selo, e os selos de aprovação do protótipo não existem @spec:AC-424', async () => {
      await abrirTela();

      expect(within(linhaDe('print-aceite.png')).queryByText(/Evidência ·/)).toBeNull();
      expect(screen.queryByText(/aprovad|em revisão|válida/i)).toBeNull();
    });
  });

  describe('AC-425: busca e filtros por tipo restringem a lista', () => {
    test('cada chip mostra a contagem e filtra a lista @spec:AC-425', async () => {
      const usuario = userEvent.setup();
      await abrirTela();

      expect(screen.getByRole('button', { name: 'Todos (3)' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Evidências (1)' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'PDFs (2)' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Imagens (1)' })).toBeTruthy();

      await usuario.click(screen.getByRole('button', { name: 'PDFs (2)' }));
      expect(screen.getByText('Proposta Comercial v1.2.pdf')).toBeTruthy();
      expect(screen.queryByText('print-aceite.png')).toBeNull();

      await usuario.click(screen.getByRole('button', { name: 'Imagens (1)' }));
      expect(screen.getByText('print-aceite.png')).toBeTruthy();
      expect(screen.queryByText('Proposta Comercial v1.2.pdf')).toBeNull();

      await usuario.click(screen.getByRole('button', { name: 'Evidências (1)' }));
      expect(screen.getByText('Proposta Comercial v1.2.pdf')).toBeTruthy();
      expect(screen.queryByText('print-aceite.png')).toBeNull();
    });

    test('a busca por nome combina com o tipo e, sem resultado, a tela avisa @spec:AC-425', async () => {
      const usuario = userEvent.setup();
      await abrirTela();

      await usuario.type(screen.getByLabelText('Buscar anexo por nome'), 'aceite');
      expect(screen.getByText('print-aceite.png')).toBeTruthy();
      expect(screen.queryByText('Proposta Comercial v1.2.pdf')).toBeNull();

      await usuario.click(screen.getByRole('button', { name: 'PDFs (2)' }));
      expect(await screen.findByText('Nenhum anexo com estes filtros')).toBeTruthy();
    });
  });

  describe('AC-426: "Link Seguro" abre o anexo por link de curta duração', () => {
    test('abrir e baixar apontam para a rota assinada /api/anexos/[id], em nova aba e sem opener @spec:AC-426', async () => {
      await abrirTela();

      const linha = within(linhaDe('Proposta Comercial v1.2.pdf'));
      const abrir = linha.getByRole('link', { name: /Link Seguro \(15m\)/ });
      expect(abrir.getAttribute('href')).toBe('/api/anexos/anx-1');
      expect(abrir.getAttribute('target')).toBe('_blank');
      expect(abrir.getAttribute('rel')).toContain('noopener');

      const baixar = linha.getByRole('link', { name: /Baixar Proposta Comercial v1.2.pdf/ });
      expect(baixar.getAttribute('href')).toBe('/api/anexos/anx-1');
      expect(baixar.hasAttribute('download')).toBe(true);
    });
  });

  describe('AC-427: o envio de arquivo aceita escolher e mostra o resultado', () => {
    test('enviar um PDF faz o POST com o card e o arquivo, recarrega a lista e o contador da aba @spec:AC-427', async () => {
      const usuario = userEvent.setup();
      await abrirTela();
      const listasAntes = chamadas('GET', `/api/oportunidades/${CARD_ID}/anexos`).length;

      const arquivo = new File(['%PDF-1.4 conteudo'], 'Contrato.pdf', { type: 'application/pdf' });
      anexosDoServidor = [{ ...PROPOSTA, id: 'novo', nome: 'Contrato.pdf', evidencia: null }, ...anexosDoServidor];
      await usuario.upload(screen.getByLabelText('Escolher arquivos para enviar'), arquivo);

      await waitFor(() => expect(chamadas('POST', '/api/anexos')).toHaveLength(1));
      const corpo = (chamadas('POST', '/api/anexos')[0][1] as RequestInit).body as FormData;
      expect(corpo.get('oportunidadeId')).toBe(CARD_ID);
      expect((corpo.get('arquivo') as File).name).toBe('Contrato.pdf');

      expect(await screen.findByText('Contrato.pdf')).toBeTruthy();
      expect(chamadas('GET', `/api/oportunidades/${CARD_ID}/anexos`).length).toBeGreaterThan(listasAntes);
    });

    test('tipo não permitido e arquivo grande demais mostram o motivo, e nada entra na lista @spec:AC-427', async () => {
      const usuario = userEvent.setup();
      await abrirTela();

      respostaDoUpload = () => resposta(415, { codigo: 'TIPO_NAO_PERMITIDO' });
      await usuario.upload(screen.getByLabelText('Escolher arquivos para enviar'), new File(['x'], 'planilha.exe', { type: 'application/pdf' }));
      expect((await screen.findByRole('alert')).textContent).toContain('tipo de arquivo não permitido');

      respostaDoUpload = () => resposta(413, { codigo: 'ARQUIVO_GRANDE_DEMAIS' });
      await usuario.upload(screen.getByLabelText('Escolher arquivos para enviar'), new File(['x'], 'enorme.pdf', { type: 'application/pdf' }));
      await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('arquivo grande demais'));

      expect(screen.queryByText('planilha.exe')).toBeNull();
      expect(screen.queryByText('enorme.pdf')).toBeNull();
    });

    test('soltar um arquivo na área de envio também envia @spec:AC-427', async () => {
      await abrirTela();

      const arquivo = new File(['%PDF-1.4'], 'arrastado.pdf', { type: 'application/pdf' });
      const area = screen.getByTestId('area-de-envio');
      fireEvent.drop(area, { dataTransfer: { files: [arquivo] } });

      await waitFor(() => expect(chamadas('POST', '/api/anexos')).toHaveLength(1));
    });
  });

  describe('AC-428: o nome original do arquivo é mostrado', () => {
    test('anexo com nome mostra o nome; anexo antigo, sem nome, mostra tipo e data @spec:AC-428', async () => {
      await abrirTela();

      expect(screen.getByText('Proposta Comercial v1.2.pdf')).toBeTruthy();
      expect(screen.getByText(/^Anexo PDF — /)).toBeTruthy();
    });
  });

  describe('AC-429: ações do protótipo sem backend aparecem como "em breve"', () => {
    test('exportar dossiê, excluir, tornar evidência, marcar como evidência e vincular à etapa não disparam nada @spec:AC-429', async () => {
      const usuario = userEvent.setup();
      await abrirTela();

      for (const rotulo of [
        'Exportar Dossiê (ZIP)',
        'Marcar como evidência de transição de etapa',
        'Vincular à etapa',
      ]) {
        expect(screen.getByText(rotulo).closest('*[class*="rounded"]')!.textContent!.toLowerCase()).toContain('em breve');
      }
      expect(within(linhaDe('print-aceite.png')).getByText('Tornar Evidência')).toBeTruthy();
      expect(within(linhaDe('print-aceite.png')).getAllByText('Excluir').length).toBe(1);
      expect(within(linhaDe('Proposta Comercial v1.2.pdf')).queryByText('Tornar Evidência')).toBeNull();

      const antes = fetchFalso.mock.calls.length;
      await usuario.click(screen.getByText('Exportar Dossiê (ZIP)'));
      await usuario.click(within(linhaDe('print-aceite.png')).getByText('Excluir'));
      expect(fetchFalso.mock.calls.length).toBe(antes);
    });

    test('os blocos sem dado do protótipo não aparecem @spec:AC-429', async () => {
      await abrirTela();

      expect(screen.queryByText(/ISO-27799|ISO 27799|Governança/)).toBeNull();
      expect(screen.queryByText(/Espaço utilizado/i)).toBeNull();
    });
  });

  describe('AC-749: a tela tem altura fixa', () => {
    test('o quadro ocupa a altura da tela e só a área dos anexos rola por dentro, contendo também o que é posicionado @spec:AC-749', async () => {
      await abrirTela();

      const raiz = screen.getByRole('navigation', { name: 'Abas do card' }).closest('[class*="lg:h-[calc(100dvh-4rem)]"]') as HTMLElement;
      expect(raiz).toBeTruthy();
      expect(raiz.className).toContain('lg:min-h-[40rem]');

      const rolagem = document.querySelector('.lg\\:overflow-y-auto') as HTMLElement;
      expect(rolagem.className).toContain('lg:min-h-0');
      expect(rolagem.className).toContain('lg:flex-1');
      // `relative` faz a área ser o ancestral dos itens `absolute` (como o campo de arquivo escondido); sem ele eles escapam
      // da rolagem e a página inteira volta a crescer.
      expect(rolagem.className).toContain('relative');
      expect(rolagem.textContent).toContain('Adicionar Arquivos');
      expect(rolagem.contains(screen.getByRole('heading', { name: /Anexos/ }))).toBe(false);
    });
  });

  describe('AC-422: a tela tem estado de vazio e de erro', () => {
    test('sem anexos mostra o vazio com o próximo passo @spec:AC-422', async () => {
      anexosDoServidor = [];
      await montar();

      expect(await screen.findByText('Nenhum anexo ainda')).toBeTruthy();
      expect(screen.getByText(/envie o primeiro/)).toBeTruthy();
    });

    test('se a lista falha, mostra o erro e "Tentar de novo" busca outra vez @spec:AC-422', async () => {
      const usuario = userEvent.setup();
      respostaDaLista = () => resposta(500, { codigo: 'ERRO' });
      await montar();

      const tentar = await screen.findByRole('button', { name: /Tentar de novo/ });
      respostaDaLista = () => resposta(200, { anexos: anexosDoServidor });
      await usuario.click(tentar);

      expect(await screen.findByText('Proposta Comercial v1.2.pdf')).toBeTruthy();
    });
  });
});
