// T-249 (fase5-whatsapp-lote-base, AC-673): a tela de templates (src/components/whatsapp/templates.tsx).
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Templates } from '../../../src/components/whatsapp/templates';

const T = (id: string, nome: string, status: string, corpo = 'Olá, {{primeiro_nome}}!', aprovadoPorNome: string | null = null, podeEditar = true) => ({ id, nome, corpo, status, aprovadoPorNome, podeEditar });

describe('T-249: tela de templates', () => {
  let podeGerir: boolean;
  let templates: ReturnType<typeof T>[];
  let respostaDoPost: () => Response;
  let chamadas: Array<{ url: string; init?: RequestInit }>;

  beforeEach(() => {
    podeGerir = true;
    templates = [T('t1', 'Boas-vindas', 'aprovado', 'Olá, {{primeiro_nome}}!', 'Karol Mendes', false), T('t2', 'Retorno', 'rascunho', 'Oi {{nome}}')];
    respostaDoPost = () => new Response(JSON.stringify({ id: 't3' }), { status: 201 });
    chamadas = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        chamadas.push({ url, init });
        if (init?.method === 'POST') return respostaDoPost();
        if (init?.method === 'PATCH') return new Response(JSON.stringify({ id: 't2' }), { status: 200 });
        return new Response(JSON.stringify({ templates, podeGerir }));
      })
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  test('lista com situação e prévia; o gestor vê as ações no painel, o atendente cria mas não edita nem aprova @spec:AC-673', async () => {
    const u = userEvent.setup();
    const { unmount } = render(<Templates />);
    const aprovado = await screen.findByRole('article', { name: 'Template Boas-vindas' });
    expect(within(aprovado).getByText('Aprovado')).toBeTruthy();
    expect(within(aprovado).getByText('Olá, Maria!')).toBeTruthy();
    const rascunho = screen.getByRole('article', { name: 'Template Retorno' });
    expect(within(rascunho).getByText('Oi Maria Souza')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Novo template' })).toBeTruthy();

    await u.click(within(aprovado).getByRole('button'));
    const painel = screen.getByRole('region', { name: 'Painel do template' });
    expect(within(painel).getByText(/Aprovado por Karol Mendes/)).toBeTruthy();
    expect(within(painel).queryByRole('button', { name: /^Aprovar:/ })).toBeNull(); // já aprovado
    expect(within(painel).getByRole('button', { name: 'Editar: Boas-vindas' })).toBeTruthy();
    await u.click(within(rascunho).getByRole('button'));
    expect(within(painel).getByRole('button', { name: 'Aprovar: Retorno' })).toBeTruthy();
    unmount();

    podeGerir = false;
    render(<Templates />);
    await u.click(within(await screen.findByRole('article', { name: 'Template Boas-vindas' })).getByRole('button'));
    expect(screen.getByRole('button', { name: 'Novo template' })).toBeTruthy(); // o atendente também cria
    expect(screen.queryByRole('button', { name: /^(Editar|Aprovar|Arquivar):/ })).toBeNull(); // o de outra pessoa
    await u.click(within(screen.getByRole('article', { name: 'Template Retorno' })).getByRole('button'));
    expect(screen.getByRole('button', { name: 'Editar: Retorno' })).toBeTruthy(); // o que ele criou
    expect(screen.queryByRole('button', { name: /^(Aprovar|Arquivar):/ })).toBeNull();
  });

  test('busca e filtro por situação restringem a lista @spec:AC-673', async () => {
    const u = userEvent.setup();
    render(<Templates />);
    await screen.findByRole('article', { name: 'Template Boas-vindas' });
    await u.click(screen.getByRole('tab', { name: /Rascunhos \(1\)/ }));
    expect(screen.queryByRole('article', { name: 'Template Boas-vindas' })).toBeNull();
    expect(screen.getByRole('article', { name: 'Template Retorno' })).toBeTruthy();
    await u.click(screen.getByRole('tab', { name: /Todos/ }));
    await u.type(screen.getByLabelText('Buscar templates'), 'zzz');
    expect(screen.getByText('Nenhum template encontrado.')).toBeTruthy();
  });

  test('criar mostra a prévia ao digitar, envia e confirma; o erro da API aparece junto do campo @spec:AC-673', async () => {
    const u = userEvent.setup();
    render(<Templates />);
    await u.click(await screen.findByRole('button', { name: 'Novo template' }));
    await u.type(screen.getByLabelText('Nome do template'), 'Promoção');
    await u.click(screen.getByLabelText('Mensagem do template'));
    await u.paste('Oi {{primeiro_nome}}, temos novidades'); // `{{` no `type` é tecla especial
    expect(within(screen.getByLabelText('Prévia da mensagem')).getByText('Oi Maria, temos novidades')).toBeTruthy();

    respostaDoPost = () => new Response(JSON.stringify({ codigo: 'PARAMETRO_INVALIDO', campo: 'corpo', mensagem: 'Variável desconhecida: {{cidade}}. Use {{nome}} ou {{primeiro_nome}}.' }), { status: 400 });
    await u.click(screen.getByRole('button', { name: 'Salvar template' }));
    const campo = screen.getByLabelText('Mensagem do template').closest('label')!;
    expect((await within(campo).findByRole('alert')).textContent).toContain('Variável desconhecida');

    respostaDoPost = () => new Response(JSON.stringify({ id: 't3' }), { status: 201 });
    await u.click(screen.getByRole('button', { name: 'Salvar template' }));
    expect(await screen.findByText('Template criado e pronto para uso')).toBeTruthy();
    const posts = chamadas.filter((c) => c.init?.method === 'POST');
    expect(JSON.parse(String(posts.at(-1)!.init!.body))).toEqual({ nome: 'Promoção', corpo: 'Oi {{primeiro_nome}}, temos novidades' });
  });

  test('os shortcodes ficam no editor, por grupo, explicam o que viram e o clique insere no cursor @spec:AC-673', async () => {
    const u = userEvent.setup();
    render(<Templates />);
    await screen.findByRole('article', { name: 'Template Boas-vindas' });
    expect(screen.queryByRole('button', { name: /^Inserir/ })).toBeNull(); // sem editor aberto

    await u.click(screen.getByRole('button', { name: 'Novo template' }));
    const campo = screen.getByLabelText('Mensagem do template') as HTMLTextAreaElement;
    await u.click(campo);
    await u.paste('Olá, ! Tudo bem?');
    campo.setSelectionRange(5, 5);
    await u.click(screen.getByRole('button', { name: 'Inserir {{primeiro_nome}}' }));
    expect(campo.value).toBe('Olá, {{primeiro_nome}}! Tudo bem?');

    await u.hover(screen.getByRole('button', { name: 'Inserir {{nome}}' }));
    expect(screen.getByText('O nome completo do lead, como está no cadastro.')).toBeTruthy();

    await u.click(screen.getByRole('tab', { name: /Reunião/ }));
    expect(screen.getByRole('button', { name: 'Inserir {{link_meet}}' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Inserir {{nome}}' })).toBeNull();
  });

  test('aprovar e arquivar chamam a API com a ação @spec:AC-673', async () => {
    const u = userEvent.setup();
    render(<Templates />);
    await u.click(within(await screen.findByRole('article', { name: 'Template Retorno' })).getByRole('button'));
    await u.click(await screen.findByRole('button', { name: 'Aprovar: Retorno' }));
    expect(await screen.findByText('Template aprovado')).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Arquivar: Retorno' }));
    expect(await screen.findByText('Template arquivado')).toBeTruthy();
    const patches = chamadas.filter((c) => c.init?.method === 'PATCH');
    expect(patches.map((p) => [p.url, JSON.parse(String(p.init!.body))])).toEqual([
      ['/api/whatsapp/templates/t2', { acao: 'aprovar' }],
      ['/api/whatsapp/templates/t2', { acao: 'arquivar' }],
    ]);
  });
});
