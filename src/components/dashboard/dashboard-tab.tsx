import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, TrendingUp, CheckCircle2, Clock, ChevronLeft, ChevronRight } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { ptBR } from "date-fns/locale";
import { addMonths, subMonths, format } from "date-fns";

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
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <Card className="col-span-1 flex flex-col overflow-hidden">
          <CardHeader className="pb-3 border-b border-slate-100">
            <div className="flex items-center justify-between">
              <button
                onClick={() => setCalendarMonth(subMonths(calendarMonth, 1))}
                className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-slate-100 transition-colors text-slate-600"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="flex flex-col items-center gap-0.5">
                <CardTitle className="text-lg">Calendário</CardTitle>
                <span className="text-sm text-slate-500">{mesCapitalizado}</span>
              </div>
              <button
                onClick={() => setCalendarMonth(addMonths(calendarMonth, 1))}
                className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-slate-100 transition-colors text-slate-600"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </CardHeader>
          <CardContent className="p-4">
            <div className="w-full [&>div]:w-full [&_table]:w-full">
              <Calendar
                mode="single"
                selected={date}
                onSelect={setDate}
                month={calendarMonth}
                onMonthChange={setCalendarMonth}
                locale={ptBR}
                className="w-full p-0"
                classNames={{
                  months: "w-full",
                  month: "w-full space-y-3",
                  // ✅ Força remoção total do caption nativo com !important
                  caption: "!hidden !h-0 !overflow-hidden !p-0 !m-0 !border-0",
                  nav: "!hidden",
                  nav_button: "!hidden",
                  nav_button_previous: "!hidden",
                  nav_button_next: "!hidden",
                  caption_label: "!hidden",
                  table: "w-full border-collapse",
                  head_row: "flex w-full justify-between mb-2",
                  head_cell: "w-10 text-center text-slate-500 font-medium text-[0.75rem] uppercase py-1",
                  row: "flex w-full justify-between mt-2",
                  cell: "w-10 h-10 p-0 flex items-center justify-center relative",
                  day: "h-10 w-10 flex items-center justify-center font-normal text-slate-700 hover:bg-slate-100 rounded-lg transition-colors text-sm",
                  day_selected: "bg-indigo-600 text-white hover:bg-indigo-700 hover:text-white font-bold",
                  day_today: "bg-slate-200 text-slate-900 font-semibold",
                  day_outside: "text-slate-300",
                }}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-1 lg:col-span-2 flex flex-col h-full">
          <CardHeader className="border-b border-slate-100">
            <CardTitle className="text-lg">Top Especialidades Cadastradas</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 p-6 flex flex-col h-[320px]">
            {dadosGrafico.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dadosGrafico} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
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
  );
}