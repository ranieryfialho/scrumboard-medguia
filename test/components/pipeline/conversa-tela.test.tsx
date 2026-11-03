// @vitest-environment jsdom
//
// Testes de T-174 (fase4-card-abas, US-114): a tela da conversa de WhatsApp do
// lead (`/pipeline/[id]/conversa`), dentro do `MoldeDoCard`. Fetch falso e um
// `EventSource` falso para o evento `mensagem.recebida`. O molde (cabeçalho e
// abas) tem prova própria em molde-do-card.test.tsx.
import { Suspense } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import PipelineConversaPage from '../../../src/app/(app)/pipeline/[id]/conversa/page';
import { EVENTO_CONTADORES_MUDARAM } from '../../../src/components/shell/use-contadores';

const CARD_ID = 'cccccccc-0000-0000-0000-0000000000c1';
const LEAD_ID = 'lead-1';
const CARD = { id: CARD_ID, leadId: LEAD_ID, etapaId: 11, leadNome: 'Clínica Santa Luzia', responsavelNome: 'Karol Mendes', version: 3 };

const PRINCIPAL = '5511988887777';
const EXTRA = '5511977776666';

function diaAs(diasAtras: number, hora: number): string {
  const data = new Date();
  data.setDate(data.getDate() - diasAtras);
  data.setHours(hora, 0, 0, 0);
  return data.toISOString();
}

interface MensagemTeste {
  id: string;
  mensagem: string;
  direcao: 'enviada' | 'recebida';
  created_at: string;
  numero: string;
  status: string;
}

const MENSAGENS: MensagemTeste[] = [
  { id: 'm3', mensagem: 'Combinado, fico no aguardo.', direcao: 'enviada', created_at: diaAs(0, 11), numero: PRINCIPAL, status: 'lida' },
  { id: 'm1', mensagem: 'Bom dia, doutor.', direcao: 'enviada', created_at: diaAs(3, 9), numero: PRINCIPAL, status: 'entregue' },
  { id: 'm2', mensagem: 'Bom dia! Pode me mandar a proposta?', direcao: 'recebida', created_at: diaAs(1, 15), numero: PRINCIPAL, status: 'entregue' },
  { id: 'm4', mensagem: 'Aqui é da recepção.', direcao: 'recebida', created_at: diaAs(0, 10), numero: EXTRA, status: 'entregue' },
];

function resposta(status: number, corpo: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) } as Response);
}

class EventSourceFalso {
  static instancias: EventSourceFalso[] = [];
  ouvintes = new Map<string, Array<(evento: MessageEvent) => void>>();
  fechado = false;
  constructor(public url: string) {
    EventSourceFalso.instancias.push(this);
  }
  addEventListener(tipo: string, ouvinte: (evento: MessageEvent) => void) {
    this.ouvintes.set(tipo, [...(this.ouvintes.get(tipo) ?? []), ouvinte]);
  }
  close() {
    this.fechado = true;
  }
  disparar(tipo: string, dados: unknown) {
    for (const ouvinte of this.ouvintes.get(tipo) ?? []) ouvinte({ data: JSON.stringify(dados) } as MessageEvent);
  }
}

const fetchOriginal = globalThis.fetch;
const eventSourceOriginal = (globalThis as { EventSource?: unknown }).EventSource;
let fetchFalso: ReturnType<typeof vi.fn>;
let mensagensDoServidor: MensagemTeste[];
let telefones: Array<{ id?: string; numero: string; rotulo?: string | null; principal: boolean }>;
let statusDoWhatsapp: { state: string; instance: string | null };
let notas: Array<{ id: string; texto: string; autorNome: string | null; ocorridoEm: string }>;
let respostaDasMensagens: () => Promise<Response>;
let respostaDoEnvio: () => Promise<Response>;
let respostaDoNovoNumero: () => Promise<Response>;
let templatesDoServidor: Array<{ id: string; nome: string; corpo: string; status: string }>;
const rolar = vi.fn();

function chamadas(metodo: 'GET' | 'POST', caminho: string) {
  return fetchFalso.mock.calls.filter(
    ([url, init]) => url === caminho && ((init as RequestInit | undefined)?.method ?? 'GET') === metodo
  );
}

function corpoDoPost(caminho: string, indice = 0) {
  return JSON.parse((chamadas('POST', caminho)[indice][1] as RequestInit).body as string);
}

beforeEach(() => {
  mensagensDoServidor = MENSAGENS;
  telefones = [
    { numero: PRINCIPAL, principal: true },
    { id: 'tel-2', numero: EXTRA, rotulo: 'Recepção', principal: false },
  ];
  statusDoWhatsapp = { state: 'open', instance: 'Instância Matriz' };
  notas = [{ id: 'n1', texto: 'Pediu reforço de segurança.', autorNome: 'Dra. Juliana', ocorridoEm: diaAs(0, 12) }];
  respostaDasMensagens = () => resposta(200, { mensagens: mensagensDoServidor });
  respostaDoEnvio = () => resposta(200, { id: 'novo' });
  respostaDoNovoNumero = () => resposta(201, { id: 'tel-3', numero: '5511933332222', rotulo: 'Financeiro' });
  templatesDoServidor = [
    { id: 't1', nome: 'Link de Reunião', corpo: 'Olá {{primeiro_nome}}, segue o link da reunião.', status: 'aprovado' },
    { id: 't2', nome: 'Minuta do Contrato', corpo: 'Olá {{nome}}, segue a minuta.', status: 'aprovado' },
    { id: 't3', nome: 'Ainda em rascunho', corpo: 'não deve aparecer', status: 'rascunho' },
  ];
  EventSourceFalso.instancias = [];
  (globalThis as { EventSource?: unknown }).EventSource = EventSourceFalso;
  Element.prototype.scrollIntoView = rolar;
  rolar.mockClear();

  fetchFalso = vi.fn((url: string, init?: RequestInit) => {
    const metodo = init?.method ?? 'GET';
    if (url === `/api/oportunidades/${CARD_ID}`) return resposta(200, CARD);
    if (url === `/api/oportunidades/${CARD_ID}/anexos`) return resposta(200, { anexos: [] });
    if (url === `/api/oportunidades/${CARD_ID}/cadencia`) {
      return resposta(200, {
        iniciada: true,
        concluidos: 2,
        total: 18,
        toqueDaVez: { sequencia: 3, dia: 1, turno: 'manha', canal: 'telefone' },
      });
    }
    if (url === `/api/oportunidades/${CARD_ID}/linha-do-tempo?tipo=anotacao`) return resposta(200, { itens: notas });
    if (url === `/api/oportunidades/${CARD_ID}/anotacoes` && metodo === 'POST') return resposta(201, {});
    if (url === `/api/whatsapp/messages?leadId=${LEAD_ID}`) return respostaDasMensagens();
    if (url === `/api/leads/${LEAD_ID}/telefones` && metodo === 'GET') return resposta(200, { telefones });
    if (url === '/api/whatsapp/status') return resposta(200, statusDoWhatsapp);
    if (url === '/api/whatsapp/lidas' && metodo === 'POST') return resposta(200, { atualizadas: 1 });
    if (url === '/api/whatsapp/send' && metodo === 'POST') return respostaDoEnvio();
    if (url === '/api/whatsapp/templates') return resposta(200, { templates: templatesDoServidor, podeGerir: false });
    if (url === `/api/leads/${LEAD_ID}/telefones` && metodo === 'POST') return respostaDoNovoNumero();
    return resposta(404, { codigo: 'NAO_ENCONTRADO' });
  });
  globalThis.fetch = fetchFalso as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = fetchOriginal;
  (globalThis as { EventSource?: unknown }).EventSource = eventSourceOriginal;
});

async function montar() {
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <PipelineConversaPage params={Promise.resolve({ id: CARD_ID })} />
      </Suspense>
    );
  });
}

async function abrirTela() {
  await montar();
  await screen.findByText('Combinado, fico no aguardo.');
}

describe('T-174: tela da conversa de WhatsApp do lead', () => {
  describe('AC-437: a conversa do lead aparece com o histórico completo', () => {
    test('mostra as mensagens em ordem de hora, separadas por dia, com hora e status nas enviadas @spec:AC-437', async () => {
      await abrirTela();

      const conversa = screen.getByRole('region', { name: 'Conversa do WhatsApp' });
      const textos = Array.from(conversa.querySelectorAll('[data-direcao]')).map((el) => el.querySelector('p')!.textContent);
      expect(textos).toEqual(['Bom dia, doutor.', 'Bom dia! Pode me mandar a proposta?', 'Combinado, fico no aguardo.']);

      expect(within(conversa).getByText('Hoje')).toBeTruthy();
      expect(within(conversa).getByText('Ontem')).toBeTruthy();
      expect(within(conversa).getAllByText(/^\d{2}\/\d{2}\/\d{4}$/).length).toBe(1);

      const doEnviada = conversa.querySelector('[data-direcao="enviada"]') as HTMLElement;
      expect(doEnviada.textContent).toMatch(/\d{2}:\d{2} · entregue/);
      expect((conversa.querySelectorAll('[data-direcao="enviada"]')[1] as HTMLElement).textContent).toMatch(/· lida/);
      expect(conversa.querySelector('[data-direcao="recebida"]')!.textContent).not.toMatch(/· (lida|entregue|enviada)/);
    });

    test('a conversa abre rolada até a mensagem mais recente @spec:AC-437', async () => {
      await abrirTela();

      expect(rolar).toHaveBeenCalled();
    });
  });

  describe('AC-438: o seletor de telefone troca a conversa', () => {
    test('mostra cada número com o rótulo e "Principal", e a conversa passa a valer para o escolhido @spec:AC-438', async () => {
      const usuario = userEvent.setup();
      await abrirTela();

      const seletor = screen.getByLabelText('Telefone da conversa');
      const opcoes = within(seletor).getAllByRole('option').map((o) => o.textContent);
      expect(opcoes).toEqual([`${PRINCIPAL} · Principal`, `${EXTRA} · Recepção`]);
      expect(screen.queryByText('Aqui é da recepção.')).toBeNull();

      await usuario.selectOptions(seletor, '1');
      expect(screen.getByText('Aqui é da recepção.')).toBeTruthy();
      expect(screen.queryByText('Bom dia, doutor.')).toBeNull();
    });

    test('o envio vai para o número escolhido: extra manda o telefoneId, principal não @spec:AC-438', async () => {
      const usuario = userEvent.setup();
      await abrirTela();

      await usuario.type(screen.getByLabelText('Mensagem para o lead'), 'Mensagem pro principal{Enter}');
      await waitFor(() => expect(chamadas('POST', '/api/whatsapp/send')).toHaveLength(1));
      expect(corpoDoPost('/api/whatsapp/send', 0)).toEqual({ mensagem: 'Mensagem pro principal', leadId: LEAD_ID });

      await usuario.selectOptions(screen.getByLabelText('Telefone da conversa'), '1');
      await usuario.type(screen.getByLabelText('Mensagem para o lead'), 'Mensagem pra recepção{Enter}');
      await waitFor(() => expect(chamadas('POST', '/api/whatsapp/send')).toHaveLength(2));
      expect(corpoDoPost('/api/whatsapp/send', 1)).toEqual({ mensagem: 'Mensagem pra recepção', leadId: LEAD_ID, telefoneId: 'tel-2' });
    });
  });

  describe('AC-439: enviar uma mensagem pelo campo da conversa', () => {
    test('Enter envia, o campo é limpo e a conversa é relida; o botão também envia @spec:AC-439', async () => {
      const usuario = userEvent.setup();
      await abrirTela();
      const leiturasAntes = chamadas('GET', `/api/whatsapp/messages?leadId=${LEAD_ID}`).length;

      await usuario.type(screen.getByLabelText('Mensagem para o lead'), 'Olá, tudo bem?{Enter}');

      await waitFor(() => expect(chamadas('POST', '/api/whatsapp/send')).toHaveLength(1));
      await waitFor(() => expect((screen.getByLabelText('Mensagem para o lead') as HTMLTextAreaElement).value).toBe(''));
      expect(chamadas('GET', `/api/whatsapp/messages?leadId=${LEAD_ID}`).length).toBeGreaterThan(leiturasAntes);

      await usuario.type(screen.getByLabelText('Mensagem para o lead'), 'Segunda mensagem');
      await usuario.click(screen.getByRole('button', { name: 'Enviar mensagem' }));
      await waitFor(() => expect(chamadas('POST', '/api/whatsapp/send')).toHaveLength(2));
    });

    test('texto vazio ou só espaços não envia @spec:AC-439', async () => {
      const usuario = userEvent.setup();
      await abrirTela();

      const botao = screen.getByRole('button', { name: 'Enviar mensagem' }) as HTMLButtonElement;
      expect(botao.disabled).toBe(true);
      await usuario.type(screen.getByLabelText('Mensagem para o lead'), '   {Enter}');

      expect(chamadas('POST', '/api/whatsapp/send')).toHaveLength(0);
    });

    test.each([
      [409, 'WHATSAPP_NAO_CONFIGURADO', 'não está configurado'],
      [422, 'NUMERO_SEM_WHATSAPP', 'não tem WhatsApp'],
      [502, 'FALHA_ENVIO', 'Falha no envio'],
    ])('recusa %i %s mostra o motivo e não perde o texto digitado @spec:AC-439', async (status, codigo, trecho) => {
      const usuario = userEvent.setup();
      await abrirTela();

      respostaDoEnvio = () => resposta(status, { codigo });
      await usuario.type(screen.getByLabelText('Mensagem para o lead'), 'Preciso desse texto de volta{Enter}');

      expect((await screen.findByRole('alert', {}, { timeout: 2000 })).textContent).toContain(trecho);
      expect((screen.getByLabelText('Mensagem para o lead') as HTMLTextAreaElement).value).toBe('Preciso desse texto de volta');
    });
  });

  describe('AC-440: abrir a conversa marca as mensagens recebidas como lidas', () => {
    test('marca como lidas e avisa o menu lateral para reler o contador @spec:AC-440', async () => {
      const aviso = vi.fn();
      window.addEventListener(EVENTO_CONTADORES_MUDARAM, aviso);
      await abrirTela();

      await waitFor(() => expect(chamadas('POST', '/api/whatsapp/lidas')).toHaveLength(1));
      expect(corpoDoPost('/api/whatsapp/lidas')).toEqual({ leadId: LEAD_ID });
      await waitFor(() => expect(aviso).toHaveBeenCalled());
      window.removeEventListener(EVENTO_CONTADORES_MUDARAM, aviso);
    });
  });

  describe('AC-441: a conexão do WhatsApp aparece no topo da conversa', () => {
    test('conectada mostra o nome da instância e deixa enviar @spec:AC-441', async () => {
      await abrirTela();

      expect(await screen.findByText('Conectada • Instância Matriz')).toBeTruthy();
      expect((screen.getByLabelText('Mensagem para o lead') as HTMLTextAreaElement).disabled).toBe(false);
    });

    test('desconectada avisa, leva a reconectar e desabilita o envio com a explicação @spec:AC-441', async () => {
      statusDoWhatsapp = { state: 'close', instance: 'Instância Matriz' };
      await abrirTela();

      expect(await screen.findByText(/WhatsApp desconectado/)).toBeTruthy();
      expect(screen.getByRole('link', { name: 'Reconectar o WhatsApp' }).getAttribute('href')).toBe('/whatsapp/conexao');
      expect((screen.getByLabelText('Mensagem para o lead') as HTMLTextAreaElement).disabled).toBe(true);
      expect(screen.getByText(/envio fica desabilitado/)).toBeTruthy();
    });

    test('não configurada leva à configuração do WhatsApp @spec:AC-441', async () => {
      statusDoWhatsapp = { state: 'not_configured', instance: null };
      await abrirTela();

      expect(await screen.findByText(/WhatsApp não configurado/)).toBeTruthy();
      expect(screen.getByRole('link', { name: 'Configurar o WhatsApp' }).getAttribute('href')).toBe('/whatsapp/configuracao');
    });
  });

  describe('AC-442: mensagem nova do lead aparece sem recarregar', () => {
    test('o evento do stream para este lead relê a conversa e marca como lida @spec:AC-442', async () => {
      await abrirTela();
      const origem = EventSourceFalso.instancias.find((i) => i.url === '/api/stream' && i.ouvintes.has('mensagem.recebida'))!;
      const leiturasAntes = chamadas('GET', `/api/whatsapp/messages?leadId=${LEAD_ID}`).length;
      const lidasAntes = chamadas('POST', '/api/whatsapp/lidas').length;

      mensagensDoServidor = [
        ...MENSAGENS,
        { id: 'm9', mensagem: 'Chegou agora!', direcao: 'recebida', created_at: diaAs(0, 12), numero: PRINCIPAL, status: 'entregue' },
      ];
      await act(async () => {
        origem.disparar('mensagem.recebida', { empresaId: 'e1', leadId: LEAD_ID, mensagemId: 'm9', ocorridoEm: new Date().toISOString() });
      });

      expect(await screen.findByText('Chegou agora!')).toBeTruthy();
      expect(chamadas('GET', `/api/whatsapp/messages?leadId=${LEAD_ID}`).length).toBeGreaterThan(leiturasAntes);
      await waitFor(() => expect(chamadas('POST', '/api/whatsapp/lidas').length).toBeGreaterThan(lidasAntes));
    });

    test('mensagem de outro lead não mexe nesta conversa e a conexão fecha ao sair @spec:AC-442', async () => {
      await abrirTela();
      const origem = EventSourceFalso.instancias.find((i) => i.ouvintes.has('mensagem.recebida'))!;
      const leiturasAntes = chamadas('GET', `/api/whatsapp/messages?leadId=${LEAD_ID}`).length;

      await act(async () => {
        origem.disparar('mensagem.recebida', { empresaId: 'e1', leadId: 'outro-lead', mensagemId: 'x', ocorridoEm: new Date().toISOString() });
      });
      expect(chamadas('GET', `/api/whatsapp/messages?leadId=${LEAD_ID}`)).toHaveLength(leiturasAntes);

      cleanup();
      expect(origem.fechado).toBe(true);
    });
  });

  describe('AC-443: o painel lateral mostra a cadência e as anotações internas do card', () => {
    test('mostra o toque atual e o progresso da cadência, sem proposta nem qualificação @spec:AC-443', async () => {
      await abrirTela();

      const painel = await screen.findByRole('complementary', { name: 'Painel do card' });
      await waitFor(() => expect(within(painel).getByText(/Progresso: 2 de 18 toques/)).toBeTruthy());
      expect(within(painel).getByText(/#3 · Dia 1, Manhã \(Ligação\)/)).toBeTruthy();
      expect(within(painel).getByRole('link', { name: 'Ver a cadência completa' }).getAttribute('href')).toBe(`/pipeline/${CARD_ID}/cadencia`);

      expect(screen.queryByText(/Dados da Proposta/)).toBeNull();
      expect(screen.queryByText(/Qualificação Técnica/)).toBeNull();
    });

    test('lista as notas internas e o campo rápido grava uma nova anotação no card @spec:AC-443', async () => {
      const usuario = userEvent.setup();
      await abrirTela();

      expect(await screen.findByText('Pediu reforço de segurança.')).toBeTruthy();
      expect(screen.getByText('Dra. Juliana')).toBeTruthy();

      notas = [{ id: 'n2', texto: 'Ligar amanhã cedo.', autorNome: 'Karol Mendes', ocorridoEm: diaAs(0, 13) }, ...notas];
      await usuario.type(screen.getByLabelText('Adicionar nota interna rápida'), 'Ligar amanhã cedo.{Enter}');

      await waitFor(() => expect(chamadas('POST', `/api/oportunidades/${CARD_ID}/anotacoes`)).toHaveLength(1));
      expect(corpoDoPost(`/api/oportunidades/${CARD_ID}/anotacoes`)).toEqual({ texto: 'Ligar amanhã cedo.' });
      expect(await screen.findByText('Ligar amanhã cedo.')).toBeTruthy();
      expect((screen.getByLabelText('Adicionar nota interna rápida') as HTMLInputElement).value).toBe('');
    });
  });

  describe('AC-444: o que ainda não tem backend segue "em breve"', () => {
    test('anexar arquivo fica "em breve" e não dispara nada @spec:AC-444', async () => {
      const usuario = userEvent.setup();
      await abrirTela();

      expect(screen.getByText('Anexar arquivo').closest('*[class*="rounded"], *[class*="py-1"]')!.textContent!.toLowerCase()).toContain('em breve');

      const antes = fetchFalso.mock.calls.length;
      await usuario.click(screen.getByText('Anexar arquivo'));
      expect(fetchFalso.mock.calls.length).toBe(antes);
    });
  });

  describe('AC-740: novo número, busca e menu da conversa', () => {
    test('"Novo Número" cadastra o telefone extra e a conversa passa a listá-lo; um erro do servidor mostra o motivo e mantém o que foi digitado @spec:AC-740', async () => {
      const usuario = userEvent.setup();
      await abrirTela();

      await usuario.click(screen.getByRole('button', { name: 'Novo Número' }));
      await usuario.type(screen.getByLabelText('Telefone *'), '11 93333-2222');
      await usuario.type(screen.getByLabelText('Rótulo'), 'Financeiro');

      respostaDoNovoNumero = () => resposta(409, { codigo: 'TELEFONE_DUPLICADO' });
      await usuario.click(screen.getByRole('button', { name: 'Adicionar' }));
      expect((await screen.findByRole('alert')).textContent).toContain('já está cadastrado');
      expect((screen.getByLabelText('Telefone *') as HTMLInputElement).value).toBe('11 93333-2222');

      respostaDoNovoNumero = () => resposta(201, { id: 'tel-3', numero: '5511933332222', rotulo: 'Financeiro' });
      telefones = [...telefones, { id: 'tel-3', numero: '5511933332222', rotulo: 'Financeiro', principal: false }];
      await usuario.click(screen.getByRole('button', { name: 'Adicionar' }));

      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Novo número' })).toBeNull());
      expect(corpoDoPost(`/api/leads/${LEAD_ID}/telefones`, 1)).toEqual({ numero: '11 93333-2222', rotulo: 'Financeiro' });
      expect(await screen.findByRole('option', { name: /Financeiro/ })).toBeTruthy();
    });

    test('a busca filtra as mensagens sem diferenciar acento nem maiúsculas, conta e avisa quando não acha @spec:AC-740', async () => {
      const usuario = userEvent.setup();
      await abrirTela();

      await usuario.click(screen.getByRole('button', { name: 'Buscar na conversa' }));
      await usuario.type(screen.getByLabelText('Buscar nas mensagens'), 'PROPOSTA');
      expect(screen.getByText('Bom dia! Pode me mandar a proposta?')).toBeTruthy();
      expect(screen.queryByText('Bom dia, doutor.')).toBeNull();
      expect(screen.getByRole('status').textContent).toBe('1 mensagem');

      await usuario.clear(screen.getByLabelText('Buscar nas mensagens'));
      await usuario.type(screen.getByLabelText('Buscar nas mensagens'), 'zzzz');
      expect(await screen.findByText('Nenhuma mensagem encontrada')).toBeTruthy();

      await usuario.click(screen.getByRole('button', { name: 'Buscar na conversa' }));
      expect(screen.getByText('Bom dia, doutor.')).toBeTruthy();
    });

    test('o menu atualiza a conversa, marca como lidas e abre o número no WhatsApp Web @spec:AC-740', async () => {
      const usuario = userEvent.setup();
      await abrirTela();

      await usuario.click(screen.getByRole('button', { name: 'Mais opções' }));
      const web = screen.getByRole('menuitem', { name: /Abrir no WhatsApp Web/ });
      expect(web.getAttribute('href')).toBe(`https://wa.me/${PRINCIPAL}`);

      const mensagensAntes = chamadas('GET', `/api/whatsapp/messages?leadId=${LEAD_ID}`).length;
      await usuario.click(screen.getByRole('menuitem', { name: /Atualizar conversa/ }));
      await waitFor(() => expect(chamadas('GET', `/api/whatsapp/messages?leadId=${LEAD_ID}`).length).toBe(mensagensAntes + 1));
      expect(screen.queryByRole('menu')).toBeNull();

      const lidasAntes = chamadas('POST', '/api/whatsapp/lidas').length;
      await usuario.click(screen.getByRole('button', { name: 'Mais opções' }));
      await usuario.click(screen.getByRole('menuitem', { name: /Marcar como lidas/ }));
      await waitFor(() => expect(chamadas('POST', '/api/whatsapp/lidas').length).toBe(lidasAntes + 1));
    });
  });

  describe('AC-741: respostas rápidas e templates', () => {
    test('só os aprovados aparecem, e escolher um põe o texto com o nome do lead no campo, sem enviar @spec:AC-741', async () => {
      const usuario = userEvent.setup();
      await abrirTela();

      expect(await screen.findByRole('button', { name: /Link de Reunião/ })).toBeTruthy();
      expect(screen.queryByText('Ainda em rascunho')).toBeNull();

      await usuario.click(screen.getByRole('button', { name: /Link de Reunião/ }));
      const campo = screen.getByLabelText('Mensagem para o lead') as HTMLTextAreaElement;
      expect(campo.value).toBe('Olá Clínica, segue o link da reunião.');

      await usuario.click(screen.getByRole('button', { name: 'Templates' }));
      const lista = screen.getByRole('dialog', { name: 'Templates' });
      expect(within(lista).getByText('Olá Clínica Santa Luzia, segue a minuta.')).toBeTruthy();
      await usuario.click(within(lista).getByRole('button', { name: /Minuta do Contrato/ }));
      expect(campo.value).toBe('Olá Clínica, segue o link da reunião.\nOlá Clínica Santa Luzia, segue a minuta.');
      expect(chamadas('POST', '/api/whatsapp/send')).toHaveLength(0);
    });

    test('sem template aprovado, avisa em vez de mostrar atalhos vazios @spec:AC-741', async () => {
      templatesDoServidor = [];
      await abrirTela();

      expect(await screen.findAllByText('Nenhum template aprovado ainda.')).not.toHaveLength(0);
    });
  });

  describe('AC-422: a tela tem estado de vazio e de erro', () => {
    test('sem mensagens mostra o vazio com o próximo passo @spec:AC-422', async () => {
      mensagensDoServidor = [];
      await montar();

      expect(await screen.findByText('Nenhuma mensagem ainda')).toBeTruthy();
      expect(screen.getByText(/escreva a primeira abaixo/)).toBeTruthy();
    });

    test('se a conversa falha, mostra o erro e "Tentar de novo" busca outra vez @spec:AC-422', async () => {
      const usuario = userEvent.setup();
      respostaDasMensagens = () => resposta(500, { codigo: 'ERRO' });
      await montar();

      const tentar = await screen.findByRole('button', { name: /Tentar de novo/ });
      respostaDasMensagens = () => resposta(200, { mensagens: MENSAGENS });
      await usuario.click(tentar);

      expect(await screen.findByText('Combinado, fico no aguardo.')).toBeTruthy();
    });
  });
});
