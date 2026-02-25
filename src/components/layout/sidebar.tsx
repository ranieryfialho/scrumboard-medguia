import { useState } from "react";
import { LayoutDashboard, KanbanSquare, Archive, Settings, LogOut, ChevronLeft, ChevronRight, MessageSquare, FileText } from "lucide-react";

interface SidebarProps {
  abaAtiva: string;
  setAbaAtiva: (aba: string) => void;
}

export function Sidebar({ abaAtiva, setAbaAtiva }: SidebarProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  const menuItems = [
    {
      category: "Leads",
      items: [
        { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, disabled: false },
        { id: "kanban", label: "Quadro Kanban", icon: KanbanSquare, disabled: false },
        { id: "arquivados", label: "Arquivados", icon: Archive, disabled: false },
      ]
    },
    {
      category: "Suporte",
      items: [
        { id: "chats", label: "Mensagens", icon: MessageSquare, disabled: true },
        { id: "relatorios", label: "Relatórios", icon: FileText, disabled: true },
      ]
    }
  ];

  return (
    <aside 
      className={`relative h-screen bg-[#111111] text-zinc-400 transition-all duration-300 ease-in-out flex flex-col rounded-r-[32px] shadow-2xl z-50 ${
        isExpanded ? "w-[260px]" : "w-[80px]"
      }`}
    >
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="absolute -right-3 top-8 bg-indigo-200 text-indigo-900 w-6 h-6 rounded-full flex items-center justify-center shadow-md hover:bg-indigo-300 transition-colors z-50"
      >
        {isExpanded ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      </button>

      {/* LOGO */}
      <div className="p-8 pb-6 flex items-center">
        <div className="w-8 h-8 rounded-lg bg-indigo-500 flex items-center justify-center shrink-0">
          <span className="text-white font-bold text-lg">M</span>
        </div>
        {isExpanded && (
          <span className="ml-3 text-white font-bold text-xl tracking-wide animate-in fade-in">
            MedGuia
          </span>
        )}
      </div>

      {/* MENU DE NAVEGAÇÃO */}
      <div className="flex-1 overflow-y-auto py-4 custom-scrollbar">
        {menuItems.map((group, index) => (
          <div key={index} className="mb-6">
            {isExpanded && (
              <h3 className="px-8 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-3">
                {group.category}
              </h3>
            )}
            <ul className="space-y-1 px-4">
              {group.items.map((item) => {
                const isActive = abaAtiva === item.id;
                const Icon = item.icon;

                return (
                  <li key={item.id}>
                    <button
                      onClick={() => !item.disabled && setAbaAtiva(item.id)}
                      disabled={item.disabled}
                      className={`w-full flex items-center px-4 py-3 rounded-xl transition-all duration-200 group ${
                        isActive 
                          ? "bg-indigo-500/10 text-indigo-400" 
                          : item.disabled 
                            ? "opacity-40 cursor-not-allowed" 
                            : "hover:bg-white/5 hover:text-white"
                      }`}
                      title={!isExpanded ? item.label : ""}
                    >
                      <Icon className={`w-5 h-5 shrink-0 transition-colors ${isActive ? "text-indigo-400" : "text-zinc-500 group-hover:text-zinc-300"}`} />
                      {isExpanded && (
                        <span className={`ml-3 text-sm font-medium ${isActive ? "text-indigo-400" : ""}`}>
                          {item.label}
                        </span>
                      )}
                      
                      {/* Bordinha lateral para o item ativo */}
                      {isActive && isExpanded && (
                        <div className="absolute left-0 w-1 h-8 bg-indigo-500 rounded-r-full" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </aside>
  );
}