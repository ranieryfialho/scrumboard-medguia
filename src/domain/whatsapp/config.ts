// T-083 (fase2c-whatsapp-conexao): validação pura do corpo de
// POST /api/whatsapp/config (sem I/O), compartilhada pela rota (T-085) e
// pelo repositório (T-084). Garante que só as seis chaves do legado
// (ASM-050) chegam ao banco e que `evolution_instance_name` já nasce no
// formato que a Evolution aceita na URL da instância (ASM-052), antes de
// qualquer gravação.

export const CHAVES_PERMITIDAS = [
  'evolution_instance_name',
  'evolution_auto_msg_em_contato',
  'evolution_auto_msg_recontato',
  'evolution_auto_msg_reuniao_agendada',
  'evolution_auto_msg_aguardando_ativacao',
  'evolution_auto_msg_logins_ativados',
] as const;

export type ChaveConfig = (typeof CHAVES_PERMITIDAS)[number];

const REGEX_NOME_INSTANCIA = /^[A-Za-z0-9_-]{1,64}$/;

export type ResultadoValidacaoConfig =
  | { ok: true; valores: Partial<Record<ChaveConfig, string>> }
  | { ok: false; erro: 'REQUISICAO_INVALIDA' };

/**
 * Valida o corpo de `POST /api/whatsapp/config` (AC-174): precisa ser um
 * objeto JSON, todo valor precisa ser texto, e `evolution_instance_name`
 * (quando presente) precisa ter de 1 a 64 caracteres entre letras, números,
 * `-` e `_`. Em caso de falha, nada deve ser gravado — nem as outras chaves
 * do mesmo pedido. Em caso de sucesso, devolve só as chaves permitidas
 * (ASM-050), ignorando qualquer outra (inclusive `empresa_id` e
 * `evolution_webhook_secret`, cobertos pelo repositório em AC-172).
 */
export function validarCorpoConfig(corpo: unknown): ResultadoValidacaoConfig {
  if (typeof corpo !== 'object' || corpo === null || Array.isArray(corpo)) {
    return { ok: false, erro: 'REQUISICAO_INVALIDA' };
  }

  const entradas = Object.entries(corpo as Record<string, unknown>);

  for (const [, valor] of entradas) {
    if (typeof valor !== 'string') {
      return { ok: false, erro: 'REQUISICAO_INVALIDA' };
    }
  }

  const nomeInstancia = (corpo as Record<string, unknown>).evolution_instance_name;
  if (typeof nomeInstancia === 'string' && !REGEX_NOME_INSTANCIA.test(nomeInstancia)) {
    return { ok: false, erro: 'REQUISICAO_INVALIDA' };
  }

  const valores: Partial<Record<ChaveConfig, string>> = {};
  for (const [chave, valor] of entradas) {
    if ((CHAVES_PERMITIDAS as readonly string[]).includes(chave)) {
      valores[chave as ChaveConfig] = valor as string;
    }
  }

  return { ok: true, valores };
}
