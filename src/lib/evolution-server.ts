import { createClient } from '@supabase/supabase-js';
import { buildConfig, EvolutionConfig } from './evolution-api';

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Retorna o nome da instância salvo para a empresa.
 * Retorna null se o usuário ainda não definiu um nome.
 */
export async function resolveInstance(empresaId: string): Promise<string | null> {
  const db = admin();

  const { data: saved } = await db
    .from('empresa_configuracoes')
    .select('valor')
    .eq('empresa_id', empresaId)
    .eq('chave', 'evolution_instance_name')
    .single();

  return saved?.valor || null;
}

/** Retorna o EvolutionConfig completo para uma empresa, ou null se instância não configurada. */
export async function getEmpresaConfig(empresaId: string): Promise<EvolutionConfig | null> {
  const instance = await resolveInstance(empresaId);
  if (!instance) return null;
  return buildConfig(instance);
}

/** Extrai empresa_id do usuário autenticado, respeitando super_admin + cookie de tenant. */
export function extractEmpresaId(
  userMetadata: Record<string, any>,
  cookieHeader: string
): string | null {
  if (userMetadata?.is_super_admin) {
    const match = cookieHeader.match(/selected_empresa_id=([^;]+)/);
    if (match) return match[1];
  }
  return userMetadata?.empresa_id || null;
}
