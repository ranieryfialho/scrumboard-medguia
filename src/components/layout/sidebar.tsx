"use client";

import { useState, useEffect } from "react";
import { LayoutDashboard, KanbanSquare, Archive, LogOut, ChevronLeft, ChevronRight, MessageSquare, FileText, Mail, Users, Trophy, Target } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface SidebarProps {
  abaAtiva: string;
  setAbaAtiva: (aba: string) => void;
}

export function Sidebar({ abaAtiva, setAbaAtiva }: SidebarProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [modulosPermitidos, setModulosPermitidos] = useState<string[]>([]);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    async function carregarPermissoes() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const metadataModulos = user.user_metadata?.modulos;
      const perfilAntigo = user.user_metadata?.perfil;
      const isAtivo = user.user_metadata?.ativo !== false;

      if (!isAtivo) {
        setModulosPermitidos([]);
        return;
      }

      if (metadataModulos && Array.isArray(metadataModulos)) {
        setModulosPermitidos(metadataModulos);
      } else {
        if (perfilAntigo === 'MASTER' || perfilAntigo === 'ADMIN') {
          setModulosPermitidos(['dashboard', 'kanban', 'arquivados', 'relatorios', 'relatorios-comerciais', 'campanhas', 'usuarios']);
        } else if (perfilAntigo === 'GERENTE') {
          setModulosPermitidos(['dashboard', 'kanban', 'arquivados', 'relatorios', 'relatorios-comerciais']);
        } else {
          setModulosPermitidos(['dashboard', 'kanban']); 
        }
      }
    }
    carregarPermissoes();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  const menuConfig = [
    {
      category: "Leads",
      items: [
        { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
        { id: "kanban", label: "Quadro Kanban", icon: KanbanSquare },
        { id: "arquivados", label: "Arquivados", icon: Archive },
      ]
    },
    {
      category: "Análises",
      items: [
        { id: "relatorios", label: "Marketing e Tráfego", icon: Target },
        { id: "relatorios-comerciais", label: "Comercial e Vendas", icon: Trophy },
      ]
    },
    {
      category: "Comunicação",
      items: [
        { id: "campanhas", label: "Mala Direta", icon: Mail },
      ]
    },
    {
      category: "Administração",
      items: [
        { id: "usuarios", label: "Equipe e Acessos", icon: Users },
      ]
    }
  ];

  const menusFiltrados = menuConfig.map(group => {
    return {
      ...group,
      items: group.items.filter(item => modulosPermitidos.includes(item.id))
    };
  }).filter(group => group.items.length > 0);

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
        {menusFiltrados.length === 0 ? (
           <div className="px-6 py-8 text-center">
             <p className="text-xs text-red-400/80 uppercase tracking-widest font-bold">Acesso Bloqueado</p>
           </div>
        ) : (
          menusFiltrados.map((group, groupIndex) => (
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
                        onClick={() => setAbaAtiva(item.id)}
                        className={`w-full flex items-center px-4 py-3 rounded-xl transition-all duration-200 group ${
                          isActive 
                            ? "bg-indigo-500/10 text-indigo-400" 
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
          ))
        )}
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