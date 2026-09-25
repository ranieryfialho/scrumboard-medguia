// T-035 (fase1-dominio-pipeline, US-022, AC-050/AC-051/AC-052): super admin
// ignora `papeis_permitidos` (Q-007 da spec — mesma convenção de bypass de
// RBAC já usada na troca de empresa da fase1-auth-rbac).
import type { AtorTransicao, PapelUsuario } from './tipos';

export function papelPodeTransicionar(
  papeisPermitidos: readonly PapelUsuario[],
  ator: AtorTransicao
): boolean {
  if (ator.isSuperAdmin) {
    return true;
  }
  return papeisPermitidos.includes(ator.papel);
}
