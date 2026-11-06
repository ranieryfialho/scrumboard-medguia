// T-190 (fase4-whatsapp, AC-502): a coluna da esquerda da caixa de entrada —
// abas, busca e a lista de conversas.
import { SeloEtapa } from '@/components/pipeline/pecas/selo-etapa';
import { nomeDaEtapa } from '@/components/pipeline/detalhe/jornada';
import { ItemEmBreve } from '@/components/pipeline/pecas/selo-em-breve';
import { AvatarContato } from './avatar-contato';
import { formatarNumero, horarioCurto, nomeDaConversa, type ConversaView } from './comum';

export type AbaConversas = 'nao_lidas' | 'minhas' | 'todas';

interface ListaConversasProps {
  conversas: ConversaView[];
  contagens: { naoLidas: number; minhas: number; todas: number };
  aba: AbaConversas;
  busca: string;
  selecionada: string | null;
  onAba: (aba: AbaConversas) => void;
  onBusca: (texto: string) => void;
  onEscolher: (conversa: ConversaView) => void;
}

export function ListaConversas({ conversas, contagens, aba, busca, selecionada, onAba, onBusca, onEscolher }: ListaConversasProps) {
  const abas: { id: AbaConversas; rotulo: string; total: number }[] = [
    { id: 'nao_lidas', rotulo: 'Não Lidas', total: contagens.naoLidas },
    { id: 'minhas', rotulo: 'Minhas', total: contagens.minhas },
    { id: 'todas', rotulo: 'Todas', total: contagens.todas },
  ];

  return (
    <section aria-label="Conversas" className="bg-surface-card rounded-2xl shadow-sm flex flex-col max-h-[28rem] xl:max-h-none xl:h-full xl:min-h-0 overflow-hidden">
      <div className="p-space-md flex flex-col gap-space-sm">
        <input
          type="search"
          value={busca}
          onChange={(e) => onBusca(e.target.value)}
          aria-label="Buscar conversas"
          placeholder="Buscar conversas..."
          className="h-10 px-3 rounded-xl bg-surface-subtle font-body-md text-body-md focus:outline-none"
        />
        <div role="tablist" aria-label="Filtro de conversas" className="flex items-center gap-1 flex-wrap">
          {abas.map((a) => (
            <button
              key={a.id}
              type="button"
              role="tab"
              aria-selected={aba === a.id}
              onClick={() => onAba(a.id)}
              className={`h-8 px-3 rounded-lg font-label-md text-label-md ${aba === a.id ? 'bg-primary text-on-primary font-semibold' : 'text-text-secondary hover:bg-surface-subtle'}`}
            >
              {a.rotulo} ({a.total})
            </button>
          ))}
        </div>
        <ItemEmBreve rotulo="Filtrar por status do pipeline" icone="filter_list" className="font-body-sm" />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto border-t border-surface-container">
        {conversas.length === 0 && <p className="px-space-md py-space-md font-body-md text-body-md text-text-secondary">Nenhuma conversa encontrada</p>}
        <ul className="min-w-0">
          {conversas.map((c) => {
            const nome = nomeDaConversa(c);
            const ativa = selecionada === c.chave;
            return (
              <li key={c.chave}>
                <button
                  type="button"
                  onClick={() => onEscolher(c)}
                  aria-current={ativa ? 'true' : undefined}
                  className={`w-full min-w-0 text-left px-space-md py-3 flex flex-col gap-1 border-l-4 ${ativa ? 'bg-info-surface border-primary' : 'border-transparent hover:bg-surface-subtle'}`}
                >
                  <span className="flex items-center gap-3">
                    <AvatarContato
                      numero={c.numero}
                      nome={nome}
                      className="w-10 h-10 rounded-full bg-surface-container flex items-center justify-center font-label-md text-label-md text-text-secondary shrink-0"
                    />
                    <span className="flex-1 min-w-0 flex flex-col">
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-label-lg text-label-lg text-text-primary truncate">{nome}</span>
                        <span className="font-body-sm text-body-sm text-text-muted shrink-0">{horarioCurto(c.ultimaEm)}</span>
                      </span>
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-label-sm text-label-sm text-text-muted truncate">{c.nome ? formatarNumero(c.numero) : (c.categoria ?? 'Conversa avulsa')}</span>
                        {c.naoLidas > 0 && (
                          <span aria-label={`${c.naoLidas} não lidas`} className="min-w-5 h-5 px-1 rounded-full bg-primary text-on-primary font-label-sm text-label-sm flex items-center justify-center shrink-0">
                            {c.naoLidas}
                          </span>
                        )}
                      </span>
                    </span>
                  </span>
                  <span className="pl-[3.25rem] block max-w-full font-body-sm text-body-sm text-text-secondary truncate">{c.ultimaMensagem}</span>
                  {c.card && (
                    <span className="pl-[3.25rem] flex items-center gap-2 flex-wrap">
                      <SeloEtapa nome={nomeDaEtapa(c.card.etapaId)} />
                      {c.card.cadencia && c.card.cadencia.total > 0 && (
                        <span className="font-label-sm text-label-sm text-text-muted">
                          Toque {c.card.cadencia.atual?.sequencia ?? c.card.cadencia.total}/{c.card.cadencia.total}
                        </span>
                      )}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
