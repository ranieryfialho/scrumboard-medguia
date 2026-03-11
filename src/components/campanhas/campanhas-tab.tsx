"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { MailOpen, Send, Calendar, BarChart3, CheckCircle2, Clock, Trash2, MousePointerClick, Edit3, Settings } from "lucide-react"
import { NovaCampanhaModal } from "./nova-campanha-modal"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CampanhaDetalhes } from "./campanha-detalhes"

interface CampanhasTabProps {
  leads: any[];
  campanhas: any[];
  onRefresh: () => void;
  onDelete?: (id: string) => Promise<void>;
}

export function CampanhasTab({ leads, campanhas, onRefresh, onDelete }: CampanhasTabProps) {
  // Novo estado que guarda se estamos vendo uma campanha específica
  const [campanhaSelecionada, setCampanhaSelecionada] = useState<any | null>(null);
  
  const handleExcluir = async (id: string) => {
    if (confirm("Tem certeza que deseja excluir esta campanha? Os dados de envio também serão apagados.")) {
      if (onDelete) await onDelete(id);
    }
  };

  const getStatusBadge = (status: string) => {
    switch(status) {
      case 'RASCUNHO': return <Badge variant="outline" className="bg-slate-100 text-slate-600 border-slate-200 font-medium flex items-center w-fit gap-1"><Edit3 className="w-3 h-3"/> Rascunho</Badge>;
      case 'PROCESSANDO': return <Badge variant="outline" className="bg-indigo-50 text-indigo-600 border-indigo-200 font-medium flex items-center w-fit gap-1"><Settings className="w-3 h-3 animate-spin"/> Em Andamento</Badge>;
      case 'PENDENTE': return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 font-medium flex items-center w-fit gap-1"><Clock className="w-3 h-3"/> Aguardando</Badge>;
      default: return <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 font-medium flex items-center w-fit gap-1"><CheckCircle2 className="w-3 h-3"/> Finalizada</Badge>;
    }
  };

  // Se houver uma campanha selecionada, mostra a tela de detalhes
  if (campanhaSelecionada) {
    return (
      <div className="p-8 pt-6">
        <CampanhaDetalhes 
          campanha={campanhaSelecionada} 
          onBack={() => setCampanhaSelecionada(null)} 
          onRefresh={onRefresh} 
        />
      </div>
    );
  }

  // Se não houver, mostra a tela de lista normal
  return (
    <div className="flex-1 space-y-6 p-8 pt-6 animate-in fade-in slide-in-from-left-4 duration-500">
      <div className="flex items-center justify-between space-y-2">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-slate-800">Mala Direta</h2>
          <p className="text-muted-foreground text-sm">Gerencie disparos de e-mail e acompanhe o engajamento.</p>
        </div>
        <div className="flex items-center space-x-2">
          <NovaCampanhaModal leads={leads} onSuccess={onRefresh} />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="shadow-sm border-slate-200">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Campanhas</CardTitle>
            <Send className="h-4 w-4 text-slate-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{campanhas.length}</div>
            <p className="text-xs text-muted-foreground">Total criadas até agora</p>
          </CardContent>
        </Card>
      </div>

      <Card className="col-span-4 shadow-sm border-slate-200 overflow-hidden">
        <CardHeader className="bg-white border-b border-slate-100">
          <CardTitle className="text-lg">Campanhas Recentes</CardTitle>
          <CardDescription>Lista de disparos agendados e realizados.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {campanhas.length === 0 ? (
            <div className="flex h-[350px] items-center justify-center bg-slate-50/30">
              <div className="mx-auto flex max-w-[420px] flex-col items-center justify-center text-center">
                <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-4">
                  <MailOpen className="h-6 w-6 text-slate-400" />
                </div>
                <h3 className="text-lg font-semibold text-slate-800">Nenhuma campanha encontrada</h3>
                <p className="mb-6 mt-2 text-sm text-slate-500">
                  Comece agora criando sua primeira campanha para se comunicar com seus leads.
                </p>
                <NovaCampanhaModal leads={leads} onSuccess={onRefresh} />
              </div>
            </div>
          ) : (
            <div className="relative w-full overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 text-left">
                    <th className="h-12 px-6 font-medium">Nome / Assunto</th>
                    <th className="h-12 px-6 font-medium">Status</th>
                    <th className="h-12 px-6 font-medium">Criação</th>
                    <th className="h-12 px-6 text-right font-medium pr-8">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {campanhas.map((camp) => (
                    <tr key={camp.id} className="hover:bg-slate-50/50 transition-colors group">
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="font-semibold text-slate-700">{camp.nome}</span>
                          <span className="text-xs text-slate-400 truncate max-w-[300px]">{camp.assunto}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {getStatusBadge(camp.status)}
                      </td>
                      <td className="px-6 py-4 text-slate-500">
                        <div className="flex items-center gap-2">
                          <Calendar className="w-3.5 h-3.5 text-slate-400" />
                          {new Date(camp.criado_em).toLocaleDateString('pt-BR')}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right pr-8 flex items-center justify-end gap-1">
                        
                        {/* Botão que seleciona a campanha para ver os detalhes */}
                        <button 
                          onClick={() => setCampanhaSelecionada(camp)}
                          className="inline-flex items-center gap-1.5 text-indigo-600 hover:text-indigo-800 font-semibold transition-colors mr-2 bg-indigo-50 px-3 py-1.5 rounded-md"
                        >
                          {camp.status === 'RASCUNHO' ? <Edit3 className="w-4 h-4" /> : <BarChart3 className="w-4 h-4" />}
                          {camp.status === 'RASCUNHO' ? 'Ver e Iniciar' : 'Ver Relatório'}
                        </button>
                        
                        <NovaCampanhaModal leads={leads} onSuccess={onRefresh} campanhaExistente={camp} />
                        
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-slate-400 hover:text-red-600"
                          onClick={() => handleExcluir(camp.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}