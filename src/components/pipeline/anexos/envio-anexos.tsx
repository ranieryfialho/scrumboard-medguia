'use client';

// T-172 (fase4-card-abas, US-112, AC-427/AC-429): área "Adicionar Arquivos ou
// Evidências ao Dossiê" — arrastar ou escolher PDF, PNG, JPG ou WebP e enviar
// por `POST /api/anexos` (limites do servidor: imagem até 5 MB, PDF até 10 MB,
// ASM-148). A caixa "Marcar como evidência" e o "Vincular à etapa" do protótipo
// não têm backend e ficam "em breve" (AC-429).
import { useState, type DragEvent, type RefObject } from 'react';

import { ItemEmBreve } from '@/components/pipeline/pecas/selo-em-breve';

interface EnvioAnexosProps {
  cardId: string;
  /** O mesmo input é aberto pelo botão "Upload" do topo da tela. */
  inputRef: RefObject<HTMLInputElement | null>;
  onEnviado: () => void;
}

function mensagemDoErro(status: number, codigo: string | undefined, nome: string): string {
  if (status === 415 || codigo === 'TIPO_NAO_PERMITIDO') {
    return `“${nome}”: tipo de arquivo não permitido (use PDF, PNG, JPG ou WebP).`;
  }
  if (status === 413 || codigo === 'ARQUIVO_GRANDE_DEMAIS') {
    return `“${nome}”: arquivo grande demais (imagens até 5 MB, PDF até 10 MB).`;
  }
  return `“${nome}”: não foi possível enviar. Tente de novo.`;
}

export function EnvioAnexos({ cardId, inputRef, onEnviado }: EnvioAnexosProps) {
  const [arrastando, setArrastando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erros, setErros] = useState<string[]>([]);

  async function enviar(arquivos: File[]) {
    if (arquivos.length === 0) return;
    setEnviando(true);
    setErros([]);
    const falhas: string[] = [];
    let algumEnviado = false;

    for (const arquivo of arquivos) {
      const formulario = new FormData();
      formulario.set('oportunidadeId', cardId);
      formulario.set('arquivo', arquivo);
      try {
        const resposta = await fetch('/api/anexos', { method: 'POST', body: formulario });
        if (resposta.ok) {
          algumEnviado = true;
        } else {
          const corpo = (await resposta.json().catch(() => null)) as { codigo?: string } | null;
          falhas.push(mensagemDoErro(resposta.status, corpo?.codigo, arquivo.name));
        }
      } catch {
        falhas.push(mensagemDoErro(0, undefined, arquivo.name));
      }
    }

    setErros(falhas);
    setEnviando(false);
    if (inputRef.current) inputRef.current.value = '';
    if (algumEnviado) onEnviado();
  }

  function aoSoltar(evento: DragEvent<HTMLDivElement>) {
    evento.preventDefault();
    setArrastando(false);
    void enviar(Array.from(evento.dataTransfer.files));
  }

  return (
    <section className="bg-surface-card rounded-2xl p-space-lg shadow-sm flex flex-col gap-space-md">
      <div>
        <h2 className="font-headline-md text-headline-md text-text-primary">Adicionar Arquivos ou Evidências ao Dossiê</h2>
        <p className="font-body-sm text-body-sm text-text-secondary">
          Os documentos ficam vinculados ao histórico desta negociação comercial.
        </p>
      </div>

      <div
        data-testid="area-de-envio"
        onDragOver={(evento) => {
          evento.preventDefault();
          setArrastando(true);
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={aoSoltar}
        className={`rounded-2xl border-2 border-dashed p-space-xl flex flex-col items-center justify-center text-center gap-2 transition-colors ${
          arrastando ? 'border-primary bg-primary-fixed/30' : 'border-border-subtle bg-surface-subtle/50'
        }`}
      >
        <span aria-hidden="true" className="material-symbols-outlined text-primary text-[40px]">
          upload_file
        </span>
        <p className="font-headline-sm text-headline-sm text-text-primary">
          Arraste propostas, comprovantes ou prints de conversas aqui
        </p>
        <p className="font-body-md text-body-md text-text-secondary">
          ou{' '}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={enviando}
            className="text-primary font-semibold hover:underline disabled:opacity-60"
          >
            procure arquivos no seu computador
          </button>
        </p>
        <p className="font-body-sm text-body-sm text-text-muted">
          Formatos: PDF, PNG, JPG, WebP • Imagens até 5 MB e PDF até 10 MB
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="application/pdf,image/png,image/jpeg,image/webp"
          aria-label="Escolher arquivos para enviar"
          className="sr-only"
          onChange={(evento) => void enviar(Array.from(evento.target.files ?? []))}
        />
        {enviando && (
          <p role="status" className="font-label-md text-label-md text-primary">
            Enviando...
          </p>
        )}
      </div>

      {erros.length > 0 && (
        <ul role="alert" className="flex flex-col gap-1 font-body-sm text-body-sm text-danger-text bg-danger-surface rounded-lg px-3 py-2">
          {erros.map((erro) => (
            <li key={erro}>{erro}</li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-space-md bg-surface-subtle rounded-xl px-space-md py-space-sm">
        <ItemEmBreve rotulo="Marcar como evidência de transição de etapa" icone="verified" className="py-1" />
        <ItemEmBreve rotulo="Vincular à etapa" icone="timeline" className="py-1" />
      </div>
    </section>
  );
}
