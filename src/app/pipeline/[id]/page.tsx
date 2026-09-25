"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
          </CardContent>
        </Card>
      )}
    </main>
  );
}
