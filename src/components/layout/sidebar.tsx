"use client";

import { useState } from "react";
import { LayoutDashboard, KanbanSquare, Archive, LogOut, ChevronLeft, ChevronRight, MessageSquare, FileText, Mail, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface SidebarProps {
  abaAtiva: string;
  setAbaAtiva: (aba: string) => void;
}

export function Sidebar({ abaAtiva, setAbaAtiva }: SidebarProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const router = useRouter();
  const supabase = createClient();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

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
      category: "Análises",
      items: [
        { id: "relatorios", label: "Relatórios", icon: FileText, disabled: false },
        { id: "chats", label: "Mensagens", icon: MessageSquare, disabled: true },
      ]
    },
    {
      category: "Comunicação",
      items: [
        { id: "campanhas", label: "Mala Direta", icon: Mail, disabled: false },
      ]
    },
    {
      category: "Administração",
      items: [
        { id: "usuarios", label: "Equipe e Acessos", icon: Users, disabled: false },
      ]
    }
  ];

  return (
    <aside 
      className={`relative h-screen bg-[#111111] text-zinc-400 transition-all duration-300 ease-in-out flex flex-col rounded-r-[32px] shadow-2xl z-50 ${
        isExpanded ? "w-[260px]" : "w-[80px]"
      }`}
    >
      <div className="flex items-center justify-between p-6">
        {isExpanded && (
          <span className="text-xl font-bold text-white tracking-wider">
            MedGuia Hub
          </span>
        )}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="p-2 rounded-lg hover:bg-zinc-800 transition-colors absolute -right-4 top-6 bg-[#111111] border border-zinc-800 group"
        >
          {isExpanded ? (
            <ChevronLeft className="w-4 h-4 text-zinc-400 group-hover:text-white transition-colors" />
          ) : (
            <ChevronRight className="w-4 h-4 text-zinc-400 group-hover:text-white transition-colors" />
          )}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent">
        {menuItems.map((group, groupIndex) => (
          <div key={groupIndex} className="mb-6">
            {isExpanded && (
              <h3 className="px-6 mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-600">
                {group.category}
              </h3>
            )}
            <ul className="space-y-1 px-3">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = abaAtiva === item.id;
                
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

      <div className="p-4 mt-auto border-t border-zinc-800/50">
        <button
          onClick={handleLogout}
          className="w-full flex items-center px-4 py-3 rounded-xl transition-all duration-200 hover:bg-red-500/10 hover:text-red-400 text-zinc-500 group"
          title={!isExpanded ? "Sair do Sistema" : ""}
        >
          <LogOut className="w-5 h-5 shrink-0 transition-colors group-hover:text-red-400" />
          {isExpanded && (
            <span className="ml-3 text-sm font-medium">
              Sair do Sistema
            </span>
          )}
        </button>
      </div>
    </aside>
  );
}