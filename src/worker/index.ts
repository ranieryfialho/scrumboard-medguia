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
//
// T-136 (fase3-espelho-sheets, US-096): o job `espelho-sheets` roda no SEU
// PRÓPRIO agendador (`montarAgendadores`), com o intervalo de
// `config.intervaloEspelhoMin` (AC-337, ASM-120) — independente do
// agendador dos dois ciclos de importação. Ele reaproveita
// `rodarCicloImportacao` (AC-336: mesma trava advisory e o mesmo registro
// em `cron_execucoes`, com `itensProcessados` = quantidade de cards
// gravados; AC-339: qualquer erro do Sheets vira "falha" registrada em vez
// de subir e derrubar o worker, mesmo mecanismo de AC-321/AC-322).
import { eq } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { google, type sheets_v4 } from 'googleapis';
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
import { consultarCardsDoEspelho } from '../espelho/consulta';
import { montarLinhasDoEspelho } from '../espelho/linhas';
import { gravarEspelho, type ClienteSheetsEspelho } from '../espelho/gravar';
import { carregarConfiguracaoWorker, ErroConfiguracaoWorker, type ConfiguracaoWorker } from './config';
import { rodarCicloImportacao, rodarCiclosImportacao, type CicloOrigem, type ResultadoImportacao } from './ciclo';

const ORIGEM_SHEETS = 'import-sheets';
const ORIGEM_LP = 'import-lp';
const ORIGEM_ESPELHO = 'espelho-sheets';
const EMPRESA_SLUG = 'medguia';
const AGENDA_RANGE = 'Agenda!A:D';

/** Escopo de escrita do Sheets (ASM-119) — só usado pelo job do espelho, nunca pela ingestão. */
const ESCOPO_ESCRITA_SHEETS = 'https://www.googleapis.com/auth/spreadsheets';

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

/** Cliente do Sheets com escopo de escrita (ASM-119) — só para o job `espelho-sheets`. */
function criarClienteSheetsEscrita(credenciais: { email: string; chavePrivada: string }): sheets_v4.Sheets {
  const auth = new google.auth.JWT({
    email: credenciais.email,
    key: credenciais.chavePrivada,
    scopes: [ESCOPO_ESCRITA_SHEETS],
  });
  return google.sheets({ version: 'v4', auth });
}

/** Dependências do ciclo do espelho, injetáveis para teste (padrão já usado nos outros módulos de `espelho/`). */
export interface DependenciasCicloEspelho {
  consultarCards: typeof consultarCardsDoEspelho;
  montarLinhas: typeof montarLinhasDoEspelho;
  gravar: typeof gravarEspelho;
  criarClienteEscrita: (credenciais: { email: string; chavePrivada: string }) => ClienteSheetsEspelho;
}

/**
 * Monta o ciclo do job `espelho-sheets` (T-132/T-133/T-134 compostos): lê os
 * cards do banco, monta as linhas e grava na aba "Espelho CRM" — nessa
 * ordem, para nunca limpar a aba antes de ter os dados novos em mãos
 * (AC-339). O resultado devolve a quantidade de cards gravados como
 * `linhasLidas`, que `rodarCicloImportacao` grava em
 * `cron_execucoes.itens_processados` (AC-336).
 */
export function construirCicloEspelho(
  db: NodePgDatabase,
  config: ConfiguracaoWorker,
  env: Record<string, string | undefined> = process.env,
  dependencias: Partial<DependenciasCicloEspelho> = {}
): CicloOrigem {
  const consultarCards = dependencias.consultarCards ?? consultarCardsDoEspelho;
  const montarLinhas = dependencias.montarLinhas ?? montarLinhasDoEspelho;
  const gravar = dependencias.gravar ?? gravarEspelho;
  const criarClienteEscrita = dependencias.criarClienteEscrita ?? criarClienteSheetsEscrita;

  return {
    job: ORIGEM_ESPELHO,
    executarImportacao: async () => {
      const cards = await consultarCards(db);
      const linhas = montarLinhas(cards);
      const sheets = criarClienteEscrita({
        email: config.googleClientEmail,
        chavePrivada: config.googlePrivateKey.replace(/\\n/g, '\n'),
      });
      await gravar(sheets, idDaPlanilha(env, 'GOOGLE_SHEET_ID_1'), linhas);
      return { linhasLidas: cards.length, linhasCriadas: 0, linhasIgnoradas: 0 };
    },
  };
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

/**
 * Monta as opções dos dois agendadores do worker: o dos ciclos de
 * importação (Sheets + LP, intervalo único — AC-320) e o do espelho
 * (intervalo próprio, AC-337) — sem iniciar nenhum deles, para o teste
 * poder inspecionar os intervalos sem depender de `setInterval` real.
 */
export function montarAgendadores(
  pool: Pool,
  db: NodePgDatabase,
  config: ConfiguracaoWorker,
  env: Record<string, string | undefined> = process.env
): { importacao: OpcoesAgendador; espelho: OpcoesAgendador } {
  const ciclos = construirCiclosOrigem(db, config, env);
  const cicloEspelho = construirCicloEspelho(db, config, env);

  return {
    importacao: {
      intervaloMs: config.intervaloImportacaoMin * 60_000,
      rodarCiclos: () => rodarCiclosImportacao(pool, db, ciclos),
    },
    espelho: {
      intervaloMs: config.intervaloEspelhoMin * 60_000,
      rodarCiclos: () => rodarCicloImportacao(pool, db, cicloEspelho.job, cicloEspelho.executarImportacao),
    },
  };
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
  const { importacao, espelho } = montarAgendadores(pool, db, config);

  const agendadorImportacao = iniciarAgendador(importacao);
  const agendadorEspelho = iniciarAgendador(espelho);

  process.once('SIGTERM', () => {
    (async () => {
      await Promise.all([agendadorImportacao.pararEEsperar(), agendadorEspelho.pararEEsperar()]);
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
