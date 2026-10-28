// T-198 (fase4-campanhas, US-130): a tela de nova campanha e de edição de rascunho
// (src/components/campanhas/nova-campanha.tsx).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

let paramsDaUrl = '';
const empurrar = vi.fn();
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(paramsDaUrl),
  useRouter: () => ({ push: empurrar }),
}));

import { NovaCampanha, lerListaColada } from '../../../src/components/campanhas/nova-campanha';

function resposta(status: number, corpo: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) });
}

describe('T-198: NovaCampanha', () => {
  const fetchOriginal = globalThis.fetch;
  let fetchFalso: ReturnType<typeof vi.fn>;
  let criarResposta: () => Promise<unknown>;
  let patchResposta: () => Promise<unknown>;
  let statusDoRascunho: string;
  let rascunhoStatus: number;

  const chamadas = (metodo: string) => fetchFalso.mock.calls.filter((c) => c[1]?.method === metodo);
  const campo = (rotulo: string) => screen.getByLabelText(rotulo) as HTMLInputElement;

  beforeEach(() => {
    paramsDaUrl = '';
    empurrar.mockReset();
    statusDoRascunho = 'RASCUNHO';
    rascunhoStatus = 200;
    criarResposta = () => resposta(201, { id: 'nova-1', totalDestinatarios: 2, descartadosInvalidos: 0, descartadosRepetidos: 0 });
    patchResposta = () => resposta(200, {});
    fetchFalso = vi.fn((url: string, init?: { method?: string; body?: string }) => {
      if (url.startsWith('/api/campanhas/previa-destinatarios')) {
        const ids = new URL(url, 'http://x').searchParams.get('etapaIds')!.split(',').map(Number);
        const total: Record<number, number> = { 7: 142, 9: 219, 10: 121 };
        return resposta(200, {
          porEtapa: ids.map((id) => ({ etapaId: id, total: total[id] ?? 0 })),
          total: ids.reduce((s, id) => s + (total[id] ?? 0), 0) - (ids.length > 1 ? 10 : 0),
          valorEmPipeline: 840000,
        });
      }
      if (url === '/api/campanhas/rasc-1' && init?.method === 'PATCH') return patchResposta();
      if (url === '/api/campanhas/rasc-1') {
        if (rascunhoStatus !== 200) return resposta(rascunhoStatus, {});
        return resposta(200, {
          campanha: { nome: 'Rascunho antigo', assunto: 'Assunto antigo', corpoHtml: '<p>Corpo antigo</p>', status: statusDoRascunho },
          destinatarios: [{}, {}, {}],
          contagemPorStatus: {},
        });
      }
      if (url === '/api/campanhas' && init?.method === 'POST') return criarResposta();
      return resposta(404, {});
    });
    globalThis.fetch = fetchFalso as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = fetchOriginal;
  });

  test('abre com o título, a volta para a lista e as três seções, dentro do grupo (app) @spec:AC-539', async () => {
    render(<NovaCampanha />);
    expect(screen.getByRole('heading', { name: 'Nova Campanha de Comunicação Médica' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Voltar para Campanhas/ }).getAttribute('href')).toBe('/campanhas');
    for (const nome of ['Identificação e Parâmetros de Disparo', 'Segmentação de Destinatários', 'Composição do E-mail']) {
      expect(screen.getByRole('region', { name: nome })).toBeTruthy();
    }
    expect(existsSync(join(__dirname, '..', '..', '..', 'src/app/(app)/campanhas/nova/page.tsx'))).toBe(true);
    expect(existsSync(join(__dirname, '..', '..', '..', 'src/app/(app)/campanhas/[id]/page.tsx'))).toBe(true);
    cleanup();

    paramsDaUrl = 'rascunho=rasc-1';
    render(<NovaCampanha />);
    expect(await screen.findByRole('heading', { name: 'Editar Campanha' })).toBeTruthy();
    await waitFor(() => expect(campo('Nome interno da campanha').value).toBe('Rascunho antigo'));
    expect(campo('Linha de assunto').value).toBe('Assunto antigo');
    expect(campo('Corpo do e-mail').value).toBe('<p>Corpo antigo</p>');
    expect(screen.getByText('Destinatários já definidos: 3')).toBeTruthy();
    expect(screen.queryByRole('tablist', { name: 'Origem dos destinatários' })).toBeFalsy();
  });

  test('as etapas mostram a contagem real, o total único e a lista colada conta e-mails válidos sem repetir @spec:AC-542', async () => {
    const u = userEvent.setup();
    render(<NovaCampanha />);
    await screen.findByLabelText('Reunião agendada');
    await waitFor(() => expect(screen.getByLabelText('Follow de longo prazo').closest('label')!.textContent).toContain('142'));
    expect(screen.getByLabelText('No-show').closest('label')!.textContent).toContain('219');
    await u.click(screen.getByLabelText('Follow de longo prazo'));
    await u.click(screen.getByLabelText('No-show'));
    await waitFor(() => expect(screen.getByLabelText('Destinatários qualificados').textContent).toBe('351'));
    expect(fetchFalso.mock.calls.some((c) => c[0] === '/api/campanhas/previa-destinatarios?etapaIds=7,9')).toBe(true);
    expect(screen.getByText(/840\.000/)).toBeTruthy();

    await u.click(screen.getByRole('tab', { name: 'Lista colada' }));
    await u.type(screen.getByLabelText('Contatos'), 'Ana, ana@x.com{Enter}Bia;bia@x.com{Enter}ANA, ANA@x.com{Enter}sem-email{Enter}carlos@x.com');
    expect(screen.getByLabelText('Destinatários qualificados').textContent).toBe('3');
    for (const rotulo of ['Especialidade médica predominante', 'Porte da clínica', 'Proteção de frequência']) {
      expect(screen.getByRole('button', { name: `${rotulo} (em breve)` }).getAttribute('aria-disabled')).toBe('true');
    }
    expect(lerListaColada('x@y.com\nx@y.com')).toHaveLength(1);
  });

  test('sem nome, assunto, corpo ou destinatário mostra o que falta e não envia; com tudo cria e navega @spec:AC-543', async () => {
    const u = userEvent.setup();
    render(<NovaCampanha />);
    await screen.findByLabelText('No-show');
    await u.click(screen.getByRole('button', { name: 'Salvar Rascunho' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/o nome da campanha, o assunto, o corpo do e-mail, pelo menos um destinatário/);
    expect(chamadas('POST')).toHaveLength(0);

    await u.type(campo('Nome interno da campanha'), 'Minha campanha');
    await u.type(campo('Linha de assunto'), 'Olá');
    fireEvent.change(campo('Corpo do e-mail'), { target: { value: '<p>Oi</p>' } });
    await u.click(screen.getByLabelText('No-show'));
    await u.click(screen.getByLabelText('Follow de longo prazo'));
    await waitFor(() => expect(screen.getByLabelText('Destinatários qualificados').textContent).not.toBe('0'));

    await u.click(screen.getByRole('button', { name: 'Avançar para Envio & Revisão' }));
    await waitFor(() => expect(chamadas('POST')).toHaveLength(1));
    expect(JSON.parse(chamadas('POST')[0][1].body)).toEqual({
      nome: 'Minha campanha',
      assunto: 'Olá',
      corpoHtml: '<p>Oi</p>',
      origem: { tipo: 'etapas', etapaIds: [9, 7] },
    });
    await waitFor(() => expect(empurrar).toHaveBeenCalledWith('/campanhas/nova-1'));

    empurrar.mockReset();
    await u.click(screen.getByRole('button', { name: 'Salvar Rascunho' }));
    await waitFor(() => expect(empurrar).toHaveBeenCalledWith('/campanhas'));

    // com descartados, avisa antes de seguir
    empurrar.mockReset();
    criarResposta = () => resposta(201, { id: 'nova-2', totalDestinatarios: 5, descartadosInvalidos: 2, descartadosRepetidos: 1 });
    await u.click(screen.getByRole('button', { name: 'Avançar para Envio & Revisão' }));
    expect(await screen.findByText(/Campanha criada com 5 destinatários\. 2 e-mails inválidos e 1 repetidos foram descartados/)).toBeTruthy();
    expect(empurrar).not.toHaveBeenCalled();
    await u.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(empurrar).toHaveBeenCalledWith('/campanhas/nova-2');
  });

  test('editar grava nome, assunto e corpo e volta ao detalhe; campanha iniciada não é editável @spec:AC-544', async () => {
    paramsDaUrl = 'rascunho=rasc-1';
    const u = userEvent.setup();
    render(<NovaCampanha />);
    await waitFor(() => expect(campo('Nome interno da campanha').value).toBe('Rascunho antigo'));
    await u.clear(campo('Linha de assunto'));
    await u.type(campo('Linha de assunto'), 'Assunto novo');
    await u.click(screen.getByRole('button', { name: 'Salvar Rascunho' }));
    await waitFor(() => expect(chamadas('PATCH')).toHaveLength(1));
    expect(JSON.parse(chamadas('PATCH')[0][1].body)).toEqual({ nome: 'Rascunho antigo', assunto: 'Assunto novo', corpoHtml: '<p>Corpo antigo</p>' });
    await waitFor(() => expect(empurrar).toHaveBeenCalledWith('/campanhas/rasc-1'));
    cleanup();

    statusDoRascunho = 'PROCESSANDO';
    render(<NovaCampanha />);
    expect(await screen.findByText('Esta campanha já foi iniciada e não pode ser editada.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Salvar Rascunho' }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();

    statusDoRascunho = 'RASCUNHO';
    patchResposta = () => resposta(409, { codigo: 'CAMPANHA_NAO_EDITAVEL' });
    render(<NovaCampanha />);
    await waitFor(() => expect(campo('Nome interno da campanha').value).toBe('Rascunho antigo'));
    await u.click(screen.getByRole('button', { name: 'Salvar Rascunho' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Esta campanha já foi iniciada e não pode ser editada.');
  });

  test('a prévia isola o HTML, alterna desktop e mobile e a estimativa usa o volume e o pipeline reais @spec:AC-545', async () => {
    const u = userEvent.setup();
    render(<NovaCampanha />);
    await screen.findByLabelText('No-show');
    await u.type(campo('Linha de assunto'), 'Assunto de teste');
    fireEvent.change(campo('Corpo do e-mail'), { target: { value: '<p>Olá</p><script>alert(1)</script>' } });
    const previa = screen.getByRole('region', { name: 'Pré-visualização do Cliente' });
    const quadro = within(previa).getByTitle('Prévia do e-mail') as HTMLIFrameElement;
    expect(quadro.getAttribute('sandbox')).toBe('');
    expect(quadro.getAttribute('srcdoc')).toContain('<p>Olá</p>');
    expect(within(previa).getByText('Assunto de teste')).toBeTruthy();
    expect(quadro.parentElement!.className).not.toMatch(/max-w-\[360px\]/);
    await u.click(within(previa).getByRole('button', { name: 'Mobile' }));
    expect(quadro.parentElement!.className).toMatch(/max-w-\[360px\]/);

    await u.click(screen.getByLabelText('No-show'));
    const estimativa = screen.getByRole('region', { name: 'Estimativa de Impacto Comercial' });
    await waitFor(() => expect(within(estimativa).getByText('219')).toBeTruthy());
    expect(within(estimativa).getByText(/840\.000/)).toBeTruthy();
    expect(screen.queryByText(/Checklist de Qualidade|Taxa média esperada/i)).toBeFalsy();
  });

  test('canal, resposta, remetente, pré-cabeçalho, modelos, variáveis, formatação e e-mail de teste aparecem "em breve" @spec:AC-546', async () => {
    render(<NovaCampanha />);
    for (const rotulo of [
      'Canal de envio',
      'E-mail de resposta',
      'Nome e assinatura do remetente',
      'Texto de pré-cabeçalho',
      'Modelo Institucional',
      'Modelo TISS & Propostas',
      'Modelo Reativação',
      '+ Variável',
      'Barra de formatação',
      'Inserir tag',
      'Enviar E-mail de Teste para Mim',
    ]) {
      expect(screen.getByRole('button', { name: `${rotulo} (em breve)` }).getAttribute('aria-disabled')).toBe('true');
    }
  });

  test('o rascunho carregando mostra esqueleto e a falha mostra erro com "Tentar de novo" @spec:AC-554', async () => {
    paramsDaUrl = 'rascunho=rasc-1';
    render(<NovaCampanha />);
    expect(screen.getByRole('status', { name: 'Carregando' })).toBeTruthy();
    await screen.findByRole('heading', { name: 'Editar Campanha' });
    cleanup();

    rascunhoStatus = 500;
    render(<NovaCampanha />);
    expect(await screen.findByText(/Não foi possível carregar o rascunho/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeTruthy();
  });
});
