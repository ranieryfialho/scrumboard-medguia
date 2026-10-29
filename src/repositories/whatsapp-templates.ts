// T-245 (fase5-whatsapp-lote-base, US-160): templates de mensagem da empresa da sessão — criar, listar,
// editar, aprovar e arquivar. Sempre por `comTenant`; o RLS de `whatsapp_templates` isola as empresas (AC-672).
import { and, asc, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { usuarios, whatsappTemplates } from '../db/schema';
import type { ContextoTenant } from '../lib/auth/tenant';
import { validarTemplate } from '../lib/whatsapp/template';
import { comTenant } from './contexto';

export type StatusDoTemplate = 'rascunho' | 'aprovado' | 'arquivado';

export interface TemplateView {
  id: string;
  nome: string;
  corpo: string;
  status: StatusDoTemplate;
  criadoEm: string;
  aprovadoEm: string | null;
  aprovadoPorNome: string | null;
}

export type ResultadoDoTemplate =
  | { ok: true; template: TemplateView }
  | { ok: false; codigo: 'TEMPLATE_JA_EXISTE' | 'TEMPLATE_NAO_ENCONTRADO' | 'TEMPLATE_ARQUIVADO' | 'PARAMETRO_INVALIDO'; campo?: string; mensagem?: string };

const colunas = {
  id: whatsappTemplates.id,
  nome: whatsappTemplates.nome,
  corpo: whatsappTemplates.corpo,
  status: whatsappTemplates.status,
  criadoEm: whatsappTemplates.criadoEm,
  aprovadoEm: whatsappTemplates.aprovadoEm,
  aprovadoPorNome: usuarios.nome,
};

function comoView(l: { id: string; nome: string; corpo: string; status: string; criadoEm: Date; aprovadoEm: Date | null; aprovadoPorNome: string | null }): TemplateView {
  return { id: l.id, nome: l.nome, corpo: l.corpo, status: l.status as StatusDoTemplate, criadoEm: l.criadoEm.toISOString(), aprovadoEm: l.aprovadoEm?.toISOString() ?? null, aprovadoPorNome: l.aprovadoPorNome };
}

/** AC-672: o gestor vê todos os da empresa; quem só usa (`somenteAprovados`) vê os aprovados. */
export async function listarTemplates(db: NodePgDatabase, contexto: ContextoTenant, opcoes: { somenteAprovados: boolean }): Promise<TemplateView[]> {
  return comTenant(db, contexto, async (tx) => {
    const linhas = await tx
      .select(colunas)
      .from(whatsappTemplates)
      .leftJoin(usuarios, eq(usuarios.id, whatsappTemplates.aprovadoPor))
      .where(opcoes.somenteAprovados ? eq(whatsappTemplates.status, 'aprovado') : undefined)
      .orderBy(asc(whatsappTemplates.nome));
    return linhas.map(comoView);
  });
}

export async function buscarTemplate(db: NodePgDatabase, contexto: ContextoTenant, id: string): Promise<TemplateView | null> {
  return comTenant(db, contexto, async (tx) => {
    const [l] = await tx.select(colunas).from(whatsappTemplates).leftJoin(usuarios, eq(usuarios.id, whatsappTemplates.aprovadoPor)).where(eq(whatsappTemplates.id, id)).limit(1);
    return l ? comoView(l) : null;
  });
}

/** AC-670: nasce rascunho; nome repetido na empresa (sem diferenciar caixa) dá `TEMPLATE_JA_EXISTE`. */
export async function criarTemplate(db: NodePgDatabase, contexto: ContextoTenant, entrada: { nome: unknown; corpo: unknown }): Promise<ResultadoDoTemplate> {
  const v = validarTemplate(entrada);
  if (!v.ok) return { ok: false, codigo: 'PARAMETRO_INVALIDO', campo: v.campo, mensagem: v.mensagem };
  try {
    const id = await comTenant(db, contexto, async (tx) => {
      const [criado] = await tx
        .insert(whatsappTemplates)
        .values({ empresaId: contexto.empresaId, nome: v.nome, corpo: v.corpo, status: 'rascunho', criadoPor: contexto.usuarioId })
        .returning({ id: whatsappTemplates.id });
      return criado.id;
    });
    return { ok: true, template: (await buscarTemplate(db, contexto, id))! };
  } catch {
    return { ok: false, codigo: 'TEMPLATE_JA_EXISTE' };
  }
}

/**
 * AC-671: `editar` (nome e/ou corpo — de um aprovado, volta a rascunho), `aprovar` (grava quem e quando) ou
 * `arquivar`. Arquivado não edita nem aprova.
 */
export async function alterarTemplate(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  id: string,
  alteracao: { nome?: unknown; corpo?: unknown; acao?: 'aprovar' | 'arquivar' }
): Promise<ResultadoDoTemplate> {
  const atual = await buscarTemplate(db, contexto, id);
  if (!atual) return { ok: false, codigo: 'TEMPLATE_NAO_ENCONTRADO' };
  if (atual.status === 'arquivado') return { ok: false, codigo: 'TEMPLATE_ARQUIVADO' };

  try {
    await comTenant(db, contexto, async (tx) => {
      if (alteracao.acao === 'arquivar') {
        await tx.update(whatsappTemplates).set({ status: 'arquivado', atualizadoEm: sql`now()` }).where(eq(whatsappTemplates.id, id));
        return;
      }
      if (alteracao.acao === 'aprovar') {
        await tx
          .update(whatsappTemplates)
          .set({ status: 'aprovado', aprovadoPor: contexto.usuarioId, aprovadoEm: sql`now()`, atualizadoEm: sql`now()` })
          .where(and(eq(whatsappTemplates.id, id)));
        return;
      }
      const v = validarTemplate({ nome: alteracao.nome ?? atual.nome, corpo: alteracao.corpo ?? atual.corpo });
      if (!v.ok) throw Object.assign(new Error('invalido'), { validacao: v });
      const mudou = v.nome !== atual.nome || v.corpo !== atual.corpo;
      await tx
        .update(whatsappTemplates)
        .set({
          nome: v.nome,
          corpo: v.corpo,
          ...(mudou && atual.status === 'aprovado' ? { status: 'rascunho', aprovadoPor: null, aprovadoEm: null } : {}),
          atualizadoEm: sql`now()`,
        })
        .where(eq(whatsappTemplates.id, id));
    });
  } catch (erro) {
    const validacao = (erro as { validacao?: { campo: string; mensagem: string } }).validacao;
    if (validacao) return { ok: false, codigo: 'PARAMETRO_INVALIDO', campo: validacao.campo, mensagem: validacao.mensagem };
    return { ok: false, codigo: 'TEMPLATE_JA_EXISTE' };
  }
  return { ok: true, template: (await buscarTemplate(db, contexto, id))! };
}
