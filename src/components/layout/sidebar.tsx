"use client";

import { useState, useEffect } from "react";
import { LayoutDashboard, KanbanSquare, Archive, LogOut, ChevronLeft, ChevronRight, Mail, Users, Trophy, Target, X, Building2, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface SidebarProps {
  abaAtiva: string;
  setAbaAtiva: (aba: string) => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export function Sidebar({ abaAtiva, setAbaAtiva, mobileOpen = false, onMobileClose }: SidebarProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [modulosPermitidos, setModulosPermitidos] = useState<string[]>([]);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [empresas, setEmpresas] = useState<{ id: string; nome: string }[]>([]);
  const [empresaSelecionada, setEmpresaSelecionada] = useState('');
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

      if (user.user_metadata?.is_super_admin) {
        setIsSuperAdmin(true);
        const propria = user.user_metadata?.empresa_id as string;
        const match = document.cookie.match(/selected_empresa_id=([^;]+)/);
        setEmpresaSelecionada(match ? match[1] : propria);
        const res = await fetch('/api/empresas');
        const data = await res.json();
        if (Array.isArray(data)) setEmpresas(data);
      }
    }
    carregarPermissoes();
  }, []);

  const trocarTenant = (empresaId: string) => {
    document.cookie = `selected_empresa_id=${empresaId}; path=/; max-age=86400`;
    setEmpresaSelecionada(empresaId);
    window.location.reload();
  };

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
    <>
      {/* Overlay para mobile */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={onMobileClose}
        />
      )}

      <aside
        className={`
          fixed md:relative h-screen bg-[#111111] text-zinc-400 flex flex-col rounded-r-[32px] shadow-2xl z-50
          transition-all duration-300 ease-in-out
          ${mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
          ${isExpanded ? "w-[260px]" : "w-[80px]"}
        `}
      >
      <div className="flex items-center justify-between p-6">
        {isExpanded && (
          <span className="text-xl font-bold text-white tracking-wider">
            MedGuia Hub
          </span>
        )}
        {/* Botão fechar no mobile */}
        <button
          onClick={onMobileClose}
          className="p-2 rounded-lg hover:bg-zinc-800 transition-colors md:hidden ml-auto"
        >
          <X className="w-4 h-4 text-zinc-400" />
        </button>
        {/* Botão expandir/colapsar no desktop */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="p-2 rounded-lg hover:bg-zinc-800 transition-colors absolute -right-4 top-6 bg-[#111111] border border-zinc-800 group hidden md:flex"
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

      {isSuperAdmin && (
        <div className="px-3 pb-1">
          <button
            onClick={() => router.push('/admin')}
            className="w-full flex items-center px-4 py-3 rounded-xl transition-all duration-200 hover:bg-indigo-500/10 hover:text-indigo-400 text-zinc-500 group"
            title={!isExpanded ? "Painel Admin" : ""}
          >
            <ShieldCheck className="w-5 h-5 shrink-0 transition-colors group-hover:text-indigo-400" />
            {isExpanded && <span className="ml-3 text-sm font-medium">Painel Admin</span>}
          </button>
        </div>
      )}

      {isSuperAdmin && (
        <div className="px-4 pb-2 border-t border-zinc-800/50 pt-3">
          {isExpanded ? (
            <>
              <p className="text-xs text-zinc-600 uppercase tracking-wider mb-2 font-semibold">
                Tenant Ativo
              </p>
              <select
                value={empresaSelecionada}
                onChange={(e) => trocarTenant(e.target.value)}
                className="w-full bg-zinc-800 text-zinc-300 text-sm rounded-lg px-3 py-2 border border-zinc-700 focus:outline-none focus:border-indigo-500 cursor-pointer"
              >
                {empresas.map(emp => (
                  <option key={emp.id} value={emp.id}>{emp.nome}</option>
                ))}
              </select>
            </>
          ) : (
            <div className="flex justify-center py-1">
              <span title="Seletor de Tenant">
                <Building2 className={`w-5 h-5 ${empresaSelecionada ? 'text-indigo-400' : 'text-zinc-500'}`} />
              </span>
            </div>
          )}
        </div>
      )}

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
    </>
  );
}