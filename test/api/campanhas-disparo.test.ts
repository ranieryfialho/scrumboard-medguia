// T-269 (fase5-email-disparo, US-171): o worker de e-mail das campanhas contra um Postgres efêmero real com dois tenants,
// com relógio, sono e transporte falsos (sem Resend). Cobre AC-701 a AC-707 e AC-722.
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';

import { prepararAmbienteAnexos, type AmbienteAnexos } from '../support/api-anexos';
import { transporteResendDeCampanha, type EmailDeCampanha, type TransporteDeCampanha } from '../../src/lib/email/campanha-envio';
import { INTERVALO_DO_CICLO_MS, INTERVALO_ENTRE_ENVIOS_MS, rodarCicloDeEmail } from '../../src/lib/email/disparo-worker';
import { ErroSemFalhas, reenviarFalhas } from '../../src/repositories/campanhas';
import { gravarConfiguracaoDeEmail } from '../../src/repositories/email-config';

const SEGREDO = 'segredo-de-teste-para-disparo-1234567890';
const CHAVE_A = 're_AAAAAAAAAAAAAAAAAAAAAAAAAAAA1111';
const REMETENTE_A = 'Clínica A <contato@clinica-a.com.br>';
const ID = (n: number) => `c8c8c8c8-7230-0000-0000-${String(n).padStart(12, '0')}`;

describe('T-269: worker de e-mail das campanhas', () => {
  let amb: AmbienteAnexos;
  let sequencia = 0;

  function sql(texto: string) {
    const r = amb.pg.psqlComo('crm_migrator', texto);
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  }

  /** Uma campanha da empresa com um envio por e-mail dado; devolve os ids. */
  function novaCampanha(empresaId: string, status: string, emails: string[], statusDosEnvios = 'PENDENTE') {
    sequencia += 1;
    const campanhaId = ID(sequencia * 100);
    sql(`INSERT INTO campanhas (id, empresa_id, nome, assunto, corpo_html, status) VALUES ('${campanhaId}', '${empresaId}', 'Camp ${sequencia}', 'Assunto ${sequencia}', '<p>Oi {{nome}}</p>', '${status}')`);
    const envios = emails.map((email, i) => {
      const id = ID(sequencia * 100 + 1 + i);
      sql(`INSERT INTO envios_campanha (id, empresa_id, campanha_id, nome_destinatario, email_destinatario, status) VALUES ('${id}', '${empresaId}', '${campanhaId}', 'Nome${i + 1} Sobrenome', '${email}', '${statusDosEnvios}')`);
      return id;
    });
    return { campanhaId, envios };
  }
  const statusDosEnvios = (campanhaId: string) => sql(`SELECT string_agg(status, ',' ORDER BY email_destinatario) FROM envios_campanha WHERE campanha_id = '${campanhaId}'`);
  const statusDaCampanha = (campanhaId: string) => sql(`SELECT status FROM campanhas WHERE id = '${campanhaId}'`);
  const emails = (prefixo: string, n: number) => Array.from({ length: n }, (_, i) => `${prefixo}${String(i + 1).padStart(2, '0')}@teste.com`);

  function ambienteDoCiclo(transporte?: TransporteDeCampanha) {
    const chamadas: EmailDeCampanha[] = [];
    const pausas: number[] = [];
    const agoraFixo = Date.now();
    const padrao: TransporteDeCampanha = async () => ({ ok: true });
    return {
      chamadas,
      pausas,
      agoraFixo,
      opcoes: {
        agora: () => new Date(agoraFixo),
        dormir: async (ms: number) => {
          pausas.push(ms);
        },
        segredo: SEGREDO,
        baseUrl: 'https://crm.teste.local',
        transporte: async (email: EmailDeCampanha) => {
          chamadas.push(email);
          return (transporte ?? padrao)(email);
        },
      },
    };
  }

  beforeAll(async () => {
    amb = await prepararAmbienteAnexos();
    await gravarConfiguracaoDeEmail(amb.db, { empresaId: amb.tenants.empresaA }, { chave: CHAVE_A, remetente: REMETENTE_A }, SEGREDO);
  }, 180_000);
  afterEach(() => {
    sql('DELETE FROM email_descadastros; DELETE FROM campanhas;');
  });
  afterAll(async () => {
    await amb?.parar();
  });

  test('pega até 10 envios, manda com a chave e o remetente da empresa, o nome, o rodapé e as tags, e grava ENVIADO @spec:AC-701', async () => {
    const { campanhaId, envios } = novaCampanha(amb.tenants.empresaA, 'PROCESSANDO', emails('p', 12));
    const amb1 = ambienteDoCiclo();
    const resumo = await rodarCicloDeEmail(amb.db, amb1.opcoes);

    expect(resumo).toMatchObject({ enviados: 10, falhas: 0 });
    expect(amb1.chamadas).toHaveLength(10);
    const primeiro = amb1.chamadas[0];
    expect(primeiro).toMatchObject({ apiKey: CHAVE_A, remetente: REMETENTE_A, destinatario: 'p01@teste.com', assunto: expect.stringContaining('Assunto'), envioId: envios[0], empresaId: amb.tenants.empresaA });
    expect(primeiro.html).toContain('Oi Nome1 Sobrenome'); // o corpo já preenchido com o nome
    expect(primeiro.html).toContain('https://crm.teste.local/descadastro/'); // o rodapé de descadastro
    expect(primeiro.cabecalhos['List-Unsubscribe']).toContain('https://crm.teste.local/descadastro/');
    expect(primeiro.cabecalhos['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');

    expect(statusDosEnvios(campanhaId)).toBe('ENVIADO,ENVIADO,ENVIADO,ENVIADO,ENVIADO,ENVIADO,ENVIADO,ENVIADO,ENVIADO,ENVIADO,PENDENTE,PENDENTE');
    expect(sql(`SELECT count(*) FROM envios_campanha WHERE campanha_id = '${campanhaId}' AND status = 'ENVIADO' AND tentativas = 1 AND enviado_em IS NOT NULL AND erro IS NULL`)).toBe('10');
    expect(statusDaCampanha(campanhaId)).toBe('PROCESSANDO'); // ainda há pendentes
  });

  test('dois ciclos ao mesmo tempo nunca pegam o mesmo envio @spec:AC-701', async () => {
    const { campanhaId } = novaCampanha(amb.tenants.empresaA, 'PROCESSANDO', emails('c', 12));
    const a = ambienteDoCiclo();
    const b = ambienteDoCiclo();
    await Promise.all([rodarCicloDeEmail(amb.db, a.opcoes), rodarCicloDeEmail(amb.db, b.opcoes)]);

    const ids = [...a.chamadas, ...b.chamadas].map((c) => c.envioId);
    expect(ids).toHaveLength(12);
    expect(new Set(ids).size).toBe(12); // nenhum envio foi mandado duas vezes
    expect(sql(`SELECT count(*) FROM envios_campanha WHERE campanha_id = '${campanhaId}' AND status = 'ENVIADO' AND tentativas = 1`)).toBe('12');
  });

  test('espera 2 segundos entre um envio e outro e não espera depois do último; o ciclo roda a cada 10 s @spec:AC-702', async () => {
    novaCampanha(amb.tenants.empresaA, 'PROCESSANDO', emails('r', 3));
    const tres = ambienteDoCiclo();
    await rodarCicloDeEmail(amb.db, tres.opcoes);
    expect(tres.pausas).toEqual([2000, 2000]);

    novaCampanha(amb.tenants.empresaA, 'PROCESSANDO', emails('s', 1));
    const um = ambienteDoCiclo();
    await rodarCicloDeEmail(amb.db, um.opcoes);
    expect(um.pausas).toEqual([]);

    expect(INTERVALO_ENTRE_ENVIOS_MS).toBe(2_000);
    expect(INTERVALO_DO_CICLO_MS).toBe(10_000);
  });

  test('a recusa do Resend e a falha de rede viram ERRO com o motivo e os demais seguem @spec:AC-703', async () => {
    const { campanhaId } = novaCampanha(amb.tenants.empresaA, 'PROCESSANDO', ['f1@teste.com', 'f2@teste.com', 'f3@teste.com', 'f4@teste.com']);
    const ciclo = ambienteDoCiclo(async (email) => {
      if (email.destinatario === 'f1@teste.com') return { ok: false, erro: 'RESEND_RECUSOU' };
      if (email.destinatario === 'f2@teste.com') throw new Error('socket hang up');
      return { ok: true };
    });
    const resumo = await rodarCicloDeEmail(amb.db, ciclo.opcoes);

    expect(resumo).toMatchObject({ enviados: 2, falhas: 2 });
    expect(statusDosEnvios(campanhaId)).toBe('ERRO,ERRO,ENVIADO,ENVIADO');
    expect(sql(`SELECT string_agg(erro, ',' ORDER BY email_destinatario) FROM envios_campanha WHERE campanha_id = '${campanhaId}' AND status = 'ERRO'`)).toBe('RESEND_RECUSOU,FALHA_DE_REDE');
    expect(sql(`SELECT count(*) FROM envios_campanha WHERE campanha_id = '${campanhaId}' AND tentativas = 1`)).toBe('4');
  });

  test('o transporte real separa resposta fora de 2xx de falha de rede e manda as tags e os cabeçalhos @spec:AC-703', async () => {
    const email: EmailDeCampanha = { apiKey: 're_x', remetente: null, destinatario: 'a@x.com', assunto: 'Oi', html: '<p>oi</p>', cabecalhos: { 'List-Unsubscribe': '<https://x>' }, envioId: 'envio-1', empresaId: 'empresa-1' };
    const fetchFalso = vi.fn();
    vi.stubGlobal('fetch', fetchFalso);
    try {
      fetchFalso.mockResolvedValueOnce(new Response('{}', { status: 200 }));
      expect(await transporteResendDeCampanha(email)).toEqual({ ok: true });
      const [url, init] = fetchFalso.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.resend.com/emails');
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer re_x');
      const corpo = JSON.parse(init.body as string);
      expect(corpo).toMatchObject({ to: ['a@x.com'], subject: 'Oi', html: '<p>oi</p>', headers: { 'List-Unsubscribe': '<https://x>' } });
      expect(corpo.tags).toEqual([{ name: 'envio_id', value: 'envio-1' }, { name: 'empresa_id', value: 'empresa-1' }]);

      fetchFalso.mockResolvedValueOnce(new Response('{}', { status: 422 }));
      expect(await transporteResendDeCampanha(email)).toEqual({ ok: false, erro: 'RESEND_RECUSOU' });
      fetchFalso.mockRejectedValueOnce(new TypeError('fetch failed'));
      expect(await transporteResendDeCampanha(email)).toEqual({ ok: false, erro: 'FALHA_DE_REDE' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('empresa sem chave: os pendentes viram ERRO SEM_CHAVE_RESEND sem mexer nas tentativas, e as outras empresas seguem @spec:AC-704', async () => {
    const semChave = novaCampanha(amb.tenants.empresaB, 'PROCESSANDO', ['b1@teste.com', 'b2@teste.com']);
    const comChave = novaCampanha(amb.tenants.empresaA, 'PROCESSANDO', ['a1@teste.com']);
    const ciclo = ambienteDoCiclo();
    await rodarCicloDeEmail(amb.db, ciclo.opcoes);

    expect(statusDosEnvios(semChave.campanhaId)).toBe('ERRO,ERRO');
    expect(sql(`SELECT string_agg(DISTINCT erro, ',') || '|' || sum(tentativas) FROM envios_campanha WHERE campanha_id = '${semChave.campanhaId}'`)).toBe('SEM_CHAVE_RESEND|0');
    expect(ciclo.chamadas.map((c) => c.destinatario)).toEqual(['a1@teste.com']); // nada saiu para a empresa sem chave
    expect(statusDosEnvios(comChave.campanhaId)).toBe('ENVIADO');
    expect(statusDaCampanha(semChave.campanhaId)).toBe('FINALIZADA'); // sem pendentes, termina; "Reenviar falhas" a reabre

    // depois de configurar a chave, "Reenviar falhas" devolve os ERRO à fila
    const contextoB = { empresaId: amb.tenants.empresaB, usuarioId: ID(1), papel: 'GERENTE' as const, isSuperAdmin: false };
    expect((await reenviarFalhas(amb.db, contextoB, semChave.campanhaId)).totalReenviados).toBe(2);
    expect(statusDosEnvios(semChave.campanhaId)).toBe('PENDENTE,PENDENTE');
  });

  test('a chave que não decifra com o segredo atual conta como sem chave @spec:AC-704', async () => {
    const { campanhaId } = novaCampanha(amb.tenants.empresaA, 'PROCESSANDO', ['d1@teste.com']);
    const ciclo = ambienteDoCiclo();
    await rodarCicloDeEmail(amb.db, { ...ciclo.opcoes, segredo: 'outro-segredo-qualquer-com-32-caracteres!!' });
    expect(ciclo.chamadas).toHaveLength(0);
    expect(statusDosEnvios(campanhaId)).toBe('ERRO');
    expect(sql(`SELECT erro FROM envios_campanha WHERE campanha_id = '${campanhaId}'`)).toBe('SEM_CHAVE_RESEND');
  });

  test('pendente de campanha em rascunho, pausada ou finalizada não é enviado @spec:AC-705', async () => {
    const rascunho = novaCampanha(amb.tenants.empresaA, 'RASCUNHO', ['x1@teste.com']);
    const pausada = novaCampanha(amb.tenants.empresaA, 'PAUSADA', ['x2@teste.com']);
    const finalizada = novaCampanha(amb.tenants.empresaA, 'FINALIZADA', ['x3@teste.com']);
    const ciclo = ambienteDoCiclo();
    await rodarCicloDeEmail(amb.db, ciclo.opcoes);

    expect(ciclo.chamadas).toHaveLength(0);
    for (const c of [rascunho, pausada, finalizada]) expect(statusDosEnvios(c.campanhaId)).toBe('PENDENTE');
    expect(statusDaCampanha(rascunho.campanhaId)).toBe('RASCUNHO');
    expect(statusDaCampanha(pausada.campanhaId)).toBe('PAUSADA'); // a pausada não finaliza sozinha
  });

  test('a campanha em andamento sem PENDENTE nem ENVIANDO vira FINALIZADA sozinha @spec:AC-706', async () => {
    const termina = novaCampanha(amb.tenants.empresaA, 'PROCESSANDO', ['t1@teste.com']);
    const jaTerminou = novaCampanha(amb.tenants.empresaA, 'PROCESSANDO', ['t2@teste.com'], 'ENVIADO');
    const enviandoAinda = novaCampanha(amb.tenants.empresaA, 'PROCESSANDO', ['t3@teste.com'], 'ENVIANDO');
    sql(`UPDATE envios_campanha SET enviado_em = now() WHERE campanha_id = '${enviandoAinda.campanhaId}'`);
    const resumo = await rodarCicloDeEmail(amb.db, { ...ambienteDoCiclo().opcoes, agora: () => new Date() });

    expect(resumo.finalizadas).toBeGreaterThanOrEqual(2);
    expect(statusDaCampanha(termina.campanhaId)).toBe('FINALIZADA');
    expect(statusDaCampanha(jaTerminou.campanhaId)).toBe('FINALIZADA');
    expect(statusDaCampanha(enviandoAinda.campanhaId)).toBe('PROCESSANDO'); // ainda tem envio em curso
  });

  test('ENVIANDO há mais de 10 minutos vira ERRO INTERROMPIDO e não é reenviado sozinho @spec:AC-707', async () => {
    const velha = novaCampanha(amb.tenants.empresaA, 'PROCESSANDO', ['v1@teste.com'], 'ENVIANDO');
    const recente = novaCampanha(amb.tenants.empresaA, 'PROCESSANDO', ['v2@teste.com'], 'ENVIANDO');
    const ciclo = ambienteDoCiclo();
    sql(`UPDATE envios_campanha SET enviado_em = to_timestamp(${(ciclo.agoraFixo - 11 * 60_000) / 1000}) WHERE campanha_id = '${velha.campanhaId}';
         UPDATE envios_campanha SET enviado_em = to_timestamp(${(ciclo.agoraFixo - 5 * 60_000) / 1000}) WHERE campanha_id = '${recente.campanhaId}';`);
    const resumo = await rodarCicloDeEmail(amb.db, ciclo.opcoes);

    expect(resumo.interrompidos).toBe(1);
    expect(ciclo.chamadas).toHaveLength(0); // nada foi reenviado
    expect(statusDosEnvios(velha.campanhaId)).toBe('ERRO');
    expect(sql(`SELECT erro || '|' || tentativas FROM envios_campanha WHERE campanha_id = '${velha.campanhaId}'`)).toBe('INTERROMPIDO|0');
    expect(statusDosEnvios(recente.campanhaId)).toBe('ENVIANDO'); // 5 minutos ainda é envio em curso
    expect(statusDaCampanha(velha.campanhaId)).toBe('FINALIZADA');
  });

  test('quem a empresa descadastrou não recebe, vira DESCADASTRADO e não volta com "Reenviar falhas" @spec:AC-722', async () => {
    const { empresaA, empresaB } = amb.tenants;
    const { campanhaId } = novaCampanha(empresaA, 'PROCESSANDO', ['SAIU@teste.com', 'fica@teste.com', 'so-b@teste.com']);
    // o descadastro veio depois de a campanha existir; 'so-b' saiu só da empresa B, então para a A segue valendo
    sql(`INSERT INTO email_descadastros (empresa_id, email) VALUES ('${empresaA}', 'saiu@teste.com'), ('${empresaB}', 'so-b@teste.com')`);
    const ciclo = ambienteDoCiclo();
    const resumo = await rodarCicloDeEmail(amb.db, ciclo.opcoes);

    expect(resumo.descadastrados).toBe(1);
    expect(ciclo.chamadas.map((c) => c.destinatario).sort()).toEqual(['fica@teste.com', 'so-b@teste.com']);
    expect(sql(`SELECT status FROM envios_campanha WHERE campanha_id = '${campanhaId}' AND email_destinatario = 'SAIU@teste.com'`)).toBe('DESCADASTRADO');

    // "Reenviar falhas" só devolve os ERRO (a campanha do descadastrado não tem nenhum)
    const contexto = { empresaId: empresaA, usuarioId: ID(1), papel: 'GERENTE' as const, isSuperAdmin: false };
    await expect(reenviarFalhas(amb.db, contexto, campanhaId)).rejects.toBeInstanceOf(ErroSemFalhas);
    expect(sql(`SELECT status FROM envios_campanha WHERE campanha_id = '${campanhaId}' AND email_destinatario = 'SAIU@teste.com'`)).toBe('DESCADASTRADO');
  });
});
