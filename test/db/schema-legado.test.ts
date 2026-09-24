// Testes de T-013 (fase1-schema-drizzle, US-007/US-008): reescritas do
// modelo legado do Supabase com `empresa_id` obrigatório. Introspecção
// estática do schema Drizzle (sem Postgres) — a prova de que as migrations
// aplicam o schema completo num banco limpo é do T-021 (AC-015); o RLS em si
// é do T-015/T-022 (AC-019/AC-020).
import { describe, test, expect } from 'vitest';
import { getTableColumns, getTableName } from 'drizzle-orm';

import { whatsappMensagens, campanhas, enviosCampanha } from '../../src/db/schema';

describe('T-013: reescritas do legado exigem tenant (@spec:AC-018)', () => {
  test('whatsapp_mensagens exige empresa_id, numero, mensagem e direcao', () => {
    expect(getTableName(whatsappMensagens)).toBe('whatsapp_mensagens');
    const columns = getTableColumns(whatsappMensagens);
    expect(columns.empresaId.notNull).toBe(true);
    expect(columns.numero.notNull).toBe(true);
    expect(columns.mensagem.notNull).toBe(true);
    expect(columns.direcao.notNull).toBe(true);
  });

  test('campanhas exige empresa_id, nome, assunto e corpo_html', () => {
    expect(getTableName(campanhas)).toBe('campanhas');
    const columns = getTableColumns(campanhas);
    expect(columns.empresaId.notNull).toBe(true);
    expect(columns.nome.notNull).toBe(true);
    expect(columns.assunto.notNull).toBe(true);
    expect(columns.corpoHtml.notNull).toBe(true);
  });

  test('envios_campanha exige empresa_id e campanha_id', () => {
    expect(getTableName(enviosCampanha)).toBe('envios_campanha');
    const columns = getTableColumns(enviosCampanha);
    expect(columns.empresaId.notNull).toBe(true);
    expect(columns.campanhaId.notNull).toBe(true);
    expect(columns.nomeDestinatario.notNull).toBe(true);
    expect(columns.emailDestinatario.notNull).toBe(true);
  });
});
