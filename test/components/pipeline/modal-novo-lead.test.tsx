// @vitest-environment jsdom
//
// Testes de T-160 (fase4-pipeline-telas, US-106): o modal "Novo Lead no
// Pipeline" (`src/components/pipeline/modal-novo-lead.tsx`) — validação dos
// campos obrigatórios (AC-391) e os dois caminhos de salvar, "Criar Card na
// Entrada" (sem cadência) e "Salvar e Iniciar Cadência" (AC-392). Quem
// decide o que a API faz é `BoardKanban` (`onCriar`/`onCriarEIniciarCadencia`
// aqui mockados) — este arquivo prova só o contrato do formulário.
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ModalNovoLead } from '../../../src/components/pipeline/modal-novo-lead';

afterEach(() => {
  cleanup();
});

const ORIGENS = ['Google Ads', 'Indicação'];
const RESPONSAVEIS = [{ id: 'resp-1', nome: 'Dra. Juliana Rocha' }];

function renderModal(overrides: Partial<Parameters<typeof ModalNovoLead>[0]> = {}) {
  const onFechar = vi.fn();
  const onCriar = vi.fn().mockResolvedValue({ ok: true });
  const onCriarEIniciarCadencia = vi.fn().mockResolvedValue({ ok: true });

  render(
    <ModalNovoLead
      aberto
      origens={ORIGENS}
      responsaveis={RESPONSAVEIS}
      onFechar={onFechar}
      onCriar={onCriar}
      onCriarEIniciarCadencia={onCriarEIniciarCadencia}
      {...overrides}
    />
  );

  return { onFechar, onCriar, onCriarEIniciarCadencia };
}

describe('T-160: ModalNovoLead', () => {
  describe('AC-391: campos obrigatórios vazios impedem o envio', () => {
    test('nome, telefone e origem vazios mostram erro e não chamam onCriar @spec:AC-391', async () => {
      const { onCriar } = renderModal();
      const usuario = userEvent.setup();

      await usuario.click(screen.getByRole('button', { name: 'Criar Card na Entrada' }));

      expect(await screen.findByText('Informe o nome da clínica ou médico.')).toBeTruthy();
      expect(screen.getByText('Informe o telefone.')).toBeTruthy();
      expect(screen.getByText('Selecione a origem do lead.')).toBeTruthy();
      expect(onCriar).not.toHaveBeenCalled();
    });

    test('"Outro" na origem exige o texto da origem @spec:AC-391', async () => {
      const { onCriar } = renderModal();
      const usuario = userEvent.setup();

      await usuario.type(screen.getByLabelText('Nome da Clínica / Médico *'), 'Clínica Vitae');
      await usuario.type(screen.getByLabelText('WhatsApp / Telefone *'), '11988887777');
      await usuario.selectOptions(screen.getByLabelText('Origem do Lead *'), 'Outro');
      await usuario.click(screen.getByRole('button', { name: 'Criar Card na Entrada' }));

      expect(await screen.findByText('Informe a origem.')).toBeTruthy();
      expect(onCriar).not.toHaveBeenCalled();
    });

    test('preenchidos (nome, telefone e origem), chama onCriar com o responsável "sem responsável" e sem cadência @spec:AC-391', async () => {
      const { onCriar, onCriarEIniciarCadencia, onFechar } = renderModal();
      const usuario = userEvent.setup();

      await usuario.type(screen.getByLabelText('Nome da Clínica / Médico *'), 'Clínica Vitae');
      await usuario.type(screen.getByLabelText('WhatsApp / Telefone *'), '11988887777');
      await usuario.selectOptions(screen.getByLabelText('Origem do Lead *'), 'Google Ads');
      await usuario.click(screen.getByRole('button', { name: 'Criar Card na Entrada' }));

      await waitFor(() =>
        expect(onCriar).toHaveBeenCalledWith({
          nome: 'Clínica Vitae',
          telefone: '11988887777',
          email: undefined,
          origem: 'Google Ads',
          responsavelId: undefined,
          valor: undefined,
        })
      );
      expect(onCriarEIniciarCadencia).not.toHaveBeenCalled();
      await waitFor(() => expect(onFechar).toHaveBeenCalledTimes(1));
    });

    test('erro de campo devolvido pela API mostra a mensagem no campo e mantém o modal aberto @spec:AC-391', async () => {
      const onCriar = vi.fn().mockResolvedValue({ ok: false, erro: 'Campo obrigatório ausente.', campo: 'telefone' });
      const { onFechar } = renderModal({ onCriar });
      const usuario = userEvent.setup();

      await usuario.type(screen.getByLabelText('Nome da Clínica / Médico *'), 'Clínica Vitae');
      await usuario.type(screen.getByLabelText('WhatsApp / Telefone *'), '11988887777');
      await usuario.selectOptions(screen.getByLabelText('Origem do Lead *'), 'Google Ads');
      await usuario.click(screen.getByRole('button', { name: 'Criar Card na Entrada' }));

      expect(await screen.findByText('Campo obrigatório ausente.')).toBeTruthy();
      expect(onFechar).not.toHaveBeenCalled();
    });
  });

  describe('AC-392: "Salvar e Iniciar Cadência" usa o caminho com cadência', () => {
    test('clicar em "Salvar e Iniciar Cadência" chama onCriarEIniciarCadencia, não onCriar @spec:AC-392', async () => {
      const { onCriar, onCriarEIniciarCadencia } = renderModal();
      const usuario = userEvent.setup();

      await usuario.type(screen.getByLabelText('Nome da Clínica / Médico *'), 'Instituto Gastro');
      await usuario.type(screen.getByLabelText('WhatsApp / Telefone *'), '11999990000');
      await usuario.selectOptions(screen.getByLabelText('Origem do Lead *'), 'Indicação');
      await usuario.selectOptions(screen.getByLabelText('Responsável Comercial'), 'resp-1');
      await usuario.type(screen.getByLabelText('Valor Estimado do Contrato (Mensal)'), '4200');

      await usuario.click(screen.getByRole('button', { name: 'Salvar e Iniciar Cadência' }));

      await waitFor(() =>
        expect(onCriarEIniciarCadencia).toHaveBeenCalledWith({
          nome: 'Instituto Gastro',
          telefone: '11999990000',
          email: undefined,
          origem: 'Indicação',
          responsavelId: 'resp-1',
          valor: '4200',
        })
      );
      expect(onCriar).not.toHaveBeenCalled();
    });

    test('"Salvar e Iniciar Cadência" também exige os campos obrigatórios @spec:AC-392', async () => {
      const { onCriarEIniciarCadencia } = renderModal();
      const usuario = userEvent.setup();

      await usuario.click(screen.getByRole('button', { name: 'Salvar e Iniciar Cadência' }));

      expect(await screen.findByText('Informe o nome da clínica ou médico.')).toBeTruthy();
      expect(onCriarEIniciarCadencia).not.toHaveBeenCalled();
    });
  });

  test('"Cancelar" fecha o modal sem chamar onCriar nem onCriarEIniciarCadencia', async () => {
    const { onCriar, onCriarEIniciarCadencia, onFechar } = renderModal();
    const usuario = userEvent.setup();

    await usuario.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(onFechar).toHaveBeenCalledTimes(1);
    expect(onCriar).not.toHaveBeenCalled();
    expect(onCriarEIniciarCadencia).not.toHaveBeenCalled();
  });
});
