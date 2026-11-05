// Quem acessa as campanhas de e-mail: super admin, master e quem tem o módulo "Campanhas" liberado (gerente por padrão; os demais só se
// o master ou o gerente liberar). O mesmo critério do menu, das páginas e das APIs.
import type { NextRequest } from 'next/server';

import { exigirModulo, temModulo } from '../auth/exigir-modulo';
import type { ContextoTenant } from '../auth/tenant';

export function acessoACampanhas(contexto: Pick<ContextoTenant, 'isSuperAdmin' | 'papel' | 'modulos'>): boolean {
  return temModulo(contexto, 'campanhas');
}

export function exigirAcessoACampanhas(request: NextRequest) {
  return exigirModulo(request, 'campanhas');
}
