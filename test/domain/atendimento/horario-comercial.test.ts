// fase6-atendimento-lead (US-181/US-182): o domínio puro do horário comercial — minutos dentro do expediente, resumo das esperas
// (média, mediana, faixas) e validação do horário. Sem banco: só funções.
import { describe, expect, test } from 'vitest';

import {
  HORARIO_PADRAO,
  minutosCorridos,
  minutosUteis,
  resumirEsperas,
  validarHorario,
  type HorarioComercial,
} from '../../../src/domain/atendimento/horario-comercial';

const em = (texto: string) => new Date(texto);

describe('minutosUteis — só o expediente conta', () => {
  test('sexta 17h30 até segunda 9h30 são 30 + 30 = 60 min úteis, e 64 h corridas @spec:AC-805', () => {
    const entrada = em('2026-02-06T17:30:00-03:00'); // sexta
    const primeira = em('2026-02-09T09:30:00-03:00'); // segunda
    expect(minutosUteis(entrada, primeira, HORARIO_PADRAO)).toBe(60);
    expect(minutosCorridos(entrada, primeira) / 60).toBe(64);
  });

  test('domingo 00h10 até segunda 16h47 são 467 min úteis @spec:AC-805', () => {
    expect(minutosUteis(em('2026-02-08T00:10:00-03:00'), em('2026-02-09T16:47:00-03:00'), HORARIO_PADRAO)).toBe(467);
  });

  test('dentro do mesmo expediente vale a diferença exata, e fora do expediente não conta nada @spec:AC-805', () => {
    expect(minutosUteis(em('2026-02-10T10:00:00-03:00'), em('2026-02-10T10:25:00-03:00'))).toBe(25);
    expect(minutosUteis(em('2026-02-10T19:00:00-03:00'), em('2026-02-10T23:00:00-03:00'))).toBe(0); // à noite
    expect(minutosUteis(em('2026-02-07T10:00:00-03:00'), em('2026-02-07T16:00:00-03:00'))).toBe(0); // sábado
    expect(minutosUteis(em('2026-02-10T10:00:00-03:00'), em('2026-02-10T09:00:00-03:00'))).toBe(0); // fim antes do início
  });

  test('vários dias somam um expediente inteiro de 9 h por dia útil @spec:AC-805', () => {
    // terça 10h até quinta 10h: 8 h (terça) + 9 h (quarta) + 1 h (quinta)
    expect(minutosUteis(em('2026-02-10T10:00:00-03:00'), em('2026-02-12T10:00:00-03:00'))).toBe((8 + 9 + 1) * 60);
  });

  test('o expediente configurado muda o resultado: seg a sáb, 8h às 20h @spec:AC-812', () => {
    const novo: HorarioComercial = {
      ...HORARIO_PADRAO,
      sab: { atende: true, abre: '08:00', fecha: '20:00' },
      seg: { atende: true, abre: '08:00', fecha: '20:00' },
    };
    const entrada = em('2026-02-07T10:00:00-03:00'); // sábado
    const primeira = em('2026-02-07T11:00:00-03:00');
    expect(minutosUteis(entrada, primeira, HORARIO_PADRAO)).toBe(0); // no padrão, sábado não atende
    expect(minutosUteis(entrada, primeira, novo)).toBe(60);
  });
});

describe('resumirEsperas — média, mediana e faixas', () => {
  test('sem nenhum lead não há média nem mediana, e as faixas ficam zeradas @spec:AC-804', () => {
    const resumo = resumirEsperas([]);
    expect(resumo).toMatchObject({ n: 0, media: null, mediana: null });
    expect(resumo.faixas.ate1h).toEqual({ quantidade: 0, percentual: 0 });
  });

  test('média e mediana, com número ímpar e par de leads @spec:AC-804', () => {
    expect(resumirEsperas([10, 20, 90])).toMatchObject({ n: 3, media: 40, mediana: 20 });
    expect(resumirEsperas([10, 20, 30, 100])).toMatchObject({ n: 4, media: 40, mediana: 25 });
  });

  test('as quatro faixas não se sobrepõem e somam N (limites inclusivos em 1 h, 4 h e 24 h) @spec:AC-806', () => {
    const minutos = [0, 60, 61, 240, 241, 1440, 1441, 5000];
    const { n, faixas } = resumirEsperas(minutos);
    expect(faixas.ate1h.quantidade).toBe(2); // 0 e 60
    expect(faixas.de1a4h.quantidade).toBe(2); // 61 e 240
    expect(faixas.de4a24h.quantidade).toBe(2); // 241 e 1440
    expect(faixas.mais24h.quantidade).toBe(2); // 1441 e 5000
    expect(faixas.ate1h.quantidade + faixas.de1a4h.quantidade + faixas.de4a24h.quantidade + faixas.mais24h.quantidade).toBe(n);
    expect(faixas.ate1h.percentual).toBe(25);
  });
});

describe('validarHorario', () => {
  const valido = () => JSON.parse(JSON.stringify(HORARIO_PADRAO)) as HorarioComercial;

  test('aceita o padrão e devolve só os campos conhecidos @spec:AC-811', () => {
    const resultado = validarHorario({ ...valido(), extra: 'lixo' });
    expect(resultado.ok).toBe(true);
    expect(resultado.ok && Object.keys(resultado.horario).sort()).toEqual(['dom', 'qua', 'qui', 'sab', 'seg', 'sex', 'ter']);
  });

  test('recusa fechamento que não é depois da abertura, formato errado e nenhum dia de atendimento @spec:AC-811', () => {
    const fechaAntes = valido();
    fechaAntes.seg = { atende: true, abre: '18:00', fecha: '09:00' };
    expect(validarHorario(fechaAntes)).toMatchObject({ ok: false });

    const formato = valido();
    formato.ter = { atende: true, abre: '9h', fecha: '18:00' };
    expect(validarHorario(formato)).toMatchObject({ ok: false });
    const horaInexistente = valido();
    horaInexistente.qua = { atende: true, abre: '09:00', fecha: '25:00' };
    expect(validarHorario(horaInexistente)).toMatchObject({ ok: false });

    const nenhum = Object.fromEntries(Object.entries(valido()).map(([dia, item]) => [dia, { ...item, atende: false }]));
    expect(validarHorario(nenhum)).toMatchObject({ ok: false, mensagem: 'Marque pelo menos um dia de atendimento.' });

    const semDia = valido() as Partial<HorarioComercial>;
    delete semDia.dom;
    expect(validarHorario(semDia)).toMatchObject({ ok: false });
    expect(validarHorario(null)).toMatchObject({ ok: false });
  });

  test('em dia sem atendimento o fechamento pode ser qualquer hora válida @spec:AC-811', () => {
    const horario = valido();
    horario.sab = { atende: false, abre: '18:00', fecha: '09:00' };
    expect(validarHorario(horario).ok).toBe(true);
  });
});
