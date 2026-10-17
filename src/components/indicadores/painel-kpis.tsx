"use client";

// T-103 (fase2d-kpis, US-063): painel de indicadores — consome GET
// /api/relatorios/kpis (T-102) e renderiza um cartão por indicador (AC-232).
// Os filtros de período e responsável (AC-233) recarregam a mesma rota;
// falha de rede mostra erro com "Tentar de novo" sem apagar `kpis` (os
// números anteriores continuam na tela). Quem pode chegar até esta tela já
// foi decidido pelo menu (src/components/layout/sidebar.tsx) e pela própria
// rota (403/401) — este componente não repete a checagem de papel.
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Indicador {
  valor: number | null;
  numerador: number;
  denominador: number;
}

interface RespostaKpis {
  conexao: Indicador;
  cumprimentoCadencia: Indicador;
  agendamento: Indicador;
  noShow: Indicador;
  proposta: Indicador;
  ativacaoTrial: Indicador;
  conversao: Indicador;
}

interface Filtro {
  de: string;
  ate: string;
  responsavelId: string;
}

const FILTRO_VAZIO: Filtro = { de: "", ate: "", responsavelId: "" };

/** AC-232: nome por extenso de cada indicador do PRD-001 §6, na ordem da resposta. */
const INDICADORES: { chave: keyof RespostaKpis; titulo: string }[] = [
  { chave: "conexao", titulo: "Taxa de conexão" },
  { chave: "cumprimentoCadencia", titulo: "Cumprimento da régua de 18 toques" },
  { chave: "agendamento", titulo: "Taxa de agendamento" },
  { chave: "noShow", titulo: "Taxa de no-show" },
  { chave: "proposta", titulo: "Taxa de proposta" },
  { chave: "ativacaoTrial", titulo: "Ativação no trial" },
  { chave: "conversao", titulo: "Taxa de conversão" },
];

/** AC-226/AC-227: só manda `de`/`ate`/`responsavelId` quando preenchidos — vazio é "use o padrão da rota" (mês corrente). */
function montarUrl(filtro: Filtro): string {
  const params = new URLSearchParams();
  if (filtro.de) params.set("de", filtro.de);
  if (filtro.ate) params.set("ate", filtro.ate);
  if (filtro.responsavelId) params.set("responsavelId", filtro.responsavelId);
  const query = params.toString();
  return query ? `/api/relatorios/kpis?${query}` : "/api/relatorios/kpis";
}

export function PainelKpis() {
  const [filtro, setFiltro] = useState<Filtro>(FILTRO_VAZIO);
  const [kpis, setKpis] = useState<RespostaKpis | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async (filtroAtual: Filtro) => {
    setCarregando(true);
    setErro(null);
    try {
      const resposta = await fetch(montarUrl(filtroAtual));
      if (!resposta.ok) throw new Error(`kpis respondeu ${resposta.status}`);
      const corpo = (await resposta.json()) as RespostaKpis;
      setKpis(corpo);
    } catch {
      // AC-233: `kpis` não é tocado aqui — os números anteriores continuam visíveis.
      setErro("Não foi possível carregar os indicadores. Tente de novo.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregar(filtro);
  }, [filtro, carregar]);

  return (
    <div className="flex flex-col gap-6">
      <FiltrosKpis filtro={filtro} onAplicar={setFiltro} />

      {carregando && <p className="text-sm text-slate-500">Carregando indicadores...</p>}

      {erro && (
        <div className="flex items-center gap-3 text-sm text-rose-600">
          <span>{erro}</span>
          <Button variant="outline" size="sm" onClick={() => carregar(filtro)}>
            Tentar de novo
          </Button>
        </div>
      )}

      {kpis && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {INDICADORES.map(({ chave, titulo }) => (
            <CartaoIndicador key={chave} titulo={titulo} indicador={kpis[chave]} />
          ))}
        </div>
      )}
    </div>
  );
}

function CartaoIndicador({ titulo, indicador }: { titulo: string; indicador: Indicador }) {
  // AC-224/AC-232: denominador zero (`valor: null`) nunca vira 0% — mostra "—" e o aviso.
  const semDados = indicador.valor === null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-slate-600">{titulo}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-bold text-slate-900">
          {semDados ? "—" : `${Math.round((indicador.valor as number) * 100)}%`}
        </p>
        <p className="text-xs text-slate-500 mt-1">
          {semDados ? "sem dados no período" : `${indicador.numerador} de ${indicador.denominador}`}
        </p>
      </CardContent>
    </Card>
  );
}

interface FiltrosProps {
  filtro: Filtro;
  onAplicar: (filtro: Filtro) => void;
}

/**
 * AC-233: as datas recarregam a cada seleção (o `<input type="date">` só
 * dispara `onChange` com uma data completa). O responsável é texto livre (o
 * backend não tem hoje uma lista de responsáveis por tenant para popular um
 * select) — recarrega ao sair do campo ou teclar Enter, não a cada tecla.
 */
function FiltrosKpis({ filtro, onAplicar }: FiltrosProps) {
  const [responsavelId, setResponsavelId] = useState(filtro.responsavelId);

  function commitResponsavel() {
    onAplicar({ ...filtro, responsavelId });
  }

  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="flex flex-col gap-1">
        <Label htmlFor="kpis-de">Data inicial</Label>
        <Input
          id="kpis-de"
          type="date"
          value={filtro.de}
          onChange={(evento) => onAplicar({ ...filtro, de: evento.target.value })}
          className="w-40"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="kpis-ate">Data final</Label>
        <Input
          id="kpis-ate"
          type="date"
          value={filtro.ate}
          onChange={(evento) => onAplicar({ ...filtro, ate: evento.target.value })}
          className="w-40"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="kpis-responsavel">Responsável (ID)</Label>
        <Input
          id="kpis-responsavel"
          type="text"
          placeholder="UUID do responsável"
          value={responsavelId}
          onChange={(evento) => setResponsavelId(evento.target.value)}
          onBlur={commitResponsavel}
          onKeyDown={(evento) => {
            if (evento.key === "Enter") evento.currentTarget.blur();
          }}
          className="w-64"
        />
      </div>
    </div>
  );
}
