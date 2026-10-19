// T-109 (fase3-etl-supabase, US-069): migra empresas e usuários do Supabase
// legado para o destino, preservando `id` (AC-252, AC-253) e sem nunca ler
// ou gravar credencial de senha (AC-255) — `UsuarioLegado` nem tem campo de
// senha, então não há como vazar o que nunca foi lido. Reaproveita o
// contrato de T-108 (`buscarIdDestino`/`registrarMigracao`) para idempotência
// em reexecução.
import { buscarIdDestino, registrarMigracao, type ContextoExecucao, type TransacaoEtl } from '../comum';
import { empresas, empresasUsuarios, usuarios } from '../../db/schema';

export const ENTIDADE_EMPRESA = 'empresa';
export const ENTIDADE_USUARIO = 'usuario';

/** Papel bruto do usuário no legado (coluna `perfil` em `user_metadata`). */
export type PapelLegado = 'ADMIN' | 'COMERCIAL' | 'MARKETING';

/** Papel traduzido no destino (enum `papel_usuario`, sem MASTER aqui — esse vem só de super admin). */
export type PapelDestino = 'GERENTE' | 'ATENDENTE';

export interface EmpresaLegado {
  id: string;
  nome: string;
  slug: string;
}

export interface UsuarioLegado {
  id: string;
  email: string;
  nome: string;
  perfil: PapelLegado;
  ativo: boolean;
  empresaId: string;
  isSuperAdmin: boolean;
}

export interface ResultadoMigracao {
  lidas: number;
  criadas: number;
  ignoradas: number;
}

const PAPEL_POR_PERFIL: Record<PapelLegado, PapelDestino> = {
  ADMIN: 'GERENTE',
  COMERCIAL: 'ATENDENTE',
  MARKETING: 'ATENDENTE',
};

/** Traduz o perfil do legado para o papel novo (ASM-081, AC-253). */
export function traduzirPapel(perfil: PapelLegado): PapelDestino {
  return PAPEL_POR_PERFIL[perfil];
}

/**
 * Migra as empresas do legado preservando `id` e `slug` (AC-252). Idempotente:
 * uma empresa já registrada em `migracao_registros` é ignorada, não duplicada.
 */
export async function migrarEmpresas(
  tx: TransacaoEtl,
  contexto: ContextoExecucao,
  empresasLegado: EmpresaLegado[]
): Promise<ResultadoMigracao> {
  let criadas = 0;
  let ignoradas = 0;

  for (const empresa of empresasLegado) {
    const existente = await buscarIdDestino(tx, contexto.origem, empresa.id);
    if (existente) {
      ignoradas++;
      continue;
    }

    await tx.insert(empresas).values({
      id: empresa.id,
      nome: empresa.nome,
      slug: empresa.slug,
    });
    await registrarMigracao(tx, contexto, {
      entidade: ENTIDADE_EMPRESA,
      idExterno: empresa.id,
      idDestino: empresa.id,
    });
    criadas++;
  }

  return { lidas: empresasLegado.length, criadas, ignoradas };
}

/**
 * Migra os usuários do legado preservando `id` (AC-253) — sem nunca tocar
 * credencial de senha (AC-255: `UsuarioLegado` não carrega esse campo).
 * ADMIN vira GERENTE, COMERCIAL/MARKETING vira ATENDENTE (ASM-081); super
 * admin vira MASTER nas `idsEmpresasDestino` todas (Q-028), já migrado o
 * mesmo `ativo` do legado tanto em `usuarios` quanto em `empresas_usuarios`
 * (AC-254 — é esse campo que `src/lib/auth/login.ts` e `tenant.ts` checam
 * para recusar entrada). Usuário comum (não super admin) só vincula à
 * própria empresa de origem (AC-271) — sem super admin, nenhum dado cruza
 * de uma empresa para outra.
 */
export async function migrarUsuarios(
  tx: TransacaoEtl,
  contexto: ContextoExecucao,
  usuariosLegado: UsuarioLegado[],
  idsEmpresasDestino: string[]
): Promise<ResultadoMigracao> {
  let criadas = 0;
  let ignoradas = 0;

  for (const usuario of usuariosLegado) {
    const existente = await buscarIdDestino(tx, contexto.origem, usuario.id);
    if (existente) {
      ignoradas++;
      continue;
    }

    await tx.insert(usuarios).values({
      id: usuario.id,
      email: usuario.email,
      nome: usuario.nome,
      isSuperAdmin: usuario.isSuperAdmin,
      ativo: usuario.ativo,
    });

    const papel = usuario.isSuperAdmin ? 'MASTER' : traduzirPapel(usuario.perfil);
    const empresasVinculo = usuario.isSuperAdmin ? idsEmpresasDestino : [usuario.empresaId];

    for (const empresaId of empresasVinculo) {
      await tx.insert(empresasUsuarios).values({
        empresaId,
        usuarioId: usuario.id,
        papel,
        ativo: usuario.ativo,
      });
    }

    await registrarMigracao(tx, contexto, {
      entidade: ENTIDADE_USUARIO,
      idExterno: usuario.id,
      idDestino: usuario.id,
    });
    criadas++;
  }

  return { lidas: usuariosLegado.length, criadas, ignoradas };
}
