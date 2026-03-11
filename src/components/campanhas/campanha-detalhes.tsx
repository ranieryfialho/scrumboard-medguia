"use client";

import { useState, useEffect, useCallback } from "react";
import { ArrowLeft, Users, MailOpen, MousePointerClick, Send, AlertCircle, Clock, Calendar, Eye, CheckCircle2, XCircle, Play, Loader2, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";

interface CampanhaDetalhesProps {
  campanha: any;
  onBack: () => void;
  onRefresh: () => void;
}

export function CampanhaDetalhes({ campanha, onBack, onRefresh }: CampanhaDetalhesProps) {
  const [destinatarios, setDestinatarios] = useState<any[]>([]);
  const [loading, setLoading] = useState(true); // Começa true para o loading da 1ª vez
  const [isStarting, setIsStarting] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [isRefreshingLocal, setIsRefreshingLocal] = useState(false); 
  
  const supabase = createClient();

  // A MÁGICA DOS 3 MODOS ESTÁ AQUI
  const fetchDestinatarios = useCallback(async (tipoBusca: 'inicial' | 'silenciosa' | 'manual' = 'inicial') => {
    if (tipoBusca === 'manual') setIsRefreshingLocal(true);
    // Nota: Nunca damos setLoading(true) de novo para não piscar a tabela!
    
    try {
      const { data, error } = await supabase
        .from('envios_campanha')
        .select('*')
        .eq('campanha_id', campanha.id)
        .order('nome_destinatario', { ascending: true });

      if (error) throw error;
      setDestinatarios(data || []);
    } catch (error) {
      console.error("Erro ao buscar destinatários:", error);
    } finally {
      setLoading(false); // Desliga o loading grande (se for a busca inicial)
      setIsRefreshingLocal(false); // Desliga a rodinha do botão (se for manual)
    }
  }, [campanha.id, supabase]);

  // Busca inicial (Ao abrir a tela)
  useEffect(() => {
    fetchDestinatarios('inicial');
  }, [fetchDestinatarios]);

  // Busca silenciosa (A cada 5 segundos)
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (campanha.status === 'PROCESSANDO') {
      interval = setInterval(() => {
        fetchDestinatarios('silenciosa');
      }, 5000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [campanha.status, fetchDestinatarios]);

  const handlePlay = async () => {
    if(!confirm("Deseja iniciar os disparos em massa agora? O motor começará a enviar e-mails para todos na lista.")) return;
    setIsStarting(true);
    try {
      await supabase.from('campanhas').update({status: 'PROCESSANDO'}).eq('id', campanha.id);
      await supabase.from('envios_campanha').update({status: 'PENDENTE'}).eq('campanha_id', campanha.id).eq('status', 'RASCUNHO');
      
      campanha.status = 'PROCESSANDO';
      onRefresh(); 
      fetchDestinatarios('silenciosa'); // Atualiza a tela discretamente
      
      alert("Sucesso! Os envios foram liberados para a fila. O seu motor em Python já pode assumir.");
    } catch (e) {
      console.error(e);
      alert("Erro ao iniciar a campanha.");
    } finally {
      setIsStarting(false);
    }
  };

  const total = destinatarios.length;
  const pendentes = destinatarios.filter(d => ['PENDENTE', 'RASCUNHO'].includes(d.status)).length;
  const enviados = destinatarios.filter(d => ['ENVIADO', 'ABERTO', 'CLICADO'].includes(d.status)).length;
  const abertos = destinatarios.filter(d => ['ABERTO', 'CLICADO'].includes(d.status)).length;
  const clicados = destinatarios.filter(d => d.status === 'CLICADO').length;
  const erros = destinatarios.filter(d => d.status === 'ERRO').length;

  const taxaAbertura = enviados > 0 ? ((abertos / enviados) * 100).toFixed(1) : "0.0";
  const taxaClique = enviados > 0 ? ((clicados / enviados) * 100).toFixed(1) : "0.0";

  const getBadgeVisual = (status: string) => {
    switch (status) {
      case 'RASCUNHO': return 'bg-slate-100 text-slate-500 border-slate-200';
      case 'PENDENTE': return 'bg-amber-50 text-amber-600 border-amber-200';
      case 'ENVIADO': return 'bg-blue-50 text-blue-600 border-blue-200';
      case 'ABERTO': return 'bg-emerald-50 text-emerald-600 border-emerald-200';
      case 'CLICADO': return 'bg-purple-50 text-purple-600 border-purple-200';
      case 'ERRO': return 'bg-red-50 text-red-600 border-red-200';
      default: return 'bg-slate-50 text-slate-500';
    }
  };

  const getStatusDisplay = (status: string) => {
    switch (status) {
      case 'RASCUNHO': return { text: 'Em Espera', color: 'bg-slate-100 text-slate-500 border-slate-200', icon: Clock };
      case 'PENDENTE': return { text: 'Na Fila de Envio', color: 'bg-amber-50 text-amber-600 border-amber-200', icon: Clock };
      case 'ENVIADO': return { text: 'Entregue', color: 'bg-blue-50 text-blue-600 border-blue-200', icon: CheckCircle2 };
      case 'ABERTO': return { text: 'E-mail Aberto', color: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: Eye };
      case 'CLICADO': return { text: 'Clicou no Link', color: 'bg-purple-50 text-purple-700 border-purple-200', icon: MousePointerClick };
      case 'ERRO': return { text: 'Falha no Envio', color: 'bg-red-50 text-red-600 border-red-200', icon: XCircle };
      default: return { text: status, color: 'bg-slate-50 text-slate-500', icon: AlertCircle };
    }
  };

  return (
    <div className="flex-1 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 ease-out">
      
      <div className="flex items-start justify-between gap-4 shrink-0">
        <div className="flex items-start gap-4">
          <Button variant="outline" size="icon" onClick={onBack} className="mt-1 shrink-0 bg-white hover:bg-slate-100 transition-colors shadow-sm">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-3xl font-bold tracking-tight text-slate-800">{campanha.nome}</h2>
              
              <Button variant="secondary" size="sm" onClick={() => setShowPreview(true)} className="bg-slate-100 hover:bg-slate-200 text-slate-700 h-8 mt-1">
                <Eye className="w-4 h-4 mr-2" /> Ver E-mail
              </Button>
              
              {/* O Botão de Atualizar continua funcionando para quando a pessoa quiser forçar */}
              <Button variant="outline" size="sm" onClick={() => fetchDestinatarios('manual')} disabled={isRefreshingLocal} className="h-8 mt-1 bg-white hover:bg-slate-50 shadow-sm border-slate-200 text-slate-600">
                <RefreshCw className={`w-3.5 h-3.5 mr-2 ${isRefreshingLocal ? 'animate-spin' : ''}`} /> Atualizar
              </Button>

            </div>
            <div className="flex items-center gap-3 text-sm text-slate-500 mt-2 font-medium">
              <span className="flex items-center gap-1.5"><Calendar className="w-4 h-4" /> {new Date(campanha.criado_em).toLocaleDateString('pt-BR')}</span>
              <span>•</span>
              <span className="flex items-center gap-1.5 text-indigo-600"><MailOpen className="w-4 h-4" /> Assunto: {campanha.assunto}</span>
            </div>
          </div>
        </div>

        {campanha.status === 'RASCUNHO' && (
          <Button onClick={handlePlay} disabled={isStarting} className="bg-emerald-500 hover:bg-emerald-600 text-white shadow-md px-6 py-6 text-base font-bold transition-all shrink-0">
            {isStarting ? <Loader2 className="w-5 h-5 mr-2 animate-spin"/> : <Play className="w-5 h-5 mr-2 fill-current" />}
            Iniciar Disparos
          </Button>
        )}
      </div>

      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="sm:max-w-[700px] h-[85vh] flex flex-col p-0 overflow-hidden bg-slate-50">
          <DialogHeader className="px-6 py-4 border-b border-slate-200 bg-white shrink-0">
            <DialogTitle className="text-xl flex items-center gap-2">
              <Eye className="w-5 h-5 text-indigo-600" /> Pré-visualização do E-mail
            </DialogTitle>
            <p className="text-sm text-slate-500 font-medium pt-1">Assunto: <span className="text-slate-900">{campanha.assunto}</span></p>
          </DialogHeader>
          <div className="flex-1 overflow-hidden p-6">
            <div className="w-full h-full bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden flex flex-col">
              <div className="h-8 bg-slate-100 border-b border-slate-200 flex items-center px-4 gap-1.5 shrink-0">
                <div className="w-2.5 h-2.5 rounded-full bg-slate-300"></div>
                <div className="w-2.5 h-2.5 rounded-full bg-slate-300"></div>
                <div className="w-2.5 h-2.5 rounded-full bg-slate-300"></div>
              </div>
              <iframe 
                srcDoc={campanha.corpo_html} 
                className="w-full flex-1 border-0" 
                title="Preview do E-mail Final" 
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 shrink-0">
        <Card className="shadow-sm border-slate-200">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">Total na Fila</CardTitle>
            <Users className="h-4 w-4 text-slate-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{total}</div>
            <p className="text-xs text-slate-500 mt-1">{pendentes} aguardando</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm border-slate-200">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-blue-700">Disparos Efetuados</CardTitle>
            <Send className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-700">{enviados}</div>
            <p className="text-xs text-slate-500 mt-1">{erros} falhas/erros</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm border-slate-200">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-emerald-700">Aberturas</CardTitle>
            <MailOpen className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-700">{abertos}</div>
            <p className="text-xs text-slate-500 mt-1">Taxa: <span className="font-semibold text-emerald-600">{taxaAbertura}%</span></p>
          </CardContent>
        </Card>
        <Card className="shadow-sm border-slate-200">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-purple-700">Cliques</CardTitle>
            <MousePointerClick className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-700">{clicados}</div>
            <p className="text-xs text-slate-500 mt-1">Taxa: <span className="font-semibold text-purple-600">{taxaClique}%</span></p>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm border-slate-200 overflow-hidden">
        <CardHeader className="bg-white border-b border-slate-100 shrink-0">
          <CardTitle className="text-lg">Destinatários da Campanha</CardTitle>
          <CardDescription>Acompanhe o engajamento individual de cada lead.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="h-48 flex items-center justify-center text-slate-400">
              <Clock className="w-5 h-5 animate-spin mr-2" /> Carregando lista...
            </div>
          ) : destinatarios.length === 0 ? (
            <div className="h-48 flex flex-col items-center justify-center text-slate-400">
              <AlertCircle className="w-8 h-8 mb-2 opacity-50" />
              <p>Nenhum destinatário encontrado nesta campanha.</p>
            </div>
          ) : (
            <div className="h-[calc(100vh-380px)] min-h-[300px] overflow-auto">
              <table className="w-full text-sm text-left relative">
                <thead className="bg-slate-50 sticky top-0 border-b border-slate-200 shadow-sm z-10">
                  <tr className="text-slate-500 font-medium">
                    <th className="px-6 py-4">Nome</th>
                    <th className="px-6 py-4">E-mail</th>
                    <th className="px-6 py-4">Status Geral</th>
                    <th className="px-6 py-4">Status de Engajamento</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {destinatarios.map((dest) => {
                    const statusObj = getStatusDisplay(dest.status);
                    const StatusIcon = statusObj.icon;
                    return (
                      <tr key={dest.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-6 py-4 font-semibold text-slate-700">{dest.nome_destinatario}</td>
                        <td className="px-6 py-4 text-slate-500">{dest.email_destinatario}</td>
                        <td className="px-6 py-4">
                          <Badge variant="outline" className={`font-medium ${getBadgeVisual(dest.status)}`}>
                            {dest.status}
                          </Badge>
                        </td>
                        <td className="px-6 py-4">
                          <Badge variant="outline" className={`flex items-center w-fit gap-1.5 px-3 py-1 font-medium ${statusObj.color}`}>
                            <StatusIcon className="w-3.5 h-3.5" />
                            {statusObj.text}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}