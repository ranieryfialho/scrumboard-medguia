'use client';

// T-321 (fase4-admin, US-137): os três painéis da tela de equipe que antes eram "em breve" — "Políticas & Perfis" (o que cada papel
// vê, calculado do mesmo menu e das mesmas regras que o sistema usa), "Logs de Auditoria" (o registro de quem fez o quê com a
// equipe, e as exportações) e "Sessão e acesso" (a duração da sessão e o IP de quem está acessando).
import { useEffect, useState } from 'react';

import { ItemEmBreve } from '@/components/pipeline/pecas/selo-em-breve';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { GRUPOS_MENU, menuParaPapel } from '@/components/shell/menu-config';
import type { PapelUsuario } from '@/lib/auth/convites';
import { MODULOS, modulosDoPapel, modulosPadraoDoPapel, type ModuloId } from '@/lib/auth/modulos';
import { Button } from '@/components/ui/button';
import { COR_DO_PAPEL, PAPEIS, mensagemDeErro, type ColaboradorView } from './comum';

export interface EventoDeAuditoria {
  id: string;
  quando: string;
  ator: string | null;
  acao: 'convite' | 'reenvio_convite' | 'papel_alterado' | 'desativado' | 'reativado' | 'acessos_alterados' | 'exportacao';
  alvo: string;
  detalhe: Record<string, unknown>;
}

export const ROTULO_DA_ACAO: Record<EventoDeAuditoria['acao'], string> = {
  convite: 'Convidou',
  reenvio_convite: 'Reenviou o convite de',
  papel_alterado: 'Alterou o papel de',
  desativado: 'Desativou',
  reativado: 'Reativou',
  acessos_alterados: 'Alterou os acessos de',
  exportacao: 'Exportou a lista de',
};

/** O que o evento acrescenta ("de GERENTE para ATENDENTE", "42 linhas"...). */
export function detalheDoEvento(e: EventoDeAuditoria): string {
  if (e.acao === 'papel_alterado') return `de ${String(e.detalhe.de)} para ${String(e.detalhe.para)}`;
  if (e.acao === 'acessos_alterados') return Array.isArray(e.detalhe.modulos) ? `${e.detalhe.modulos.length} módulos liberados` : 'voltou ao padrão do papel';
  if (e.acao === 'convite' || e.acao === 'reativado') return typeof e.detalhe.papel === 'string' ? `como ${e.detalhe.papel}${Array.isArray(e.detalhe.modulos) ? ` com ${e.detalhe.modulos.length} módulos` : ''}` : '';
  if (e.acao === 'exportacao') return `${String(e.detalhe.linhas ?? 0)} linhas`;
  return '';
}

export const dataEHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

const CAPACIDADES: { rotulo: string; papeis: Record<PapelUsuario, string> }[] = [
  { rotulo: 'Convidar usuários', papeis: { MASTER: 'Qualquer papel', GERENTE: 'Só atendentes', ATENDENTE: '—' } },
  { rotulo: 'Reenviar convite', papeis: { MASTER: 'Qualquer papel', GERENTE: 'Só atendentes', ATENDENTE: '—' } },
  { rotulo: 'Trocar o papel, desativar e reativar', papeis: { MASTER: 'Sim', GERENTE: '—', ATENDENTE: '—' } },
];

export function DialogoDePoliticas({ onFechar }: { onFechar: () => void }) {
  const itensPorPapel = Object.fromEntries(PAPEIS.map((p) => [p, new Set(menuParaPapel(p, false).flatMap((g) => g.itens.map((i) => i.id)))])) as Record<PapelUsuario, Set<string>>;
  return (
    <Dialog open onOpenChange={(aberto) => !aberto && onFechar()}>
      <DialogContent className="sm:max-w-[720px] max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Políticas &amp; Perfis</DialogTitle>
          <DialogDescription>O que cada papel enxerga e pode fazer. Atendentes veem só o que é deles; gerentes e master têm a visão da empresa.</DialogDescription>
        </DialogHeader>
        <table className="w-full text-left font-body-sm text-body-sm">
          <thead>
            <tr className="text-text-muted uppercase font-label-sm text-label-sm">
              <th className="py-2">Área do sistema</th>
              {PAPEIS.map((p) => (
                <th key={p} className="py-2 text-center">
                  <span className={`px-2 py-0.5 rounded-full ${COR_DO_PAPEL[p]}`}>{p}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {GRUPOS_MENU.flatMap((g) =>
              g.itens
                .filter((i) => i.id !== 'empresas')
                .map((i) => (
                  <tr key={i.id} className="border-t border-surface-container">
                    <td className="py-1.5 text-text-primary">
                      <span className="text-text-muted">{g.titulo} · </span>
                      {i.rotulo}
                    </td>
                    {PAPEIS.map((p) => (
                      <td key={p} className="py-1.5 text-center">
                        {itensPorPapel[p].has(i.id) ? <span aria-label="Tem acesso" className="material-symbols-outlined text-[18px] text-success-text">check_circle</span> : <span aria-label="Sem acesso" className="text-text-muted">—</span>}
                      </td>
                    ))}
                  </tr>
                ))
            )}
            {CAPACIDADES.map((c) => (
              <tr key={c.rotulo} className="border-t border-surface-container bg-surface-subtle/50">
                <td className="py-1.5 text-text-primary font-semibold">{c.rotulo}</td>
                {PAPEIS.map((p) => (
                  <td key={p} className="py-1.5 text-center text-text-secondary">
                    {c.papeis[p]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="font-body-sm text-body-sm text-text-muted">Só o super admin vê a área de Empresas. Ninguém altera o próprio papel e a empresa sempre mantém ao menos um MASTER ativo.</p>
      </DialogContent>
    </Dialog>
  );
}

export function DialogoDeAuditoria({ onFechar }: { onFechar: () => void }) {
  const [eventos, setEventos] = useState<EventoDeAuditoria[] | null>(null);
  const [erro, setErro] = useState(false);
  useEffect(() => {
    let cancelado = false;
    fetch('/api/equipe/auditoria')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('auditoria'))))
      .then((c: { eventos: EventoDeAuditoria[] }) => !cancelado && setEventos(c.eventos))
      .catch(() => !cancelado && setErro(true));
    return () => {
      cancelado = true;
    };
  }, []);
  return (
    <Dialog open onOpenChange={(aberto) => !aberto && onFechar()}>
      <DialogContent className="sm:max-w-[760px] max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Logs de Auditoria</DialogTitle>
          <DialogDescription>Convites, trocas de papel, desativações e exportações de listas, dos mais recentes aos mais antigos. O registro não pode ser alterado.</DialogDescription>
        </DialogHeader>
        {erro && <p role="alert" className="text-danger-text font-body-md text-body-md">Não foi possível carregar o registro. Tente de novo.</p>}
        {!erro && !eventos && <p className="text-text-secondary font-body-md text-body-md">Carregando...</p>}
        {eventos && eventos.length === 0 && <p className="text-text-secondary font-body-md text-body-md">Nenhum evento registrado ainda. As próximas ações da equipe aparecem aqui.</p>}
        {eventos && eventos.length > 0 && (
          <ol className="flex flex-col divide-y divide-surface-container">
            {eventos.map((e) => (
              <li key={e.id} className="py-2 flex items-start justify-between gap-3">
                <span className="font-body-md text-body-md text-text-primary">
                  <strong>{e.ator ?? 'Alguém que saiu da empresa'}</strong> {ROTULO_DA_ACAO[e.acao].toLowerCase()} <strong>{e.alvo}</strong>
                  {detalheDoEvento(e) && <span className="text-text-secondary"> ({detalheDoEvento(e)})</span>}
                </span>
                <span className="font-body-sm text-body-sm text-text-muted shrink-0">{dataEHora(e.quando)}</span>
              </li>
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** T-322: "Editar acessos" — os módulos liberados de uma pessoa (o papel continua sendo o teto). Salva por `PATCH /api/equipe/:id`. */
export function DialogoDeAcessos({ colaborador, onFechar, onSalvo }: { colaborador: ColaboradorView; onFechar: () => void; onSalvo: (texto: string) => void }) {
  const teto = modulosDoPapel(colaborador.papel);
  const padrao = modulosPadraoDoPapel(colaborador.papel);
  const [marcados, setMarcados] = useState<ModuloId[]>((colaborador.modulos as ModuloId[] | undefined) ?? padrao);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Igual ao padrão do papel = voltar ao padrão (`null`); qualquer outra combinação fica gravada.
  const completo = padrao.length === marcados.filter((id) => teto.includes(id)).length && padrao.every((id) => marcados.includes(id));

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/equipe/${colaborador.usuarioId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ modulos: completo ? null : marcados.filter((id) => teto.includes(id)) }),
      });
      if (!r.ok) {
        const c = (await r.json().catch(() => null)) as { codigo?: string } | null;
        setErro(c?.codigo === 'MODULOS_INVALIDOS' ? 'Libere ao menos um módulo.' : mensagemDeErro(c?.codigo));
        return;
      }
      onSalvo(`Acessos de ${colaborador.nome} atualizados.`);
    } catch {
      setErro(mensagemDeErro(undefined));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && !salvando && onFechar()}>
      <DialogContent className="sm:max-w-[560px] max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Acessos de {colaborador.nome}</DialogTitle>
          <DialogDescription>
            Papel {colaborador.papel}: o máximo que ele alcança. Desmarque o que esta pessoa não deve acessar; a mudança vale no próximo carregamento do sistema.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {MODULOS.map((m) => {
            const alcanca = teto.includes(m.id);
            return (
              <label key={m.id} className={`rounded-xl bg-surface-subtle p-3 flex items-start gap-2 ${alcanca ? 'cursor-pointer' : 'opacity-50'}`}>
                <input type="checkbox" disabled={!alcanca || salvando} checked={alcanca && marcados.includes(m.id)} onChange={() => setMarcados((a) => (a.includes(m.id) ? a.filter((x) => x !== m.id) : [...a, m.id]))} aria-label={m.rotulo} className="mt-0.5 w-4 h-4" />
                <span className="flex flex-col">
                  <span className="font-label-md text-label-md text-text-primary">{m.rotulo}</span>
                  <span className="font-body-sm text-body-sm text-text-muted">{alcanca ? m.descricao : `Exige o papel ${m.papelMinimo}`}</span>
                </span>
              </label>
            );
          })}
        </div>
        {erro && (
          <p role="alert" className="font-body-sm text-body-sm text-danger-text">
            {erro}
          </p>
        )}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <button type="button" onClick={() => setMarcados(teto)} disabled={salvando} className="font-label-md text-label-md text-primary font-semibold hover:underline">
            Liberar tudo do papel
          </button>
          <span className="flex items-center gap-2">
            <Button variant="outline" onClick={onFechar} disabled={salvando}>
              Cancelar
            </Button>
            <Button onClick={() => void salvar()} disabled={salvando || marcados.length === 0}>
              {salvando ? 'Salvando...' : 'Salvar acessos'}
            </Button>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function DialogoDeSessao({ onFechar }: { onFechar: () => void }) {
  const [dados, setDados] = useState<{ sessaoDias: number; ip: string | null } | null>(null);
  useEffect(() => {
    let cancelado = false;
    fetch('/api/equipe/acesso')
      .then((r) => (r.ok ? r.json() : null))
      .then((c: { sessaoDias: number; ip: string | null } | null) => !cancelado && setDados(c))
      .catch(() => undefined);
    return () => {
      cancelado = true;
    };
  }, []);
  return (
    <Dialog open onOpenChange={(aberto) => !aberto && onFechar()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Sessão e acesso</DialogTitle>
          <DialogDescription>Como o acesso ao CRM está configurado hoje.</DialogDescription>
        </DialogHeader>
        <dl className="flex flex-col gap-3">
          <div className="rounded-xl bg-surface-subtle p-3">
            <dt className="font-label-sm text-label-sm text-text-muted uppercase">Duração da sessão</dt>
            <dd className="font-body-md text-body-md text-text-primary">{dados ? `${dados.sessaoDias} dias, depois é preciso entrar de novo` : '...'}</dd>
          </div>
          <div className="rounded-xl bg-surface-subtle p-3">
            <dt className="font-label-sm text-label-sm text-text-muted uppercase">Seu acesso agora</dt>
            <dd className="font-body-md text-body-md text-text-primary">IP {dados ? (dados.ip ?? 'não identificado') : '...'}</dd>
          </div>
          <div className="rounded-xl bg-surface-subtle p-3">
            <dt className="font-label-sm text-label-sm text-text-muted uppercase">Lista de IPs permitidos</dt>
            <dd className="font-body-md text-body-md text-text-primary">Não configurada: qualquer IP com login e senha válidos entra.</dd>
          </div>
        </dl>
        <ItemEmBreve rotulo="Restringir o acesso por lista de IPs" icone="shield" className="self-start h-9 px-3 rounded-lg bg-surface-subtle" />
      </DialogContent>
    </Dialog>
  );
}
