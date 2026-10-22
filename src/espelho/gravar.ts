// T-134 (fase3-espelho-sheets, US-095): grava as linhas já prontas (T-132)
// na aba "Espelho CRM" da planilha 1 (ASM-114). Só escreve — quem lê o
// banco e monta as linhas é o chamador (T-133/T-132); isso é o que garante
// AC-339: a leitura do banco sempre acontece antes de qualquer alteração na
// planilha, porque `linhas` já chega pronta como parâmetro.
//
// AC-332/AC-333: cada chamada substitui o conteúdo inteiro da aba — `clear`
// seguido de `update` com `valueInputOption: 'RAW'` — então não sobra linha
// de uma execução anterior nem de uma edição manual; os valores já vêm
// protegidos contra fórmula por `montarLinhasDoEspelho` (AC-335), e `RAW`
// não reinterpreta nada.
//
// Cliente do Sheets injetado (interface mínima, não o `sheets_v4.Sheets`
// inteiro) para o teste poder usar um dublê simples; o cliente real do
// Google (criado em T-136, com o escopo de escrita) satisfaz essa
// interface estruturalmente.
//
// Qualquer erro do Sheets (indisponibilidade, permissão) sobe como exceção
// — esta função não tem retry nem engole erro; quem chama (o ciclo do
// worker, T-136) é responsável por registrar a falha sem derrubar o worker
// nem as importações (AC-339).

export const NOME_ABA_ESPELHO = 'Espelho CRM';

export interface ClienteSheetsEspelho {
  spreadsheets: {
    get(params: {
      spreadsheetId: string;
      fields?: string;
    }): Promise<{ data: { sheets?: Array<{ properties?: { title?: string | null } }> } }>;
    batchUpdate(params: {
      spreadsheetId: string;
      requestBody: { requests: Array<{ addSheet: { properties: { title: string } } }> };
    }): Promise<unknown>;
    values: {
      clear(params: { spreadsheetId: string; range: string }): Promise<unknown>;
      update(params: {
        spreadsheetId: string;
        range: string;
        valueInputOption: 'RAW';
        requestBody: { values: string[][] };
      }): Promise<unknown>;
    };
  };
}

/** Cria a aba se ela ainda não existir na planilha — nunca apaga nem recria uma existente. */
async function garantirAbaExiste(
  sheets: ClienteSheetsEspelho,
  spreadsheetId: string,
  nomeAba: string
): Promise<void> {
  const { data } = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties.title',
  });
  const abaJaExiste = (data.sheets ?? []).some((aba) => aba.properties?.title === nomeAba);
  if (abaJaExiste) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: nomeAba } } }],
    },
  });
}

/**
 * Grava `linhas` (saída de `montarLinhasDoEspelho`) na aba "Espelho CRM",
 * substituindo o conteúdo inteiro dela (AC-332, AC-333). `linhas` já deve
 * estar pronta — nenhuma leitura ao banco acontece aqui (AC-339).
 */
export async function gravarEspelho(
  sheets: ClienteSheetsEspelho,
  spreadsheetId: string,
  linhas: string[][],
  nomeAba: string = NOME_ABA_ESPELHO
): Promise<void> {
  await garantirAbaExiste(sheets, spreadsheetId, nomeAba);

  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: nomeAba,
  });

  if (linhas.length === 0) return;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${nomeAba}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: linhas },
  });
}
