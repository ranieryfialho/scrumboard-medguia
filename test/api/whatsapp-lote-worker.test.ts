// T-254 (fase5-whatsapp-lote-disparo, US-163): o worker do lote contra um Postgres efêmero real, com relógio, sono e
// envio falsos (sem Evolution).
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { prepararAmbienteAnexos, type AmbienteAnexos } from '../support/api-anexos';
import { processarLotes, type EnviarTexto } from '../../src/lib/whatsapp/lote-worker';

const ID = (n: number) => `e5e5e5e5-6790-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const CRON_SEGREDO_TESTE = 'segredo-cron-lote-teste-123';

describe('T-254: worker do lote de WhatsApp', () => {
  let amb: AmbienteAnexos;
  let sequencia = 0;

  function sql(texto: string) {
    const r = amb.pg.psqlComo('crm_migrator', texto);
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  }

  /** Um lote em andamento com `n` itens pendentes de leads novos, já com consentimento; devolve os ids. */
  function novoLote(n: number): { loteId: string; leads: string[]; itens: string[] } {
    sequencia += 1;
    const { empresaA } = amb.tenants;
    const loteId = ID(sequencia * 20);
    const leads: string[] = [];
    const itens: string[] = [];
    sql(`INSERT INTO whatsapp_lotes (id, empresa_id, template_nome, total) VALUES ('${loteId}', '${empresaA}', 'Teste ${sequencia}', ${n})`);
    for (let i = 1; i <= n; i++) {
      const lead = ID(sequencia * 20 + i);
      const item = ID(sequencia * 20 + 10 + i);
      leads.push(lead);
      itens.push(item);
      sql(`INSERT INTO leads (id, empresa_id, nome, telefone_e164, consentimento_whatsapp_em) VALUES ('${lead}', '${empresaA}', 'Lead ${sequencia}-${i}', '55119${String(sequencia).padStart(2, '0')}0000${i}', now());
           INSERT INTO whatsapp_lote_itens (id, lote_id, empresa_id, lead_id, ordem, nome, telefone, mensagem) VALUES ('${item}', '${loteId}', '${empresaA}', '${lead}', ${i}, 'Lead ${sequencia}-${i}', '55119${String(sequencia).padStart(2, '0')}0000${i}', 'Olá ${i}');`);
    }
    return { loteId, leads, itens };
  }

  function relogio() {
    let ms = Date.now() + 2_000;
    return {
      agora: () => new Date(ms),
      dormir: async (espera: number) => {
        ms += espera;
      },
      avancar: (espera: number) => {
        ms += espera;
      },
      ms: () => ms,
    };
  }
  const statusDosItens = (loteId: string) => sql(`SELECT string_agg(status, ',' ORDER BY ordem) FROM whatsapp_lote_itens WHERE lote_id = '${loteId}'`);

  beforeAll(async () => {
    amb = await prepararAmbienteAnexos();
    sql(`INSERT INTO empresa_configuracoes (empresa_id, chave, valor) VALUES ('${amb.tenants.empresaA}', 'evolution_instance_name', '"instancia-a"'::jsonb)`);
  }, 180_000);
  afterAll(async () => {
    await amb?.parar();
  });

  test('envia um item por vez com 15 a 45 s entre eles, grava a conversa e conclui o lote @spec:AC-679', async () => {
    const { loteId, leads } = novoLote(3);
    const r = relogio();
    const chamadas: Array<{ numero: string; texto: string; em: number }> = [];
    const enviar: EnviarTexto = async (_empresa, numero, texto) => {
      chamadas.push({ numero, texto, em: r.ms() });
      return { ok: true, messageId: `msg-${chamadas.length}` };
    };
    const opcoes = { agora: r.agora, dormir: r.dormir, aleatorio: () => 0.5, orcamentoMs: 55_000, enviar };

    const primeira = await processarLotes(amb.db, opcoes);
    // intervalo sorteado de 30 s: o 1º sai, dorme 30 s, o 2º sai, o 3º não cabe no orçamento de 55 s
    expect(primeira).toMatchObject({ enviados: 2, falhas: 0, cancelados: 0 });
    expect(chamadas.map((c) => c.texto)).toEqual(['Olá 1', 'Olá 2']);
    expect(chamadas[1].em - chamadas[0].em).toBe(30_000);
    expect(statusDosItens(loteId)).toBe('enviado,enviado,pendente');
    expect(sql(`SELECT status FROM whatsapp_lotes WHERE id = '${loteId}'`)).toBe('em_andamento');
    expect(sql(`SELECT count(*) FROM whatsapp_mensagens WHERE lead_id = '${leads[0]}' AND direcao = 'enviada'`)).toBe('1');

    // antes do `proximo_envio_em` o worker não manda nada, mesmo chamado de novo
    r.avancar(5_000);
    expect(await processarLotes(amb.db, opcoes)).toMatchObject({ enviados: 0 });
    expect(chamadas).toHaveLength(2);

    // passado o intervalo, sai o último e o lote conclui
    r.avancar(60_000);
    expect(await processarLotes(amb.db, opcoes)).toMatchObject({ enviados: 1 });
    expect(statusDosItens(loteId)).toBe('enviado,enviado,enviado');
    expect(sql(`SELECT status || '|' || (finalizado_em IS NOT NULL)::text FROM whatsapp_lotes WHERE id = '${loteId}'`)).toBe('concluido|true');
    expect(chamadas[2].em - chamadas[1].em).toBeGreaterThanOrEqual(15_000);
  });

  test('a falha de um número não para o lote: o item fica "falhou" com o motivo e os outros seguem @spec:AC-680', async () => {
    const { loteId, leads } = novoLote(3);
    const r = relogio();
    const enviar: EnviarTexto = async (_empresa, numero) => (numero.endsWith('2') ? { ok: false, erro: 'NUMERO_SEM_WHATSAPP' } : { ok: true, messageId: 'm' });
    const resumo = await processarLotes(amb.db, { agora: r.agora, dormir: r.dormir, aleatorio: () => 0, orcamentoMs: 600_000, enviar });
    expect(resumo).toMatchObject({ enviados: 2, falhas: 1 });
    expect(statusDosItens(loteId)).toBe('enviado,falhou,enviado');
    expect(sql(`SELECT erro FROM whatsapp_lote_itens WHERE lote_id = '${loteId}' AND ordem = 2`)).toBe('NUMERO_SEM_WHATSAPP');
    expect(sql(`SELECT count(*) FROM whatsapp_mensagens WHERE lead_id = '${leads[1]}'`)).toBe('0'); // nada na conversa
    expect(sql(`SELECT status FROM whatsapp_lotes WHERE id = '${loteId}'`)).toBe('concluido');
  });

  test('consentimento revogado antes do envio cancela o item, sem enviar nem contar para o intervalo @spec:AC-681', async () => {
    const { loteId, leads } = novoLote(2);
    sql(`UPDATE leads SET consentimento_whatsapp_em = NULL, consentimento_whatsapp_por = NULL WHERE id = '${leads[0]}'`);
    const r = relogio();
    const enviados: string[] = [];
    const enviar: EnviarTexto = async (_e, numero) => {
      enviados.push(numero);
      return { ok: true, messageId: 'm' };
    };
    const inicio = r.ms();
    const resumo = await processarLotes(amb.db, { agora: r.agora, dormir: r.dormir, aleatorio: () => 0, orcamentoMs: 600_000, enviar });
    expect(resumo).toMatchObject({ enviados: 1, cancelados: 1 });
    expect(enviados).toHaveLength(1);
    expect(statusDosItens(loteId)).toBe('cancelado,enviado');
    expect(sql(`SELECT erro FROM whatsapp_lote_itens WHERE lote_id = '${loteId}' AND ordem = 1`)).toBe('SEM_CONSENTIMENTO');
    expect(r.ms() - inicio).toBe(0); // o lote de 2 só dormiria depois do 1º envio; o cancelado não gera espera
  });

  test('a rota do cron recusa sem o segredo e, com ele, processa e registra a execução @spec:AC-682', async () => {
    process.env.CRON_SEGREDO = CRON_SEGREDO_TESTE;
    const rota = await import('../../src/app/api/cron/whatsapp-lote/route');
    const post = (autorizacao?: string) => rota.POST(new NextRequest('http://localhost/api/cron/whatsapp-lote', { method: 'POST', headers: autorizacao ? { authorization: autorizacao } : {} }));
    const antes = sql(`SELECT count(*) FROM cron_execucoes WHERE job = 'whatsapp-lote'`);
    expect((await post()).status).toBe(401);
    expect((await post('Bearer errado')).status).toBe(401);
    expect(sql(`SELECT count(*) FROM cron_execucoes WHERE job = 'whatsapp-lote'`)).toBe(antes);

    // não há lote em andamento (os testes acima concluíram todos): a chamada processa zero e registra sucesso
    sql(`UPDATE whatsapp_lotes SET status = 'cancelado', finalizado_em = now() WHERE status = 'em_andamento'`);
    const r = await post(`Bearer ${CRON_SEGREDO_TESTE}`);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, enviados: 0, falhas: 0, cancelados: 0 });
    expect(sql(`SELECT status FROM cron_execucoes WHERE job = 'whatsapp-lote' ORDER BY iniciado_em DESC LIMIT 1`)).toBe('sucesso');
  });
});
