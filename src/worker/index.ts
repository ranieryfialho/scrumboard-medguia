// T-130 (fase3-ingestao-continua, US-090/US-093): ponto de entrada do
// `crm-worker` — agendador dos dois ciclos (Sheets e LP) e parada graciosa.
//
// AC-320: `iniciarAgendador` dispara `rodarCiclos` a cada
// `intervaloImportacaoMin` (ASM-108); em produção (`main`, mais abaixo)
// `rodarCiclos` é `rodarCiclosImportacao` (T-128) com as duas origens, que
// já grava um registro de execução próprio por job (ASM-111) e isola falhas
// entre elas (AC-322) — este arquivo só cuida do relógio.
//
// AC-326: `criarManipuladorParada` nunca deixa um ciclo em andamento pela
// metade. Ao receber SIGTERM, o agendador para de disparar ciclos novos
// (`clearInterval`) e espera todo ciclo já em curso terminar antes de
// `sair(0)` ser chamado — nenhum ciclo novo começa nesse meio-tempo porque o
// intervalo já foi limpo.
//
// ASM-112 está "aberta": em vez da dependência `node-cron`, o agendador usa
// `setInterval`/`clearInterval` do próprio Node — mesmo contrato (dispara a
// cada intervalo configurado) sem exigir instalação de pacote externo; a
// exclusão mútua entre ciclos continua sendo responsabilidade da trava
// consultiva de `ciclo.ts` (AC-324/AC-325), não do agendador.
import { eq } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { empresas } from '../db/schema';
import type { ContextoExecucao } from '../etl/comum';
import {
  buscarLinhasAba,
  criarClienteSheetsSomenteLeitura,
  type ChaveAbaConhecida,
} from '../etl/sheets/leitor';
import { executarMigracaoSheets, type AbaParaLer } from '../etl/sheets/executar';
import { lerTodosCadastros } from '../etl/lp/origem';
import { executarMigracaoLp } from '../etl/lp/executar';
import { carregarConfiguracaoWorker, ErroConfiguracaoWorker, type ConfiguracaoWorker } from './config';
import { rodarCiclosImportacao, type CicloOrigem, type ResultadoImportacao } from './ciclo';

const ORIGEM_SHEETS = 'import-sheets';
const ORIGEM_LP = 'import-lp';
const EMPRESA_SLUG = 'medguia';
const AGENDA_RANGE = 'Agenda!A:D';

const ABAS_DE_LEADS: { chave: ChaveAbaConhecida; spreadsheetIdEnv: string; range: string }[] = [
  { chave: 'sheet1/Página1', spreadsheetIdEnv: 'GOOGLE_SHEET_ID_1', range: 'Página1' },
  { chave: 'sheet1/Página2', spreadsheetIdEnv: 'GOOGLE_SHEET_ID_1', range: 'Página2' },
  { chave: 'sheet2/Página1', spreadsheetIdEnv: 'GOOGLE_SHEET_ID_2', range: 'Página1' },
  { chave: 'sheet3/Página1', spreadsheetIdEnv: 'GOOGLE_SHEET_ID_3', range: 'Página1' },
];

export interface OpcoesAgendador {
  intervaloMs: number;
  rodarCiclos: () => Promise<unknown>;
}

export interface Agendador {
  /** Para de disparar ciclos novos e espera todo ciclo em curso terminar (AC-326). */
  pararEEsperar(): Promise<void>;
}

/** Dispara `rodarCiclos` a cada `intervaloMs` (AC-320), sem esperar o ciclo anterior terminar. */
export function iniciarAgendador({ intervaloMs, rodarCiclos }: OpcoesAgendador): Agendador {
  const emExecucao = new Set<Promise<unknown>>();
  let parado = false;

  function disparar(): void {
    if (parado) return;
    const execucao = rodarCiclos().catch(() => undefined);
    emExecucao.add(execucao);
    void execucao.then(() => emExecucao.delete(execucao));
  }

  const handle = setInterval(disparar, intervaloMs);

  return {
    async pararEEsperar() {
      parado = true;
      clearInterval(handle);
      await Promise.all(Array.from(emExecucao));
    },
  };
}

/**
 * Manipulador de SIGTERM (AC-326): espera o ciclo em andamento terminar
 * antes de sair com código 0. `sair` é injetável para teste.
 */
export function criarManipuladorParada(
  agendador: Agendador,
  sair: (codigo: number) => void = process.exit
): () => Promise<void> {
  return async () => {
    await agendador.pararEEsperar();
    sair(0);
  };
}

function idDaPlanilha(env: Record<string, string | undefined>, variavel: string): string {
  const valor = env[variavel];
  if (!valor) {
    throw new Error(`${variavel} precisa estar configurado.`);
  }
  return valor;
}

async function buscarEmpresaId(db: NodePgDatabase): Promise<string> {
  const [empresa] = await db.select({ id: empresas.id }).from(empresas).where(eq(empresas.slug, EMPRESA_SLUG));
  if (!empresa) {
    throw new Error(`Empresa "${EMPRESA_SLUG}" não encontrada no destino.`);
  }
  return empresa.id;
}

function somarRelatorioSheets(
  linhas: { linhasLidas: number; criadas: number; fundidas: number; ignoradas: number; emRevisao: number }[]
): ResultadoImportacao {
  return linhas.reduce(
    (acumulado, linha) => ({
      linhasLidas: acumulado.linhasLidas + linha.linhasLidas,
      linhasCriadas: acumulado.linhasCriadas + linha.criadas,
      linhasIgnoradas: acumulado.linhasIgnoradas + linha.fundidas + linha.ignoradas + linha.emRevisao,
    }),
    { linhasLidas: 0, linhasCriadas: 0, linhasIgnoradas: 0 }
  );
}

/** Monta os dois ciclos de origem (Sheets e LP), sem decisões (ASM-107, ASM-109). */
function construirCiclosOrigem(
  db: NodePgDatabase,
  config: ConfiguracaoWorker,
  env: Record<string, string | undefined> = process.env
): CicloOrigem[] {
  return [
    {
      job: ORIGEM_SHEETS,
      executarImportacao: async () => {
        const sheets = criarClienteSheetsSomenteLeitura({
          email: config.googleClientEmail,
          chavePrivada: config.googlePrivateKey.replace(/\\n/g, '\n'),
        });
        const abas: AbaParaLer[] = [];
        for (const abaConfigurada of ABAS_DE_LEADS) {
          const spreadsheetId = idDaPlanilha(env, abaConfigurada.spreadsheetIdEnv);
          const linhas = await buscarLinhasAba(sheets, spreadsheetId, abaConfigurada.range);
          abas.push({ chave: abaConfigurada.chave, linhas });
        }
        const agendaLinhas = await buscarLinhasAba(sheets, idDaPlanilha(env, 'GOOGLE_SHEET_ID_1'), AGENDA_RANGE);
        const empresaId = await buscarEmpresaId(db);
        const contexto: ContextoExecucao = { origem: ORIGEM_SHEETS, simulacao: false };
        const relatorio = await executarMigracaoSheets(db, contexto, empresaId, abas, agendaLinhas);
        return somarRelatorioSheets(relatorio.linhas);
      },
    },
    {
      job: ORIGEM_LP,
      executarImportacao: async () => {
        const { cadastros, total } = await lerTodosCadastros({
          url: config.supabaseLpUrl,
          chaveServico: config.supabaseLpServiceKey,
        });
        const empresaId = await buscarEmpresaId(db);
        const contexto: ContextoExecucao = { origem: ORIGEM_LP, simulacao: false };
        const relatorio = await executarMigracaoLp(db, contexto, empresaId, cadastros, total);
        return {
          linhasLidas: relatorio.lidas,
          linhasCriadas: relatorio.criadas,
          linhasIgnoradas: relatorio.ignoradas + relatorio.emRevisao,
        };
      },
    },
  ];
}

async function main(): Promise<void> {
  let config: ConfiguracaoWorker;
  try {
    config = carregarConfiguracaoWorker();
  } catch (erro) {
    if (erro instanceof ErroConfiguracaoWorker) {
      console.error(erro.message);
      process.exitCode = 1;
      return;
    }
    throw erro;
  }

  const pool = new Pool({ connectionString: config.databaseUrl });
  const db = drizzle(pool);
  const ciclos = construirCiclosOrigem(db, config);

  const agendador = iniciarAgendador({
    intervaloMs: config.intervaloImportacaoMin * 60_000,
    rodarCiclos: () => rodarCiclosImportacao(pool, db, ciclos),
  });

  process.once('SIGTERM', () => {
    (async () => {
      await agendador.pararEEsperar();
      await pool.end();
      process.exit(0);
    })().catch((erro) => {
      console.error('crm-worker: erro ao parar com graça.', erro);
      process.exit(1);
    });
  });
}

const EXECUTADO_DIRETAMENTE =
  typeof process.argv[1] === 'string' && import.meta.url === `file://${process.argv[1]}`;

if (EXECUTADO_DIRETAMENTE) {
  main().catch((erro) => {
    console.error('crm-worker falhou ao iniciar.', erro);
    process.exitCode = 1;
  });
}
