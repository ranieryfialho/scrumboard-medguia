// Testes de T-114 (fase3-etl-sheets, US-075): leitor das abas de leads
// (src/etl/sheets/leitor.ts). Função pura — recebe as linhas já baixadas,
// não precisa de rede nem de Postgres.
import { describe, expect, test } from 'vitest';

import { ESCOPO_SOMENTE_LEITURA, lerAba } from '../../src/etl/sheets/leitor';

describe('T-114: lerAba — colunas por aba (@spec:AC-273)', () => {
  test('sheet1/Página1: nome vem de company_name e especialidade vem de full_name', () => {
    const linhas = [
      ['id', 'company_name', 'full_name', 'phone_number', 'email'],
      ['l:1', 'Clínica Alfa', 'Cardiologia', 'p:+5511981665252', 'alfa@exemplo.com'],
    ];

    const resultado = lerAba('sheet1/Página1', linhas);

    expect(resultado.linhasLidas).toBe(1);
    expect(resultado.leads).toHaveLength(1);
    expect(resultado.leads[0]).toMatchObject({
      metaId: 'l:1',
      nome: 'Clínica Alfa',
      especialidade: 'Cardiologia',
      telefone: 'p:+5511981665252',
      email: 'alfa@exemplo.com',
    });
  });

  test('sheet1/Página2: nome vem de "first name" e especialidade da pergunta do formulário', () => {
    const linhas = [
      ['id', 'first name', 'qual_a_sua_especialidade?', 'phone_number', 'email'],
      ['l:2', 'João Souza', 'Dermatologia', '43996131309', 'joao@exemplo.com'],
    ];

    const resultado = lerAba('sheet1/Página2', linhas);

    expect(resultado.leads[0]).toMatchObject({
      metaId: 'l:2',
      nome: 'João Souza',
      especialidade: 'Dermatologia',
      telefone: '43996131309',
      email: 'joao@exemplo.com',
    });
  });

  test('sheet2/Página1: mesma regra de sheet1/Página2 (first name + especialidade do formulário)', () => {
    const linhas = [
      ['id', 'first_name', 'qual_a_sua_especialidade', 'telefone', 'email'],
      ['l:3', 'Maria Lima', 'Pediatria', '092-991593737', 'maria@exemplo.com'],
    ];

    const resultado = lerAba('sheet2/Página1', linhas);

    expect(resultado.leads[0]).toMatchObject({
      metaId: 'l:3',
      nome: 'Maria Lima',
      especialidade: 'Pediatria',
      telefone: '092-991593737',
      email: 'maria@exemplo.com',
    });
  });

  test('sheet3/Página1: nome vem de "full name" e especialidade da pergunta médica do formulário', () => {
    const linhas = [
      ['id', 'full name', 'qual_a_sua_especialidade_medica?', 'whatsapp', 'email'],
      ['l:4', 'Ana Prado', 'Ortopedia', 'p:+5511999998888', 'ana@exemplo.com'],
    ];

    const resultado = lerAba('sheet3/Página1', linhas);

    expect(resultado.leads[0]).toMatchObject({
      metaId: 'l:4',
      nome: 'Ana Prado',
      especialidade: 'Ortopedia',
      telefone: 'p:+5511999998888',
      email: 'ana@exemplo.com',
    });
  });

  test('aba desconhecida ainda assim lê nome/especialidade/telefone/email por regra genérica', () => {
    const linhas = [
      ['id', 'full_name', 'qual_a_sua_especialidade', 'telefone', 'email'],
      ['l:5', 'Pedro Alves', 'Clínico Geral', '+5511988887777', 'pedro@exemplo.com'],
    ];

    const resultado = lerAba('sheetX/PáginaZ', linhas);

    expect(resultado.leads[0]).toMatchObject({
      metaId: 'l:5',
      nome: 'Pedro Alves',
      especialidade: 'Clínico Geral',
      telefone: '+5511988887777',
      email: 'pedro@exemplo.com',
    });
  });

  test('aba sem nenhuma linha de dados retorna zero leituras, sem erro', () => {
    const resultado = lerAba('sheet1/Página1', [['id', 'company_name', 'full_name']]);
    expect(resultado).toEqual({ aba: 'sheet1/Página1', linhasLidas: 0, leads: [], ignoradas: [] });
  });
});

describe('T-114: lerAba — lead de teste e linha em branco são ignorados e contados (@spec:AC-274)', () => {
  test('lead com is_organic = true é ignorado e contado como lead_de_teste', () => {
    const linhas = [
      ['id', 'company_name', 'full_name', 'phone_number', 'email', 'is_organic'],
      ['l:teste', 'Lead de Teste', 'Teste', 'p:+5511900000000', 'teste@exemplo.com', 'true'],
      ['l:6', 'Clínica Real', 'Cardiologia', 'p:+5511981665252', 'real@exemplo.com', 'false'],
    ];

    const resultado = lerAba('sheet1/Página1', linhas);

    expect(resultado.linhasLidas).toBe(2);
    expect(resultado.leads).toHaveLength(1);
    expect(resultado.leads[0].metaId).toBe('l:6');
    expect(resultado.ignoradas).toEqual([{ linha: 0, motivo: 'lead_de_teste' }]);
  });

  test('lead "dummy data" da Meta é ignorado mesmo sem a coluna is_organic', () => {
    const linhas = [
      ['id', 'first name', 'qual_a_sua_especialidade?', 'phone_number', 'email'],
      ['l:dummy', 'Dummy Data', 'Dummy', 'p:+5511900000001', 'dummy@exemplo.com'],
    ];

    const resultado = lerAba('sheet1/Página2', linhas);

    expect(resultado.leads).toHaveLength(0);
    expect(resultado.ignoradas).toEqual([{ linha: 0, motivo: 'lead_de_teste' }]);
  });

  test('linha sem nome, especialidade, telefone ou e-mail — só com status — é ignorada e contada como linha_em_branco', () => {
    const linhas = [
      ['id', 'company_name', 'full_name', 'phone_number', 'email', 'lead_status'],
      ['l:7', '', '', '', '', 'Em contato'],
      ['l:8', 'Clínica Beta', 'Neurologia', 'p:+5511977776666', 'beta@exemplo.com', 'Novos Leads'],
    ];

    const resultado = lerAba('sheet1/Página1', linhas);

    expect(resultado.linhasLidas).toBe(2);
    expect(resultado.leads).toHaveLength(1);
    expect(resultado.leads[0].metaId).toBe('l:8');
    expect(resultado.ignoradas).toEqual([{ linha: 0, motivo: 'linha_em_branco' }]);
  });

  test('conta cada motivo separadamente quando há teste e linha em branco na mesma aba', () => {
    const linhas = [
      ['id', 'company_name', 'full_name', 'phone_number', 'email', 'is_organic'],
      ['l:teste', 'Dummy Data', 'Teste', 'p:+5511900000000', 'teste@exemplo.com', 'true'],
      ['l:9', '', '', '', '', ''],
      ['l:10', 'Clínica Gama', 'Endocrinologia', 'p:+5511955554444', 'gama@exemplo.com', 'false'],
    ];

    const resultado = lerAba('sheet1/Página1', linhas);

    expect(resultado.linhasLidas).toBe(3);
    expect(resultado.leads).toHaveLength(1);
    expect(resultado.leads[0].metaId).toBe('l:10');
    expect(resultado.ignoradas).toEqual([
      { linha: 0, motivo: 'lead_de_teste' },
      { linha: 1, motivo: 'linha_em_branco' },
    ]);
  });
});

describe('T-114: acesso somente leitura (@spec:AC-291)', () => {
  test('escopo usado é só o de leitura das planilhas', () => {
    expect(ESCOPO_SOMENTE_LEITURA).toBe('https://www.googleapis.com/auth/spreadsheets.readonly');
    expect(ESCOPO_SOMENTE_LEITURA.endsWith('.readonly')).toBe(true);
  });

  test('o módulo não expõe nenhuma função de escrita na planilha', async () => {
    const modulo = await import('../../src/etl/sheets/leitor');
    const nomesExportados = Object.keys(modulo);
    const nomesDeEscrita = nomesExportados.filter((nome) => /escrever|gravar|atualizar|limpar|append/i.test(nome));
    expect(nomesDeEscrita).toEqual([]);
  });
});
