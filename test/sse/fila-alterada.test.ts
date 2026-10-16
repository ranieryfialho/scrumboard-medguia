// @vitest-environment jsdom
//
// T-096 (fase2b-fila-tarefas, US-060): prova de duas pernas de
// `cadencia.fila_alterada` — AC-218 (barramento filtra por tenant, mesma
// regra do AC-109/AC-133, agora contra um Postgres 15 efêmero real e a
// migration 0012) e AC-219 (o hook `useStreamOportunidades`, T-064, repassa
// o evento para quem usa o stream da página "Minhas tarefas", mantendo o
// fallback de polling já provado em test/sse/use-stream.test.tsx). O
// ambiente jsdom é só para a parte do hook (`renderHook`); a parte do
// barramento sobe um processo Postgres real via `child_process` e isso
// funciona normalmente sob jsdom — não é um teste de DOM.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { criarBarramento, type Barramento, type EventoBarramento } from '../../src/lib/sse/barramento';
import { useStreamOportunidades } from '../../src/hooks/use-stream-oportunidades';
import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

const ETAPA_ENTRADA = 1;

const EMPRESA_A = 'ffffffff-0000-0000-0000-00000000020a';
const EMPRESA_B = 'ffffffff-0000-0000-0000-00000000020b';
const LEAD_A = 'ffffffff-0000-0000-0000-00000000021a';
const USUARIO_A = 'ffffffff-0000-0000-0000-00000000022a';

let contadorUuid = 0x10;
function proximoUuid(): string {
  contadorUuid += 1;
  return `ffffffff-2222-0000-0000-${contadorUuid.toString(16).padStart(12, '0')}`;
}

async function aguardar(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function contarConexoesListen(pg: PostgresEfemero): Promise<number> {
  const resultado = pg.psqlComo(
    'postgres',
    `SELECT count(*) FROM pg_stat_activity WHERE datname = '${pg.database}' AND query ILIKE 'LISTEN %'`,
    'postgres'
  );
  if (resultado.status !== 0) {
    throw new Error(`Falha ao consultar pg_stat_activity: ${resultado.stderr}`);
  }
  return Number(resultado.stdout.trim());
}

async function aguardarCondicao(
  condicao: () => boolean | Promise<boolean>,
  { tentativas = 50, intervaloMs = 100 }: { tentativas?: number; intervaloMs?: number } = {}
): Promise<void> {
  for (let i = 0; i < tentativas; i += 1) {
    if (await condicao()) return;
    await aguardar(intervaloMs);
  }
  if (!(await condicao())) {
    throw new Error('Condição não satisfeita dentro do tempo esperado.');
  }
}

describe('T-096: AC-218 — barramento entrega cadencia.fila_alterada só ao tenant dono', () => {
  let pg: PostgresEfemero;
  let barramento: Barramento;
  const eventosA: EventoBarramento[] = [];
  const eventosB: EventoBarramento[] = [];

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();

    const setup = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "empresas" ("id", "nome", "slug") VALUES
         ('${EMPRESA_A}', 'Empresa Teste Fila SSE A', 'empresa-teste-fila-sse-a'),
         ('${EMPRESA_B}', 'Empresa Teste Fila SSE B', 'empresa-teste-fila-sse-b');
       INSERT INTO "leads" ("id", "empresa_id", "nome") VALUES
         ('${LEAD_A}', '${EMPRESA_A}', 'Lead Teste Fila SSE A');
       INSERT INTO "usuarios" ("id", "email", "nome") VALUES
         ('${USUARIO_A}', 'sdr-fila-sse-a@teste.local', 'SDR Fila SSE A');`
    );
    if (setup.status !== 0) {
      throw new Error(`Falha ao preparar fixtures: ${setup.stderr}`);
    }

    barramento = criarBarramento({ connectionString: pg.appUrl });
    barramento.inscrever(EMPRESA_A, (evento) => eventosA.push(evento));
    barramento.inscrever(EMPRESA_B, (evento) => eventosB.push(evento));
    await aguardarCondicao(() => barramento.contarInscricoes() === 2);
    await aguardarCondicao(async () => (await contarConexoesListen(pg)) === 1);
  }, 120_000);

  afterAll(async () => {
    await barramento?.encerrar();
    pg?.parar();
  });

  function criarOportunidade(empresaId: string, leadId: string): string {
    const id = proximoUuid();
    const resultado = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "oportunidades" ("id", "empresa_id", "lead_id", "etapa_id") VALUES ('${id}', '${empresaId}', '${leadId}', ${ETAPA_ENTRADA})`
    );
    if (resultado.status !== 0) {
      throw new Error(`Falha ao criar oportunidade fixture: ${resultado.stderr}`);
    }
    return id;
  }

  function iniciarCadencia(empresaId: string, oportunidadeId: string, atorId: string): void {
    const resultado = pg.psqlComo(
      'crm_app',
      `SET app.empresa_id = '${empresaId}';
       SELECT iniciar_cadencia('${oportunidadeId}', 1, '${atorId}', 'usuario', NULL)`
    );
    if (resultado.status !== 0) {
      throw new Error(`iniciar_cadencia falhou: ${resultado.stderr}`);
    }
  }

  test('só a empresa A recebe cadencia.fila_alterada quando um card da empresa A inicia cadência; a B não recebe nada @spec:AC-218', async () => {
    const oportunidadeId = criarOportunidade(EMPRESA_A, LEAD_A);
    iniciarCadencia(EMPRESA_A, oportunidadeId, USUARIO_A);

    await aguardarCondicao(() => eventosA.some((e) => e.tipo === 'cadencia.fila_alterada'));
    await aguardar(300);

    const filaAlteradaA = eventosA.filter((e) => e.tipo === 'cadencia.fila_alterada');
    expect(filaAlteradaA).toHaveLength(1);
    const evento = filaAlteradaA[0];
    if (evento.tipo !== 'cadencia.fila_alterada') throw new Error('tipo inesperado');
    expect(evento.empresaId).toBe(EMPRESA_A);
    expect(evento.oportunidadeId).toBe(oportunidadeId);

    expect(eventosB.filter((e) => e.tipo === 'cadencia.fila_alterada')).toHaveLength(0);
  });
});

describe('T-096: AC-219 — useStreamOportunidades repassa cadencia.fila_alterada', () => {
  type Ouvinte = (evento: unknown) => void;

  class FakeEventSource {
    static instancias: FakeEventSource[] = [];
    url: string;
    private ouvintes = new Map<string, Set<Ouvinte>>();

    constructor(url: string) {
      this.url = url;
      FakeEventSource.instancias.push(this);
    }

    addEventListener(tipo: string, ouvinte: Ouvinte): void {
      if (!this.ouvintes.has(tipo)) this.ouvintes.set(tipo, new Set());
      this.ouvintes.get(tipo)!.add(ouvinte);
    }

    removeEventListener(tipo: string, ouvinte: Ouvinte): void {
      this.ouvintes.get(tipo)?.delete(ouvinte);
    }

    close(): void {}

    disparar(tipo: string, evento: unknown = {}): void {
      for (const ouvinte of this.ouvintes.get(tipo) ?? []) ouvinte(evento);
    }
  }

  beforeEach(() => {
    FakeEventSource.instancias = [];
    vi.stubGlobal('EventSource', FakeEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('repassa cadencia.fila_alterada com empresaId e oportunidadeId para quem usa o hook @spec:AC-219', () => {
    const aoReceberEvento = vi.fn();
    renderHook(() => useStreamOportunidades({ aoReceberEvento }));
    const origem = FakeEventSource.instancias[0];

    const payload = { empresaId: 'empresa-1', oportunidadeId: 'oport-1' };

    act(() => {
      origem.disparar('cadencia.fila_alterada', { data: JSON.stringify(payload) });
    });

    expect(aoReceberEvento).toHaveBeenCalledWith({ tipo: 'cadencia.fila_alterada', ...payload });
  });

  it('também repassa stream.reconectado — gatilho de recarga sem perder o fallback de polling (ASM-031) @spec:AC-219', () => {
    vi.useFakeTimers();
    const aoReceberEvento = vi.fn();
    const aoPolling = vi.fn();
    const { result } = renderHook(() => useStreamOportunidades({ aoReceberEvento, aoPolling }));
    const origem = FakeEventSource.instancias[0];

    act(() => {
      origem.disparar('stream.reconectado', {});
    });
    expect(aoReceberEvento).toHaveBeenCalledWith({ tipo: 'stream.reconectado' });

    // Com o SSE instável, a queda para polling continua funcionando mesmo
    // depois de a página passar a ouvir cadencia.fila_alterada — o hook não
    // perde o fallback (ASM-031) por ganhar um tipo de evento novo.
    act(() => {
      origem.disparar('error');
      origem.disparar('error');
      origem.disparar('error');
    });
    expect(result.current.modo).toBe('polling');
    expect(aoPolling).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });
});
