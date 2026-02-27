"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, TrendingUp, CheckCircle2, Clock, ChevronLeft, ChevronRight, Plus, Trash2, Loader2 } from "lucide-react";
import { Calendar, CalendarDayButton } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { ptBR } from "date-fns/locale";
import { addMonths, subMonths, format } from "date-fns";
import { cn } from "@/lib/utils";

interface DashboardTabProps {
  kpis: any;
  date: Date | undefined;
  setDate: (d: Date | undefined) => void;
  calendarMonth: Date;
  setCalendarMonth: (d: Date) => void;
  dadosGrafico: any[];
  setFiltroEspecialidade: (v: string) => void;
  setAbaAtiva: (v: string) => void;
}

interface AgendaEvent {
  id: string;
  date: string; 
  title: string;
  time: string;
  type: string;
}

export function DashboardTab({ 
  kpis, 
  date, setDate, 
  calendarMonth, setCalendarMonth, 
  dadosGrafico,
  setFiltroEspecialidade,
  setAbaAtiva
}: DashboardTabProps) {
  const mesFormatado = format(calendarMonth, "MMMM yyyy", { locale: ptBR });
  const mesCapitalizado = mesFormatado.charAt(0).toUpperCase() + mesFormatado.slice(1);

  // Estados da Agenda
  const [eventosAgenda, setEventosAgenda] = useState<AgendaEvent[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [novoEventoTitulo, setNovoEventoTitulo] = useState("");
  const [novoEventoHora, setNovoEventoHora] = useState("");
  const [isLoadingAgenda, setIsLoadingAgenda] = useState(false);

  // 1. CARREGAR DADOS AO MONTAR O COMPONENTE
  useEffect(() => {
    async function fetchAgenda() {
      try {
        const res = await fetch('/api/agenda');
        if (res.ok) {
          const data = await res.json();
          setEventosAgenda(data);
        }
      } catch (error) {
        console.error("Erro ao carregar agenda:", error);
      }
    }
    fetchAgenda();
  }, []);

  const handleDaySelect = (d: Date | undefined) => {
    if (d) {
      setDate(d);
      setIsModalOpen(true);
    } else if (date) {
      setIsModalOpen(true);
    }
  };

  // 2. SALVAR NOVO EVENTO NO GOOGLE SHEETS
  const handleAddEvent = async () => {
    if (!date || !novoEventoTitulo) return;
    setIsLoadingAgenda(true);
    
    const dateStr = format(date, "yyyy-MM-dd");
    const novoEvento: AgendaEvent = {
      id: Math.random().toString(36).substring(2, 15),
      date: dateStr,
      title: novoEventoTitulo,
      time: novoEventoHora,
      type: 'reuniao'
    };

    // Atualização otimista na tela
    setEventosAgenda(prev => [...prev, novoEvento]);
    setNovoEventoTitulo("");
    setNovoEventoHora("");

    // Chamada para a API
    try {
      await fetch('/api/agenda', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', evento: novoEvento })
      });
    } catch (error) {
      console.error("Erro ao salvar evento:", error);
    } finally {
      setIsLoadingAgenda(false);
    }
  };

  // 3. EXCLUIR EVENTO DO GOOGLE SHEETS
  const handleDeleteEvent = async (idParaDeletar: string) => {
    // Atualização otimista na tela
    setEventosAgenda(prev => prev.filter(e => e.id !== idParaDeletar));

    try {
      await fetch('/api/agenda', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', id: idParaDeletar })
      });
    } catch (error) {
      console.error("Erro ao deletar evento:", error);
    }
  };

  const eventosDoDiaSelecionado = date 
    ? eventosAgenda.filter(e => e.date === format(date, "yyyy-MM-dd"))
    : [];

  return (
    <div className="max-w-[1600px] mx-auto space-y-8">
      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">Total Ativos</CardTitle>
            <Users className="h-4 w-4 text-indigo-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-slate-900">{kpis.total}</div>
            <p className="text-xs text-slate-500 mt-1">Leads na base atual</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">Novos Leads</CardTitle>
            <Clock className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-slate-900">{kpis.novos}</div>
            <p className="text-xs text-slate-500 mt-1">Aguardando primeiro contato</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">Em Negociação</CardTitle>
            <TrendingUp className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-slate-900">{kpis.emAndamento}</div>
            <p className="text-xs text-slate-500 mt-1">Em contato ou reunião</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">Fechados</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-slate-900">{kpis.fechados}</div>
            <p className="text-xs text-emerald-600 font-medium mt-1">{kpis.taxaConversao}% de conversão</p>
          </CardContent>
        </Card>
      </div>

      {/* Calendário e Gráfico */}
      <div className="flex gap-6 items-stretch">

        {/* Calendário */}
        <div className="w-[280px] shrink-0">
          <Card className="h-full">
            <CardHeader className="pb-2 pt-4 px-4 border-b border-slate-100">
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setCalendarMonth(subMonths(calendarMonth, 1))}
                  className="h-6 w-6 flex items-center justify-center rounded-md hover:bg-slate-100 transition-colors text-slate-600"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <div className="flex flex-col items-center gap-0.5">
                  <CardTitle className="text-sm">Calendário</CardTitle>
                  <span className="text-xs text-slate-500">{mesCapitalizado}</span>
                </div>
                <button
                  onClick={() => setCalendarMonth(addMonths(calendarMonth, 1))}
                  className="h-6 w-6 flex items-center justify-center rounded-md hover:bg-slate-100 transition-colors text-slate-600"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </CardHeader>
            <CardContent className="p-3">
              <Calendar
                mode="single"
                selected={date}
                onSelect={handleDaySelect}
                month={calendarMonth}
                onMonthChange={setCalendarMonth}
                locale={ptBR}
                className="w-full p-0"
                classNames={{
                  months: "w-full",
                  month: "w-full space-y-1",
                  caption: "!hidden !h-0 !overflow-hidden !p-0 !m-0 !border-0",
                  nav: "!hidden",
                  nav_button: "!hidden",
                  nav_button_previous: "!hidden",
                  nav_button_next: "!hidden",
                  caption_label: "!hidden",
                  table: "w-full border-collapse",
                  head_row: "flex w-full justify-between mb-1",
                  head_cell: "w-8 text-center text-slate-500 font-medium text-[0.65rem] uppercase py-1",
                  row: "flex w-full justify-between mt-1",
                  cell: "w-8 h-8 p-0 flex items-center justify-center relative",
                  day: "h-8 w-8 flex items-center justify-center font-normal text-slate-700 hover:bg-slate-100 rounded-md transition-colors text-xs relative",
                  day_selected: "bg-indigo-600 text-white hover:bg-indigo-700 hover:text-white font-bold",
                  day_today: "bg-slate-200 text-slate-900 font-semibold",
                  day_outside: "text-slate-300",
                }}
                components={{
                  DayButton: (buttonProps) => {
                    const dateStr = format(buttonProps.day.date, "yyyy-MM-dd");
                    const eventosDoDia = eventosAgenda.filter(e => e.date === dateStr);
                    const quantidadeEventos = eventosDoDia.length;

                    return (
                      <CalendarDayButton {...buttonProps}>
                        {buttonProps.children}
                        {quantidadeEventos > 0 && (
                          <div className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-[9px] font-extrabold text-white shadow-md ring-1 ring-white opacity-100">
                            {quantidadeEventos > 9 ? '9+' : quantidadeEventos}
                          </div>
                        )}
                      </CalendarDayButton>
                    );
                  }
                }}
              />
            </CardContent>
          </Card>
        </div>

        {/* Gráfico */}
        <div className="flex-1 min-w-0">
          <Card className="h-full">
            <CardHeader className="border-b border-slate-100">
              <CardTitle className="text-lg">Top Especialidades Cadastradas</CardTitle>
            </CardHeader>
            <CardContent className="p-6 h-[320px]">
              {dadosGrafico.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dadosGrafico} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} dy={10} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} allowDecimals={false} />
                    <Tooltip
                      cursor={{ fill: '#f1f5f9' }}
                      contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                      labelStyle={{ color: '#0f172a', fontWeight: 'bold', marginBottom: '4px' }}
                    />
                    <Bar
                      dataKey="total"
                      radius={[4, 4, 0, 0]}
                      cursor="pointer"
                      onClick={(data) => {
                        if (data && data.name) {
                          setFiltroEspecialidade(data.name);
                          setAbaAtiva("kanban");
                        }
                      }}
                    >
                      {dadosGrafico.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={index === 0 ? '#4f46e5' : '#818cf8'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-slate-400">
                  Nenhum dado suficiente para gerar o gráfico.
                </div>
              )}
            </CardContent>
          </Card>
        </div>

      </div>

      {/* Modal da Agenda (Dialog) */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>
              Agenda - {date ? format(date, "dd 'de' MMMM", { locale: ptBR }) : ''}
            </DialogTitle>
          </DialogHeader>
          
          <div className="py-4">
            {/* Lista de eventos do dia */}
            <div className="space-y-3 mb-6 max-h-[240px] overflow-y-auto pr-2 pb-1">
              {eventosDoDiaSelecionado.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-4">Nenhum evento programado para este dia.</p>
              ) : (
                eventosDoDiaSelecionado.map(evento => (
                  <div key={evento.id} className="flex justify-between items-start p-3 rounded-md bg-slate-50 border border-slate-100 gap-3">
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-sm font-medium text-slate-900 break-words">
                        {evento.title}
                      </span>
                      {evento.time && (
                        <span className="text-xs font-semibold text-slate-600 mt-1 whitespace-nowrap">
                          {evento.time}
                        </span>
                      )}
                    </div>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="shrink-0 h-8 w-8 -mt-1 -mr-1 hover:bg-red-100 hover:text-red-600 transition-colors" 
                      onClick={() => handleDeleteEvent(evento.id)}
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                ))
              )}
            </div>

            {/* Formulário para adicionar novo - AJUSTADO COM FLEXBOX AQUI */}
            <div className="space-y-4 border-t pt-4">
              <h4 className="text-sm font-medium">Novo Evento</h4>
              <div className="flex gap-3">
                <div className="flex-1">
                  <Input 
                    placeholder="Ex: Reunião com Cliente" 
                    value={novoEventoTitulo}
                    onChange={(e) => setNovoEventoTitulo(e.target.value)}
                    disabled={isLoadingAgenda}
                  />
                </div>
                <div className="w-[130px] shrink-0">
                  <Input 
                    type="time"
                    value={novoEventoHora}
                    onChange={(e) => setNovoEventoHora(e.target.value)}
                    disabled={isLoadingAgenda}
                    className="w-full"
                  />
                </div>
              </div>
              <Button onClick={handleAddEvent} className="w-full" disabled={!novoEventoTitulo || isLoadingAgenda}>
                {isLoadingAgenda ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                {isLoadingAgenda ? 'Salvando...' : 'Adicionar à Agenda'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}