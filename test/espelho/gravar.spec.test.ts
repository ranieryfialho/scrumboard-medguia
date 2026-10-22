// T-134 (fase3-espelho-sheets, US-095): prova de AC-332, AC-333 e AC-339
// para `src/espelho/gravar.ts`, com um dublê do cliente do Sheets (sem rede
// real).
import { describe, expect, test, vi } from 'vitest';

import { gravarEspelho, NOME_ABA_ESPELHO, type ClienteSheetsEspelho } from '../../src/espelho/gravar';

const SPREADSHEET_ID = 'planilha-1';

/** Dublê do cliente do Sheets: guarda o "estado" da aba e a ordem das chamadas. */
function criarClienteFalso(opcoes: { abaExiste?: boolean } = {}) {
  const chamadas: string[] = [];
  let estadoDaAba: string[][] = opcoes.abaExiste
    ? [
        ['nome', 'etapa'],
        ['Lead velho', 'Entrada de leads'],
        ['Edição manual', 'Inventada'],
      ]
    : [];
  let abaExiste = opcoes.abaExiste ?? false;

  const cliente: ClienteSheetsEspelho = {
    spreadsheets: {
      get: vi.fn(async () => {
        chamadas.push('get');
        return {
          data: {
            sheets: abaExiste ? [{ properties: { title: NOME_ABA_ESPELHO } }] : [],
          },
        };
      }),
      batchUpdate: vi.fn(async () => {
        chamadas.push('batchUpdate');
        abaExiste = true;
        return {};
      }),
      values: {
        clear: vi.fn(async () => {
          chamadas.push('clear');
          estadoDaAba = [];
          return {};
        }),
        update: vi.fn(async (params: { requestBody: { values: string[][] } }) => {
          chamadas.push('update');
          estadoDaAba = params.requestBody.values;
          return {};
        }),
      },
    },
  };

  return { cliente, chamadas, estadoDaAba: () => estadoDaAba, abaExiste: () => abaExiste };
}

describe('T-134: gravar o espelho na aba "Espelho CRM"', () => {
  test('substitui o conteúdo inteiro da aba, sem sobrar linha antiga (@spec:AC-332)', async () => {
    const { cliente, chamadas, estadoDaAba } = criarClienteFalso({ abaExiste: true });
    const linhasNovas = [
      ['nome', 'etapa'],
      ['Carlos Lead', 'Contrato (Ganho)'],
    ];

    await gravarEspelho(cliente, SPREADSHEET_ID, linhasNovas);

    expect(estadoDaAba()).toEqual(linhasNovas);
    expect(chamadas.indexOf('clear')).toBeLessThan(chamadas.indexOf('update'));
    expect(cliente.spreadsheets.batchUpdate).not.toHaveBeenCalled();
  });

  test('cria a aba quando ela ainda não existe, antes de limpar e gravar (@spec:AC-332)', async () => {
    const { cliente, chamadas } = criarClienteFalso({ abaExiste: false });

    await gravarEspelho(cliente, SPREADSHEET_ID, [['nome'], ['Carlos Lead']]);

    expect(cliente.spreadsheets.batchUpdate).toHaveBeenCalledTimes(1);
    expect(chamadas).toEqual(['get', 'batchUpdate', 'clear', 'update']);
  });

  test('edição manual na aba é sobrescrita por completo, sem sobreviver à gravação (@spec:AC-333)', async () => {
    const { cliente, estadoDaAba } = criarClienteFalso({ abaExiste: true });
    expect(estadoDaAba()).toContainEqual(['Edição manual', 'Inventada']);

    const linhasDoCrm = [
      ['nome', 'etapa'],
      ['Carlos Lead', 'Contrato (Ganho)'],
    ];
    await gravarEspelho(cliente, SPREADSHEET_ID, linhasDoCrm);

    expect(estadoDaAba()).toEqual(linhasDoCrm);
    expect(estadoDaAba()).not.toContainEqual(['Edição manual', 'Inventada']);
  });

  test('erro do Sheets ao limpar a aba sobe como exceção, sem ser engolido (@spec:AC-339)', async () => {
    const { cliente } = criarClienteFalso({ abaExiste: true });
    const erroDeIndisponibilidade = new Error('Sheets indisponível');
    (cliente.spreadsheets.values.clear as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      erroDeIndisponibilidade
    );

    await expect(gravarEspelho(cliente, SPREADSHEET_ID, [['nome'], ['Carlos Lead']])).rejects.toThrow(
      'Sheets indisponível'
    );
    expect(cliente.spreadsheets.values.update).not.toHaveBeenCalled();
  });

  test('erro de permissão ao gravar sobe como exceção, sem ser engolido (@spec:AC-339)', async () => {
    const { cliente } = criarClienteFalso({ abaExiste: true });
    const erroDePermissao = new Error('A planilha não tem permissão de escrita para esta conta.');
    (cliente.spreadsheets.values.update as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      erroDePermissao
    );

    await expect(gravarEspelho(cliente, SPREADSHEET_ID, [['nome'], ['Carlos Lead']])).rejects.toThrow(
      'permissão de escrita'
    );
  });
});
