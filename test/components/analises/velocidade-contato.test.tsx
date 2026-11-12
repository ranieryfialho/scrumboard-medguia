// fase6-atendimento-lead (US-181): o bloco "Velocidade do 1º contato" do relatório de marketing e a formatação dos tempos.
import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

import { VelocidadeDoContatoBloco, formatarEspera, resumoDoExpediente, type VelocidadeDoContato } from '../../../src/components/analises/velocidade-contato';
import { HORARIO_PADRAO, resumirEsperas } from '../../../src/domain/atendimento/horario-comercial';

afterEach(cleanup);

const velocidade = (corrido: number[], comercial: number[], padrao = true): VelocidadeDoContato => ({
  corrido: resumirEsperas(corrido),
  comercial: resumirEsperas(comercial),
  horario: HORARIO_PADRAO,
  horarioPadrao: padrao,
});

describe('fase6-atendimento-lead: velocidade do 1º contato na tela', () => {
  test('mostra relógio corrido e horário comercial, cada um com mediana, média e quantos leads @spec:AC-804', () => {
    render(<VelocidadeDoContatoBloco velocidade={velocidade([60, 3000, 1500], [30, 600, 400])} />);

    const corrido = screen.getByRole('article', { name: 'Relógio corrido' });
    expect(within(corrido).getByText('3 leads')).toBeTruthy();
    expect(within(corrido).getByText('25 h')).toBeTruthy(); // mediana: 1500 min
    expect(within(corrido).getByText('mediana')).toBeTruthy();
    expect(within(corrido).getByText('média')).toBeTruthy();

    const comercial = screen.getByRole('article', { name: 'Horário comercial' });
    expect(within(comercial).getByText('3 leads')).toBeTruthy();
    expect(within(comercial).getByText('6 h 40 min')).toBeTruthy(); // mediana: 400 min
  });

  test('sem nenhum lead com mensagem enviada mostra "Sem contatos" nos dois lados @spec:AC-804', () => {
    render(<VelocidadeDoContatoBloco velocidade={velocidade([], [])} />);
    expect(screen.getAllByText('Sem contatos')).toHaveLength(2);
  });

  test('as quatro faixas aparecem com quantidade e porcentagem, e somam o total @spec:AC-806', () => {
    render(<VelocidadeDoContatoBloco velocidade={velocidade([30, 100, 300, 2000], [30, 100, 300, 2000])} />);
    const corrido = screen.getByRole('article', { name: 'Relógio corrido' });
    for (const rotulo of ['Até 1 h', '1 a 4 h', '4 a 24 h', 'Mais de 24 h']) expect(within(corrido).getByText(rotulo)).toBeTruthy();
    expect(within(corrido).getAllByText('1 · 25,0%')).toHaveLength(4);
  });

  test('a cor é neutra (não é o verde de "bom") e o rótulo explica o que é medido @spec:AC-807', () => {
    const { container } = render(<VelocidadeDoContatoBloco velocidade={velocidade([60], [60])} />);
    expect(container.querySelector('.text-success-text')).toBeNull();
    expect(screen.getByText(/da entrada do lead até a 1ª mensagem enviada pelo CRM/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Horário comercial: Seg a sex, 09:00–18:00 \(padrão\)/ }).getAttribute('href')).toBe('/configuracoes/horario-atendimento');
  });

  test('formata minutos, horas e dias @spec:AC-804', () => {
    expect(formatarEspera(0.4)).toBe('menos de 1 min');
    expect(formatarEspera(45)).toBe('45 min');
    expect(formatarEspera(1181.8)).toBe('19 h 42 min');
    expect(formatarEspera(180)).toBe('3 h');
    expect(formatarEspera(4500)).toBe('3 d 1 h');
    expect(resumoDoExpediente({ ...HORARIO_PADRAO, sab: { atende: true, abre: '08:00', fecha: '13:00' } })).toBe('Seg a sex, 09:00–18:00 · Sáb, 08:00–13:00');
  });
});
