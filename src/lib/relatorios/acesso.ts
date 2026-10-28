// T-201 a T-203 (fase4-analises): o que as três rotas novas de relatórios têm em
// comum — sessão (401), papel (403, só MASTER/GERENTE/super admin, ASM-074) e a
// leitura e validação do período (400). O `empresaId` vem só da sessão.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../db/client';
import { getAuth } from '../auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../auth/tenant';

const FORMATO_DATA = /^\d{4}-\d{2}-\d{2}$/;
const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** ASM-192: período máximo de 366 dias. */
export const DIAS_MAXIMOS = 366;

export async function exigirGerente(request: NextRequest): Promise<{ contexto: ContextoTenant } | { resposta: NextResponse }> {
  const sessao = await getAuth().api.getSession({ headers: request.headers });
  if (!sessao) return { resposta: NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 }) };

  let contexto: ContextoTenant;
  try {
    contexto = await resolverContextoTenant(getDb(), { token: sessao.session.token });
  } catch (erro) {
    if (erro instanceof ErroSessaoInvalida) return { resposta: NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 }) };
    throw erro;
  }
  if (!(contexto.isSuperAdmin || contexto.papel === 'MASTER' || contexto.papel === 'GERENTE')) {
    return { resposta: NextResponse.json({ codigo: 'SEM_PERMISSAO' }, { status: 403 }) };
  }
  return { contexto };
}

function dataValida(data: string): boolean {
  if (!FORMATO_DATA.test(data)) return false;
  const [ano, mes, dia] = data.split('-').map(Number);
  const instante = new Date(Date.UTC(ano, mes - 1, dia));
  return instante.getUTCFullYear() === ano && instante.getUTCMonth() === mes - 1 && instante.getUTCDate() === dia;
}

export interface ParametrosDeRelatorio {
  de?: string;
  ate?: string;
  responsavelId?: string;
  origem?: string;
  agrupar?: 'dia' | 'semana' | 'mes';
}

export function lerParametros(p: URLSearchParams): { ok: true; parametros: ParametrosDeRelatorio } | { ok: false; resposta: NextResponse } {
  const recusa = (mensagem: string) => ({ ok: false as const, resposta: NextResponse.json({ codigo: 'PARAMETRO_INVALIDO', mensagem }, { status: 400 }) });
  const de = p.get('de') ?? undefined;
  const ate = p.get('ate') ?? undefined;
  const responsavelId = p.get('responsavelId') ?? undefined;
  const origem = p.get('origem') ?? undefined;
  const agrupar = p.get('agrupar') ?? undefined;

  if (de !== undefined && !dataValida(de)) return recusa(`Data inicial "${de}" inválida. Use o formato AAAA-MM-DD.`);
  if (ate !== undefined && !dataValida(ate)) return recusa(`Data final "${ate}" inválida. Use o formato AAAA-MM-DD.`);
  if (de !== undefined && ate !== undefined) {
    if (de > ate) return recusa('A data inicial não pode ser depois da data final.');
    const dias = (Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000 + 1;
    if (dias > DIAS_MAXIMOS) return recusa(`O período pode ter no máximo ${DIAS_MAXIMOS} dias.`);
  }
  if (responsavelId !== undefined && !FORMATO_UUID.test(responsavelId)) return recusa('"responsavelId" inválido.');
  if (agrupar !== undefined && agrupar !== 'dia' && agrupar !== 'semana' && agrupar !== 'mes') return recusa('"agrupar" deve ser dia, semana ou mes.');

  return { ok: true, parametros: { de, ate, responsavelId, origem, agrupar: agrupar as ParametrosDeRelatorio['agrupar'] } };
}
