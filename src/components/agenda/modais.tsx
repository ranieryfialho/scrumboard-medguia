'use client';

// T-187 (fase4-tarefas-agenda, AC-492/AC-496): os modais das ações da agenda —
// Agendar, Reagendar e Marcar como Concluída. O botão de confirmar fica
// desabilitado enquanto falta dado ou enquanto envia; a mensagem do motivo
// aparece dentro do modal, que só fecha ao dar certo (o que foi digitado fica).
// A evidência da conclusão usa o mesmo modal de evidência do funil.
import { useEffect, useState } from 'react';

import { ModalDadoFaltante } from '@/components/pipeline/modal-dado-faltante';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { agendarReuniao, concluirReuniao, reagendarReuniao, type ResultadoAcaoAgenda } from './acoes-reuniao';
import { instanteDeBrasilia } from './datas';
import type { ReuniaoView } from './tipos';

const CLASSE_CAMPO = 'h-10 px-3 rounded-xl bg-surface-subtle font-body-md text-body-md text-text-primary w-full';

interface RodapeProps {
  confirmarRotulo: string;
  desabilitado: boolean;
  enviando: boolean;
  erro: string | null;
  onConfirmar: () => void;
  onFechar: () => void;
}

function Rodape({ confirmarRotulo, desabilitado, enviando, erro, onConfirmar, onFechar }: RodapeProps) {
  return (
    <>
      {erro && (
        <p role="alert" className="text-sm text-danger-text">
          {erro}
        </p>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onFechar}>
          Cancelar
        </Button>
        <Button onClick={onConfirmar} disabled={desabilitado || enviando}>
          {enviando ? 'Enviando...' : confirmarRotulo}
        </Button>
      </DialogFooter>
    </>
  );
}

function CamposDeDataEHora({ data, hora, onData, onHora }: { data: string; hora: string; onData: (v: string) => void; onHora: (v: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <label className="flex flex-col gap-1 font-label-md text-label-md text-text-secondary">
        Data
        <input type="date" value={data} onChange={(e) => onData(e.target.value)} className={CLASSE_CAMPO} />
      </label>
      <label className="flex flex-col gap-1 font-label-md text-label-md text-text-secondary">
        Hora
        <input type="time" value={hora} onChange={(e) => onHora(e.target.value)} className={CLASSE_CAMPO} />
      </label>
    </div>
  );
}

/** AC-489: escolhe o card (só os de "Qualificado p/ reunião"), a data e a hora. */
export function ModalAgendar({ onFechar, onConcluido }: { onFechar: () => void; onConcluido: () => void }) {
  const [cards, setCards] = useState<{ id: string; leadNome: string }[] | null>(null);
  const [cardId, setCardId] = useState('');
  const [data, setData] = useState('');
  const [hora, setHora] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    fetch('/api/reunioes/elegiveis')
      .then((r) => (r.ok ? r.json() : { cards: [] }))
      .then((corpo: { cards: { id: string; leadNome: string }[] }) => !cancelado && setCards(corpo.cards))
      .catch(() => !cancelado && setCards([]));
    return () => {
      cancelado = true;
    };
  }, []);

  async function confirmar() {
    setEnviando(true);
    setErro(null);
    const r: ResultadoAcaoAgenda = await agendarReuniao(cardId, instanteDeBrasilia(data, hora));
    setEnviando(false);
    if (r.ok) onConcluido();
    else setErro(r.mensagem);
  }

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Agendar Reunião</DialogTitle>
          <DialogDescription>O card vai para &quot;Reunião agendada&quot; no funil.</DialogDescription>
        </DialogHeader>
        <label className="flex flex-col gap-1 font-label-md text-label-md text-text-secondary">
          Card (Qualificado p/ reunião)
          <select value={cardId} onChange={(e) => setCardId(e.target.value)} className={CLASSE_CAMPO}>
            <option value="">{cards === null ? 'Carregando...' : 'Escolha o card'}</option>
            {(cards ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.leadNome}
              </option>
            ))}
          </select>
        </label>
        {cards !== null && cards.length === 0 && (
          <p className="font-body-sm text-body-sm text-text-muted">Nenhum card em &quot;Qualificado p/ reunião&quot; no momento.</p>
        )}
        <CamposDeDataEHora data={data} hora={hora} onData={setData} onHora={setHora} />
        <Rodape confirmarRotulo="Agendar" desabilitado={!cardId || !data || !hora} enviando={enviando} erro={erro} onConfirmar={confirmar} onFechar={onFechar} />
      </DialogContent>
    </Dialog>
  );
}

/** AC-493: nova data e hora; a reunião anterior passa a "Remarcada". */
export function ModalReagendar({ reuniao, onFechar, onConcluido }: { reuniao: { id: string; leadNome: string }; onFechar: () => void; onConcluido: () => void }) {
  const [data, setData] = useState('');
  const [hora, setHora] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function confirmar() {
    setEnviando(true);
    setErro(null);
    const r = await reagendarReuniao(reuniao.id, instanteDeBrasilia(data, hora));
    setEnviando(false);
    if (r.ok) onConcluido();
    else setErro(r.mensagem);
  }

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reagendar Reunião</DialogTitle>
          <DialogDescription>{reuniao.leadNome}: escolha a nova data e hora.</DialogDescription>
        </DialogHeader>
        <CamposDeDataEHora data={data} hora={hora} onData={setData} onHora={setHora} />
        <Rodape confirmarRotulo="Reagendar" desabilitado={!data || !hora} enviando={enviando} erro={erro} onConfirmar={confirmar} onFechar={onFechar} />
      </DialogContent>
    </Dialog>
  );
}

/** AC-492/AC-496: resumo opcional; se a API pedir a evidência, abre o modal de evidência do funil e tenta de novo. */
export function ModalConcluir({ reuniao, onFechar, onConcluido }: { reuniao: ReuniaoView; onFechar: () => void; onConcluido: () => void }) {
  const [resumo, setResumo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pedindoEvidencia, setPedindoEvidencia] = useState(false);

  async function enviar(anexoId?: string) {
    setEnviando(true);
    setErro(null);
    const r = await concluirReuniao(reuniao.id, resumo, anexoId);
    setEnviando(false);
    if (r.ok) {
      onConcluido();
      return;
    }
    if (r.codigo === 'EVIDENCIA_OBRIGATORIA') setPedindoEvidencia(true);
    else setErro(r.mensagem);
  }

  return (
    <>
      <Dialog open={!pedindoEvidencia} onOpenChange={(aberto) => !aberto && onFechar()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Marcar como Concluída</DialogTitle>
            <DialogDescription>{reuniao.lead.nome}: o card vai para &quot;Reunião realizada&quot; (exige a evidência).</DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1 font-label-md text-label-md text-text-secondary">
            Resumo da reunião (opcional)
            <textarea value={resumo} onChange={(e) => setResumo(e.target.value)} rows={4} maxLength={2000} className="rounded-xl bg-surface-subtle p-3 font-body-md text-body-md text-text-primary" />
          </label>
          <Rodape confirmarRotulo="Concluir" desabilitado={false} enviando={enviando} erro={erro} onConfirmar={() => enviar()} onFechar={onFechar} />
        </DialogContent>
      </Dialog>
      {pedindoEvidencia && (
        <ModalDadoFaltante
          codigo="EVIDENCIA_OBRIGATORIA"
          aberto
          oportunidadeId={reuniao.oportunidadeId}
          onCancelar={() => setPedindoEvidencia(false)}
          onConfirmar={(dado) => {
            setPedindoEvidencia(false);
            if (dado.anexoId) void enviar(dado.anexoId);
          }}
        />
      )}
    </>
  );
}
