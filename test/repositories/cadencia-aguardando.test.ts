// Cadência: toque de WhatsApp "aguardando resposta" (migration 0035), contra um Postgres 15 efêmero real com todas as migrations.
// Marcar tira o toque do atraso e o põe na fila como "aguardando"; vencido o prazo, `expirarAguardandosDaEmpresa` o conclui como
// `sem_resposta` pelo mesmo caminho do botão "Não atendeu". Fixtures entram por `crm_migrator`; o repositório roda como `crm_app` (RLS).
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import {
  ErroConflitoDeVersao,
  ErroToqueNaoAceitaAguardar,
  MINUTOS_AGUARDANDO_RESPOSTA,
  expirarAguardandosDaEmpresa,
  iniciarCadencia,
  listarFilaDoTurno,
  marcarAguardandoResposta,
} from '../../src/repositories/cadencia';
import { resumoDoTurno } from '../../src/repositories/resumo-turno';
import type { ContextoTenant } from '../../src/lib/auth/tenant';
import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

const EMPRESA = 'eeeeeeee-0000-0000-0000-00000000000a';
const LEAD = 'eeeeeeee-0000-0000-0000-00000000001a';
const RESP = 'eeeeeeee-0000-0000-0000-00000000002a';

// 2026-06-11 é quinta (dia útil). A cadência inicia às 09h e o toque 3 (WhatsApp) é o último do bloco da manhã.
const MANHA = new Date('2026-06-11T09:00:00-03:00');
const TARDE = new Date('2026-06-11T14:00:00-03:00');
const TOQUE_WHATSAPP = 3;
const TOQUE_LIGACAO = 1;

const contexto: ContextoTenant = { usuarioId: RESP, empresaId: EMPRESA, papel: 'ATENDENTE', isSuperAdmin: false };

describe('Cadência: aguardando resposta', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;
  let contador = 0x10;

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();
    const setup = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "empresas" ("id", "nome", "slug") VALUES ('${EMPRESA}', 'Empresa Aguardando', 'empresa-aguardando');
       INSERT INTO "leads" ("id", "empresa_id", "nome") VALUES ('${LEAD}', '${EMPRESA}', 'Lead Aguardando');
       INSERT INTO "usuarios" ("id", "email", "nome") VALUES ('${RESP}', 'resp-aguardando@teste.local', 'Responsável Aguardando');`
    );
    if (setup.status !== 0) throw new Error(`Falha ao preparar fixtures: ${setup.stderr}`);
    pool = new Pool({ connectionString: pg.appUrl });
    db = drizzle(pool);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    pg?.parar();
  });

  function valor(sqlTexto: string): string {
    const r = pg.psqlComo('crm_migrator', sqlTexto);
    if (r.status !== 0) throw new Error(`Falha ao consultar: ${r.stderr}`);
    return r.stdout.trim();
  }

  async function novoCardEmCadencia(): Promise<{ id: string; version: number; toque: (sequencia: number) => string }> {
    contador += 1;
    const id = `eeeeeeee-1111-0000-0000-${contador.toString(16).padStart(12, '0')}`;
    const ins = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "oportunidades" ("id", "empresa_id", "lead_id", "etapa_id", "responsavel_id") VALUES ('${id}', '${EMPRESA}', '${LEAD}', 1, '${RESP}')`
    );
    if (ins.status !== 0) throw new Error(ins.stderr);
    const version = Number(valor(`SELECT version FROM oportunidades WHERE id = '${id}'`));
    await iniciarCadencia(db, contexto, id, { version, atorId: RESP, atorTipo: 'usuario', agora: MANHA });
    const atual = Number(valor(`SELECT version FROM oportunidades WHERE id = '${id}'`));
    return { id, version: atual, toque: (sequencia) => valor(`SELECT id FROM cadencia_atividades WHERE oportunidade_id = '${id}' AND sequencia = ${sequencia}`) };
  }

  test('marca o toque de WhatsApp: continua pendente, ganha o prazo e deixa um evento', async () => {
    const card = await novoCardEmCadencia();
    const atividade = await marcarAguardandoResposta(db, contexto, card.toque(TOQUE_WHATSAPP), { version: card.version, atorId: RESP, agora: MANHA });

    expect(atividade.resultado).toBe('pendente');
    expect(atividade.aguardandoDesde?.toISOString()).toBe(MANHA.toISOString());
    expect(atividade.aguardandoAte?.getTime()).toBe(MANHA.getTime() + MINUTOS_AGUARDANDO_RESPOSTA * 60_000);
    expect(valor(`SELECT count(*) FROM oportunidade_eventos WHERE oportunidade_id = '${card.id}' AND tipo = 'aguardando_resposta'`)).toBe('1');
  });

  test('só WhatsApp aceita: ligação é recusada e nada é gravado', async () => {
    const card = await novoCardEmCadencia();
    await expect(marcarAguardandoResposta(db, contexto, card.toque(TOQUE_LIGACAO), { version: card.version, atorId: RESP, agora: MANHA })).rejects.toBeInstanceOf(
      ErroToqueNaoAceitaAguardar
    );
    expect(valor(`SELECT count(*) FROM cadencia_atividades WHERE oportunidade_id = '${card.id}' AND aguardando_ate IS NOT NULL`)).toBe('0');
  });

  test('versão desatualizada é recusada (lock otimista)', async () => {
    const card = await novoCardEmCadencia();
    await expect(marcarAguardandoResposta(db, contexto, card.toque(TOQUE_WHATSAPP), { version: card.version + 99, atorId: RESP, agora: MANHA })).rejects.toBeInstanceOf(
      ErroConflitoDeVersao
    );
  });

  test('na fila, o toque aguardando traz o prazo e não é atrasado, mesmo liberado antes do turno de referência', async () => {
    const card = await novoCardEmCadencia();
    await marcarAguardandoResposta(db, contexto, card.toque(TOQUE_WHATSAPP), { version: card.version, atorId: RESP, agora: MANHA });

    // À tarde o bloco da manhã já é "atrasado"; o toque aguardando (prazo até 11h) já venceu e volta a contar como atrasado... antes disso não.
    const durante = await listarFilaDoTurno(db, contexto, { responsavelId: RESP, agora: new Date('2026-06-11T10:00:00-03:00'), incluirAtrasados: true });
    const item = durante.find((i) => i.atividade.id === card.toque(TOQUE_WHATSAPP));
    expect(item?.aguardandoAte).not.toBeNull();
    expect(item?.atrasado).toBe(false);

    const vencido = await listarFilaDoTurno(db, contexto, { responsavelId: RESP, agora: TARDE, incluirAtrasados: true });
    const aposPrazo = vencido.find((i) => i.atividade.id === card.toque(TOQUE_WHATSAPP));
    expect(aposPrazo?.aguardandoAte).toBeNull();
    expect(aposPrazo?.atrasado).toBe(true);
  });

  test('o resumo do turno conta o aguardando à parte e não como atrasado', async () => {
    const card = await novoCardEmCadencia();
    await marcarAguardandoResposta(db, contexto, card.toque(TOQUE_WHATSAPP), { version: card.version, atorId: RESP, agora: MANHA });
    const resumo = await resumoDoTurno(db, contexto, { responsavelId: RESP, agora: new Date('2026-06-11T10:00:00-03:00') });
    expect(resumo.aguardandoResposta).toBeGreaterThanOrEqual(1);
  });

  test('antes do prazo nada expira; depois do prazo vira sem_resposta pelo sistema e some a marca', async () => {
    const card = await novoCardEmCadencia();
    const id = card.toque(TOQUE_WHATSAPP);
    await marcarAguardandoResposta(db, contexto, id, { version: card.version, atorId: RESP, agora: MANHA });

    const antes = await expirarAguardandosDaEmpresa(db, EMPRESA, new Date(MANHA.getTime() + 60 * 60_000));
    expect(antes.expirados).toBe(0);
    expect(valor(`SELECT resultado FROM cadencia_atividades WHERE id = '${id}'`)).toBe('pendente');

    const depois = await expirarAguardandosDaEmpresa(db, EMPRESA, new Date(MANHA.getTime() + (MINUTOS_AGUARDANDO_RESPOSTA + 1) * 60_000));
    expect(depois.expirados).toBeGreaterThanOrEqual(1);
    expect(valor(`SELECT resultado FROM cadencia_atividades WHERE id = '${id}'`)).toBe('sem_resposta');
    expect(valor(`SELECT realizada_por IS NULL FROM cadencia_atividades WHERE id = '${id}'`)).toBe('t');
    expect(valor(`SELECT count(*) FROM oportunidade_eventos WHERE oportunidade_id = '${card.id}' AND tipo = 'atividade_concluida' AND ator_tipo = 'sistema'`)).toBe('1');
  });
});
