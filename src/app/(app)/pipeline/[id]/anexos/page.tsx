'use client';

// T-172 (fase4-card-abas, US-112): tela de anexos e evidências do card — fonte
// visual `docs/ui/stitch_medcrm_interface_design/12._pipeline_id_anexos_prints_e_evid_ncias_do_card/`.
// Vive no grupo `(app)` (a casca vem de `src/app/(app)/layout.tsx`) e dentro do
// `MoldeDoCard` (T-171): cabeçalho, abas e os estados de carregando, erro e
// "não encontrado" do card. A lista vem de `GET /api/oportunidades/[id]/anexos`
// (T-169); busca e filtro por tipo rodam no navegador sobre ela (poucos anexos
// por card). Blocos sem dado (governança ISO, espaço usado, selos de aprovação)
// não aparecem; ações sem backend ficam "em breve" (AC-429).
import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { MoldeDoCard } from '@/components/pipeline/card/molde-do-card';
import { EsqueletoCarregando, EstadoErro, EstadoVazio } from '@/components/pipeline/pecas/estados';
import { EnvioAnexos } from '@/components/pipeline/anexos/envio-anexos';
import {
  FiltrosAnexos,
  type FiltroTipoAnexo,
  type ValorFiltrosAnexos,
} from '@/components/pipeline/anexos/filtros-anexos';
import { nomeParaExibir, tipoDoAnexo, type AnexoDaLista } from '@/components/pipeline/anexos/formatos';
import { ListaAnexos } from '@/components/pipeline/anexos/lista-anexos';

function passaNoFiltro(anexo: AnexoDaLista, tipo: FiltroTipoAnexo): boolean {
  if (tipo === 'evidencias') return anexo.evidencia !== null;
  if (tipo === 'pdfs') return tipoDoAnexo(anexo.mime) === 'pdf';
  if (tipo === 'imagens') return tipoDoAnexo(anexo.mime) === 'imagem';
  return true;
}

function ConteudoAnexos({ cardId, onMudou }: { cardId: string; onMudou: () => void }) {
  const [anexos, setAnexos] = useState<AnexoDaLista[] | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(false);
  const [filtro, setFiltro] = useState<ValorFiltrosAnexos>({ busca: '', tipo: 'todos' });
  const inputRef = useRef<HTMLInputElement | null>(null);

  const carregar = useCallback(async () => {
    setErro(false);
    try {
      const resposta = await fetch(`/api/oportunidades/${cardId}/anexos`);
      if (!resposta.ok) throw new Error(`anexos respondeu ${resposta.status}`);
      const corpo = (await resposta.json()) as { anexos: AnexoDaLista[] };
      setAnexos(corpo.anexos);
    } catch {
      setErro(true);
    } finally {
      setCarregando(false);
    }
  }, [cardId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const contagens = useMemo<Record<FiltroTipoAnexo, number>>(() => {
    const lista = anexos ?? [];
    return {
      todos: lista.length,
      evidencias: lista.filter((a) => passaNoFiltro(a, 'evidencias')).length,
      pdfs: lista.filter((a) => passaNoFiltro(a, 'pdfs')).length,
      imagens: lista.filter((a) => passaNoFiltro(a, 'imagens')).length,
    };
  }, [anexos]);

  const visiveis = useMemo(() => {
    const busca = filtro.busca.trim().toLowerCase();
    return (anexos ?? []).filter(
      (anexo) => passaNoFiltro(anexo, filtro.tipo) && (busca === '' || nomeParaExibir(anexo).toLowerCase().includes(busca))
    );
  }, [anexos, filtro]);

  return (
    <div className="p-gutter flex flex-col gap-space-md w-full lg:flex-1 lg:min-h-0">
      <div className="flex flex-wrap items-center justify-between gap-space-sm">
        <div>
          <h2 className="font-headline-md text-headline-md text-text-primary">Anexos &amp; Evidências</h2>
          <p className="font-body-sm text-body-sm text-text-secondary">
            Prints e PDFs desta negociação. Os links de abertura expiram em 15 minutos.
          </p>
        </div>
        <div className="flex items-center gap-space-sm flex-wrap">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="h-10 px-4 rounded-xl bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md font-semibold shadow-md flex items-center gap-2 transition-all"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[19px]">
              cloud_upload
            </span>
            Upload de Arquivo / Evidência
          </button>
          {anexos && anexos.length > 0 ? (
            <a
              href={`/api/oportunidades/${cardId}/dossie`}
              className="h-10 px-4 rounded-xl bg-surface-card hover:bg-surface-subtle shadow-sm flex items-center gap-2 font-label-md text-label-md font-semibold text-text-primary transition-colors"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[19px]">
                folder_zip
              </span>
              Exportar Dossiê (ZIP)
            </a>
          ) : (
            <span
              role="button"
              aria-disabled="true"
              title="Envie ao menos um anexo para exportar o dossiê"
              className="h-10 px-4 rounded-xl bg-surface-card shadow-sm flex items-center gap-2 font-label-md text-label-md text-text-muted cursor-not-allowed"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[19px]">
                folder_zip
              </span>
              Exportar Dossiê (ZIP)
            </span>
          )}
        </div>
      </div>

      <FiltrosAnexos valor={filtro} contagens={contagens} onMudar={(parcial) => setFiltro((atual) => ({ ...atual, ...parcial }))} />

      {/* AC-749: título e filtros ficam parados; a lista e a área de envio rolam por dentro. */}
      <div className="relative flex flex-col gap-space-md lg:flex-1 lg:min-h-0 lg:overflow-y-auto">
        {carregando && <EsqueletoCarregando />}
        {!carregando && erro && <EstadoErro onTentarDeNovo={carregar} />}
        {!carregando && !erro && anexos && anexos.length === 0 && (
          <EstadoVazio titulo="Nenhum anexo ainda" proximoPasso="envie o primeiro pela área abaixo" icone="attachment" />
        )}
        {!carregando && !erro && anexos && anexos.length > 0 && visiveis.length === 0 && (
          <EstadoVazio titulo="Nenhum anexo com estes filtros" proximoPasso="tente mudar a busca ou o tipo" icone="filter_alt_off" />
        )}
        {!carregando && !erro && visiveis.length > 0 && <ListaAnexos
            anexos={visiveis}
            onMudou={() => {
              void carregar();
              onMudou();
            }}
          />}

        <EnvioAnexos
          cardId={cardId}
          inputRef={inputRef}
          onEnviado={() => {
            void carregar();
            onMudou();
          }}
        />
      </div>
    </div>
  );
}

export default function PipelineAnexosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  // Mexer nos anexos refaz o número da aba "Anexos & Evidências" no molde.
  const [versao, setVersao] = useState(0);

  return (
    <MoldeDoCard cardId={id} aba="anexos" versaoDosContadores={versao} alturaFixa>
      {(card) => <ConteudoAnexos cardId={card.id} onMudou={() => setVersao((atual) => atual + 1)} />}
    </MoldeDoCard>
  );
}
