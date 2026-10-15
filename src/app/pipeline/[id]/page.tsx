"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BotaoIniciarCadencia } from "@/components/pipeline/botao-iniciar-cadencia";

interface DetalheOportunidade {
  id: string;
  etapaId: number;
  leadNome: string;
  responsavelNome: string | null;
  valor: string | null;
  motivoPerdaNome: string | null;
  proximaAcaoEm: string | null;
  version: number;
}

function formatarValor(valor: string | null): string | null {
  if (!valor) return null;
  const numero = Number(valor);
  if (Number.isNaN(numero)) return null;
  return numero.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatarData(data: string | null): string | null {
  if (!data) return null;
  return new Date(data).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

/** AC-092/AC-093: consome a rota de detalhe; 404 (card de outro tenant, ou inexistente) mostra "não encontrado", nunca vaza qual dos dois é o caso. */
export default function DetalheOportunidadePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [dados, setDados] = useState<DetalheOportunidade | null>(null);
  const [naoEncontrado, setNaoEncontrado] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [cadenciaIniciada, setCadenciaIniciada] = useState(false);
  const [erroCadencia, setErroCadencia] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    fetch(`/api/oportunidades/${id}`)
      .then(async (resposta) => {
        if (cancelado) return;
        if (resposta.status === 404) {
          setNaoEncontrado(true);
          return;
        }
        if (!resposta.ok) throw new Error(`detalhe respondeu ${resposta.status}`);
        setDados(await resposta.json());
      })
      .catch(() => !cancelado && setNaoEncontrado(true))
      .finally(() => !cancelado && setCarregando(false));
    return () => {
      cancelado = true;
    };
  }, [id]);

  // AC-216: em erro, recarrega o card (etapa/version atuais) antes de deixar
  // o operador tentar de novo.
  const recarregarCard = async () => {
    try {
      const resposta = await fetch(`/api/oportunidades/${id}`);
      if (resposta.status === 404) {
        setNaoEncontrado(true);
        return;
      }
      if (!resposta.ok) return;
      setDados(await resposta.json());
    } catch {
      // Sem conectividade: mantém os dados locais, a mensagem de erro já foi mostrada.
    }
  };

  return (
    <main className="p-4 max-w-lg mx-auto">
      <Link href="/pipeline" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4">
        <ArrowLeft className="size-4" />
        Voltar pro board
      </Link>

      {carregando && <p className="text-sm text-slate-500">Carregando…</p>}

      {!carregando && naoEncontrado && (
        <Card>
          <CardContent className="pt-6 text-sm text-slate-600">Oportunidade não encontrada.</CardContent>
        </Card>
      )}

      {!carregando && dados && (
        <Card>
          <CardHeader>
            <CardTitle>{dados.leadNome}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <span className="text-slate-500">Responsável: </span>
              {dados.responsavelNome ?? "Sem responsável"}
            </p>
            <p>
              <span className="text-slate-500">Etapa: </span>
              {dados.etapaId}
            </p>
            <p>
              <span className="text-slate-500">Valor: </span>
              {formatarValor(dados.valor) ?? "—"}
            </p>
            <p>
              <span className="text-slate-500">Motivo de perda: </span>
              {dados.motivoPerdaNome ?? "—"}
            </p>
            <p>
              <span className="text-slate-500">Próxima ação: </span>
              {formatarData(dados.proximaAcaoEm) ?? "—"}
            </p>

            <BotaoIniciarCadencia
              oportunidadeId={dados.id}
              etapaId={dados.etapaId}
              version={dados.version}
              onIniciado={(resultado) => {
                setDados({ ...dados, etapaId: resultado.etapaId, version: resultado.version });
                setCadenciaIniciada(true);
                setErroCadencia(null);
              }}
              onErro={(mensagem) => {
                setErroCadencia(mensagem);
                void recarregarCard();
              }}
            />
            {cadenciaIniciada && (
              <p className="text-sm text-emerald-700">
                Cadência iniciada — os 3 primeiros toques estão em Minhas tarefas.
              </p>
            )}
            {erroCadencia && <p className="text-sm text-rose-600">{erroCadencia}</p>}
          </CardContent>
        </Card>
      )}
    </main>
  );
}
