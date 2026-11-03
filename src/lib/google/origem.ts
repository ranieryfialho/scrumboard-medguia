// T-302 (fase4-tarefas-agenda, AC-765): o endereço (`https://host`) pelo qual a pessoa acessou o CRM, para montar o endereço de retorno do
// Google. Não usa `NEXT_PUBLIC_APP_URL`: variáveis `NEXT_PUBLIC_*` ficam gravadas na imagem na hora do build, e a mesma imagem vale para o
// staging e para a produção — o staging mandava ao Google o endereço de produção (`redirect_uri_mismatch`). Atrás do nginx-proxy-manager o
// endereço de verdade vem em `x-forwarded-host` e `x-forwarded-proto`; sem eles vale o `host` do pedido. O valor só serve como pedido ao
// Google, que recusa qualquer endereço que não esteja cadastrado no cliente OAuth, então um `host` forjado não leva a lugar nenhum.
const HOST_VALIDO = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/i;

const primeiro = (valor: string | null): string | null => valor?.split(',')[0]?.trim() || null;

export function origemDaRequisicao(headers: Headers, urlDoPedido: URL): string {
  const host = primeiro(headers.get('x-forwarded-host')) ?? primeiro(headers.get('host')) ?? urlDoPedido.host;
  const proto = primeiro(headers.get('x-forwarded-proto'));
  const protocolo = proto === 'http' || proto === 'https' ? proto : urlDoPedido.protocol.replace(':', '');
  return HOST_VALIDO.test(host) ? `${protocolo}://${host}` : urlDoPedido.origin;
}
