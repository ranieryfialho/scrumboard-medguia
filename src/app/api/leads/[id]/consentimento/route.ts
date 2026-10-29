// T-246 (fase5-whatsapp-lote-base, AC-667/AC-668): `GET` lê e `PUT` registra ou revoga o consentimento do lead
// para receber WhatsApp. Qualquer papel que enxerga o lead (ASM-240); lead de outra empresa é 404, sem sessão 401.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../../db/client';
import { contextoDaSessao } from '../../../../../lib/auth/sessao';
import { definirConsentimento, lerConsentimento } from '../../../../../repositories/lead-consentimento';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const naoEncontrado = () => NextResponse.json({ codigo: 'LEAD_NAO_ENCONTRADO' }, { status: 404 });
const semSessao = () => NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await contextoDaSessao(request);
  if (!contexto) return semSessao();
  const { id } = await params;
  if (!UUID.test(id)) return naoEncontrado();
  const c = await lerConsentimento(getDb(), contexto, id);
  return c ? NextResponse.json(c) : naoEncontrado();
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await contextoDaSessao(request);
  if (!contexto) return semSessao();
  const { id } = await params;
  if (!UUID.test(id)) return naoEncontrado();
  const corpo = (await request.json().catch(() => null)) as { consentimento?: unknown } | null;
  if (typeof corpo?.consentimento !== 'boolean') return NextResponse.json({ codigo: 'PARAMETRO_INVALIDO', campo: 'consentimento', mensagem: 'Informe true ou false.' }, { status: 400 });
  const c = await definirConsentimento(getDb(), contexto, id, corpo.consentimento);
  return c ? NextResponse.json(c) : naoEncontrado();
}
