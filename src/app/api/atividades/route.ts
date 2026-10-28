// T-092 (fase2b-cadencia, US-053/US-054): fila "Minhas tarefas" — só os
// toques pendentes do turno vigente (AC-192). Mesmo padrão de sessão/tenant
// das demais rotas da feature: 401 sem sessão, `empresaId` resolvido
// exclusivamente pela sessão (nunca da querystring). ASM-061: ATENDENTE só
// vê os cards dos quais é responsável; MASTER, GERENTE e super admin veem o
// tenant inteiro (mesmo bypass de src/domain/pipeline/papel.ts e
// src/app/api/whatsapp/config/route.ts). O filtro de turno/dia útil em si é
// todo do repositório (`listarFilaDoTurno`, T-090) — esta rota só decide o
// `responsavelId` e lê o relógio real (ASM-062: os testes injetam o relógio
// via `vi.setSystemTime`, nunca dependem de `Date.now()` sem controle).
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../db/client';
import { getAuth } from '../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../lib/auth/tenant';
import { listarFilaDoTurno } from '../../../repositories/cadencia';

export const dynamic = 'force-dynamic';

async function resolverContexto(request: NextRequest): Promise<ContextoTenant | null> {
  const sessao = await getAuth().api.getSession({ headers: request.headers });
  if (!sessao) return null;

  try {
    return await resolverContextoTenant(getDb(), { token: sessao.session.token });
  } catch (erro) {
    if (erro instanceof ErroSessaoInvalida) return null;
    throw erro;
  }
}

function semSessao() {
  return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });
}

/** ASM-061: MASTER, GERENTE e super admin veem o tenant inteiro; ATENDENTE só os próprios cards. */
function podeVerTodoTenant(contexto: ContextoTenant): boolean {
  return contexto.isSuperAdmin || contexto.papel === 'MASTER' || contexto.papel === 'GERENTE';
}

/** AC-468: ATENDENTE vê sempre só os seus; gerente pode filtrar por pessoa (UUID válido). */
function responsavelDoFiltro(contexto: ContextoTenant, request: NextRequest): string | undefined {
  if (!podeVerTodoTenant(contexto)) return contexto.usuarioId;
  const pedido = request.nextUrl.searchParams.get('responsavelId');
  return pedido && /^[0-9a-f-]{36}$/i.test(pedido) ? pedido : undefined;
}

/**
 * AC-192: lista os toques pendentes do turno vigente, dos cards do
 * responsável (ou do tenant inteiro, ASM-061). AC-212: com
 * `?atrasados=1`, a resposta também traz os toques pendentes liberados em
 * turno ou dia anterior ao vigente (`atrasado: true`); sem o parâmetro, o
 * comportamento é exatamente o de AC-192.
 */
export async function GET(request: NextRequest) {
  const contexto = await resolverContexto(request);
  if (!contexto) return semSessao();

  const itens = await listarFilaDoTurno(getDb(), contexto, {
    responsavelId: responsavelDoFiltro(contexto, request),
    agora: new Date(),
    incluirAtrasados: request.nextUrl.searchParams.get('atrasados') === '1',
  });

  return NextResponse.json({ itens });
}
