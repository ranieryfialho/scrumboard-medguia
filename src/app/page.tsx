"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function Home() {
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Agora vamos fazer os dados carregarem automaticamente quando a página abrir!
  useEffect(() => {
    buscarLeads();
  }, []);

  const buscarLeads = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/sheets');
      const data = await res.json();
      setLeads(data);
    } catch (error) {
      console.error("Erro ao buscar planilha:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen p-8 bg-slate-50">
      <div className="max-w-4xl mx-auto space-y-6">
        
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Scrumboard Medguia</h1>
          <Button onClick={buscarLeads} disabled={loading}>
            {loading ? 'Atualizando...' : 'Atualizar Dados'}
          </Button>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-sm border space-y-4">
          {loading ? (
            <p className="text-slate-500 text-center py-4">Carregando leads da planilha...</p>
          ) : leads.length > 0 ? (
            <div className="mt-4 p-4 bg-slate-900 rounded-md overflow-x-auto">
              <p className="text-emerald-400 font-medium mb-2">Sucesso! {leads.length} leads encontrados:</p>
              <pre className="text-xs text-slate-300">
                {JSON.stringify(leads, null, 2)}
              </pre>
            </div>
          ) : (
            <p className="text-slate-500 text-center py-4">Nenhum lead encontrado ou erro na conexão.</p>
          )}
        </div>

      </div>
    </main>
  );
}