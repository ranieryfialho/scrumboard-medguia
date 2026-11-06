// @vitest-environment jsdom
//
// Testes de T-158 (fase4-pipeline-telas): as peças compartilhadas que o
// funil, a lista, os arquivados e o detalhe vão usar — cartão de
// indicador, paginação, selo de etapa, selo "em breve" (AC-393/AC-405) e os
// três estados de tela (AC-413).
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CartaoIndicador } from '../../../src/components/pipeline/pecas/cartao-indicador';
import { Paginacao } from '../../../src/components/pipeline/pecas/paginacao';
import { SeloEtapa } from '../../../src/components/pipeline/pecas/selo-etapa';
import { ItemEmBreve, SeloEmBreve } from '../../../src/components/pipeline/pecas/selo-em-breve';
import { EsqueletoCarregando, EstadoErro, EstadoVazio } from '../../../src/components/pipeline/pecas/estados';

afterEach(() => {
  cleanup();
});

describe('T-158: CartaoIndicador', () => {
  test('mostra título, valor e legenda', () => {
    render(<CartaoIndicador titulo="Cards Ativos" valor="148" legenda="Distribuídos em 13 etapas" icone="group_work" />);

    expect(screen.getByText('Cards Ativos')).toBeTruthy();
    expect(screen.getByText('148')).toBeTruthy();
    expect(screen.getByText('Distribuídos em 13 etapas')).toBeTruthy();
  });

  test('sem legenda, não renderiza a linha de legenda', () => {
    render(<CartaoIndicador titulo="Propostas Ativas" valor="7" icone="payments" />);

    expect(screen.getByText('Propostas Ativas')).toBeTruthy();
    expect(screen.queryByText('Distribuídos em 13 etapas')).toBeNull();
  });
});

describe('T-158: Paginacao', () => {
  test('mostra "Exibindo 11 a 20 de 25"', () => {
    render(<Paginacao pagina={2} porPagina={10} total={25} onMudarPagina={() => {}} rotuloItem="leads" />);

    expect(screen.getByText('11 a 20')).toBeTruthy();
    expect(screen.getByText('25')).toBeTruthy();
  });

  test('clicar numa página chama onMudarPagina com o número certo', async () => {
    const onMudarPagina = vi.fn();
    const usuario = userEvent.setup();

    render(<Paginacao pagina={1} porPagina={10} total={25} onMudarPagina={onMudarPagina} rotuloItem="leads" />);

    await usuario.click(screen.getByRole('button', { name: '2' }));

    expect(onMudarPagina).toHaveBeenCalledWith(2);
  });

  test('com opcoesPorPagina mostra o seletor "Itens por página" e avisa o novo tamanho; sem elas, não mostra', async () => {
    const onMudarPorPagina = vi.fn();
    const usuario = userEvent.setup();

    const { rerender } = render(
      <Paginacao pagina={1} porPagina={10} total={250} onMudarPagina={() => {}} opcoesPorPagina={[10, 20, 50, 100]} onMudarPorPagina={onMudarPorPagina} />
    );
    const seletor = screen.getByLabelText('Itens por página') as HTMLSelectElement;
    expect(Array.from(seletor.options).map((o) => o.value)).toEqual(['10', '20', '50', '100']);
    expect(seletor.value).toBe('10');

    await usuario.selectOptions(seletor, '50');
    expect(onMudarPorPagina).toHaveBeenCalledWith(50);

    rerender(<Paginacao pagina={1} porPagina={10} total={250} onMudarPagina={() => {}} />);
    expect(screen.queryByLabelText('Itens por página')).toBeNull();
  });

  test('na primeira página, "Página anterior" fica desabilitado', () => {
    render(<Paginacao pagina={1} porPagina={10} total={25} onMudarPagina={() => {}} />);

    const anterior = screen.getByRole('button', { name: 'Página anterior' }) as HTMLButtonElement;
    expect(anterior.disabled).toBe(true);
  });

  test('na última página, "Próxima página" fica desabilitado', () => {
    render(<Paginacao pagina={3} porPagina={10} total={25} onMudarPagina={() => {}} />);

    const proxima = screen.getByRole('button', { name: 'Próxima página' }) as HTMLButtonElement;
    expect(proxima.disabled).toBe(true);
  });

  test('total zero mostra a mensagem de nenhum item, sem "Exibindo"', () => {
    render(<Paginacao pagina={1} porPagina={10} total={0} onMudarPagina={() => {}} rotuloItem="cards" />);

    expect(screen.getByText('Nenhum card encontrado')).toBeTruthy();
  });
});

describe('T-158: SeloEtapa', () => {
  test('mostra o nome da etapa', () => {
    render(<SeloEtapa nome="Negociação" />);

    expect(screen.getByText('Negociação')).toBeTruthy();
  });

  test('a mesma etapa recebe sempre a mesma cor de fundo', () => {
    render(
      <>
        <SeloEtapa nome="Proposta" />
        <SeloEtapa nome="Proposta" />
      </>
    );

    const [primeiro, segundo] = screen.getAllByText('Proposta');
    expect(primeiro.parentElement?.className).toBe(segundo.parentElement?.className);
  });
});

describe('T-158: AC-393/AC-405 — peças sem backend ficam visíveis, marcadas "em breve" e inertes', () => {
  describe('AC-393: itens do funil sem backend (busca global, cadência em massa, visões salvas)', () => {
    test('o selo "Em breve" aparece sozinho, para compor num item já existente @spec:AC-393', () => {
      render(<SeloEmBreve />);

      expect(screen.getByText('Em breve')).toBeTruthy();
    });

    test('"Iniciar Cadência em Massa" aparece visível, com o selo, sem link nem onClick @spec:AC-393', async () => {
      const usuario = userEvent.setup();

      render(<ItemEmBreve rotulo="Iniciar Cadência em Massa" icone="bolt" />);

      const item = screen.getByRole('button', { name: 'Iniciar Cadência em Massa (em breve)' });
      expect(item.getAttribute('aria-disabled')).toBe('true');
      expect(item.tagName).toBe('DIV');
      expect(item.getAttribute('href')).toBeNull();
      expect(screen.getByText('Em breve')).toBeTruthy();

      // sem onClick próprio: clicar não lança erro nem muda nada na tela.
      await usuario.click(item);
      expect(screen.getByText('Iniciar Cadência em Massa')).toBeTruthy();
    });
  });

  describe('AC-405: blocos de análise dos arquivados sem backend', () => {
    test.each([
      'Exportar Relatório',
      'Análise de Motivos de Perda',
      'Top Fechamentos do Trimestre',
      'Playbook de Reversão',
    ])('"%s" aparece visível, marcado "em breve" e sem ação @spec:AC-405', (rotulo) => {
      render(<ItemEmBreve rotulo={rotulo} />);

      const item = screen.getByRole('button', { name: `${rotulo} (em breve)` });
      expect(item.getAttribute('aria-disabled')).toBe('true');
      expect(screen.getByText(rotulo)).toBeTruthy();
      expect(screen.getByText('Em breve')).toBeTruthy();
    });
  });
});

describe('T-158: AC-413 — cada tela tem estado de carregamento, vazio e erro', () => {
  test('o esqueleto de carregamento mostra o papel "status" @spec:AC-413', () => {
    render(<EsqueletoCarregando linhas={3} />);

    const esqueleto = screen.getByRole('status', { name: 'Carregando' });
    expect(esqueleto.children.length).toBe(3);
  });

  test('o estado vazio mostra a mensagem com o próximo passo @spec:AC-413', () => {
    render(<EstadoVazio titulo="Nenhum lead ainda" proximoPasso="crie o primeiro" />);

    expect(screen.getByText('Nenhum lead ainda')).toBeTruthy();
    expect(screen.getByText('crie o primeiro')).toBeTruthy();
  });

  test('o estado de erro mostra "Tentar de novo" e chama onTentarDeNovo ao clicar @spec:AC-413', async () => {
    const onTentarDeNovo = vi.fn();
    const usuario = userEvent.setup();

    render(<EstadoErro onTentarDeNovo={onTentarDeNovo} />);

    await usuario.click(screen.getByRole('button', { name: /Tentar de novo/i }));

    expect(onTentarDeNovo).toHaveBeenCalledTimes(1);
  });
});
