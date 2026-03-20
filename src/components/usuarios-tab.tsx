"use client";

import { useState, useEffect } from "react";
import { ShieldAlert, UserPlus, ShieldCheck, User, Users, Loader2, Edit, CheckCircle2, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";

const MODULOS_SISTEMA = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'kanban', label: 'Quadro Kanban' },
  { id: 'arquivados', label: 'Leads Arquivados' },
  { id: 'relatorios', label: 'Marketing e Tráfego' },
  { id: 'relatorios-comerciais', label: 'Comercial e Vendas' },
  { id: 'campanhas', label: 'Mala Direta (E-mails)' },
  { id: 'usuarios', label: 'Equipe e Acessos (Admin)' },
];

const PERFIS_PRESET: Record<string, string[]> = {
  ADMIN: ['dashboard', 'kanban', 'arquivados', 'relatorios', 'relatorios-comerciais', 'campanhas', 'usuarios'],
  COMERCIAL: ['dashboard', 'kanban', 'arquivados', 'relatorios-comerciais'],
  MARKETING: ['dashboard', 'kanban', 'relatorios', 'campanhas'],
};

export function UsuariosTab() {
  const [usuarios, setUsuarios] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isMaster, setIsMaster] = useState(false);

  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [perfil, setPerfil] = useState("COMERCIAL");
  const [ativo, setAtivo] = useState(true);
  const [modulosSelecionados, setModulosSelecionados] = useState<string[]>(PERFIS_PRESET['COMERCIAL']);

  const supabase = createClient();

  useEffect(() => {
    verificarAcessoEBuscarUsuarios();
  }, []);

  const verificarAcessoEBuscarUsuarios = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const isUserAdmin = user?.user_metadata?.perfil === 'MASTER' || user?.user_metadata?.perfil === 'ADMIN' || user?.user_metadata?.modulos?.includes('usuarios');
      
      if (!isUserAdmin) {
        setIsMaster(false);
        setLoading(false);
        return;
      }
      
      setIsMaster(true);
      const res = await fetch('/api/usuarios');
      if (!res.ok) throw new Error("Erro ao buscar usuários");
      const data = await res.json();
      setUsuarios(data);
    } catch (error) {
      console.error("Erro:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleMudancaPerfil = (novoPerfil: string) => {
    setPerfil(novoPerfil);
    if (PERFIS_PRESET[novoPerfil]) {
      setModulosSelecionados(PERFIS_PRESET[novoPerfil]);
    }
  };

  const toggleModulo = (moduloId: string) => {
    setModulosSelecionados(prev => 
      prev.includes(moduloId) ? prev.filter(m => m !== moduloId) : [...prev, moduloId]
    );
  };

  const abrirModalNovo = () => {
    setEditandoId(null);
    setNome("");
    setEmail("");
    setAtivo(true);
    handleMudancaPerfil("COMERCIAL");
    setIsModalOpen(true);
  };

  const abrirModalEdicao = (user: any) => {
    setEditandoId(user.id);
    setNome(user.nome);
    setEmail(user.email);
    setAtivo(user.ativo !== false);
    
    let perfilUser = user.perfil;
    if (perfilUser === 'MASTER') perfilUser = 'ADMIN';
    if (perfilUser === 'GERENTE') perfilUser = 'MARKETING';
    if (perfilUser === 'ATENDENTE') perfilUser = 'COMERCIAL';
    setPerfil(perfilUser);
    
    let mods = user.modulos || [];
    if (mods.length === 0) {
      if (perfilUser === 'ADMIN') mods = PERFIS_PRESET['ADMIN'];
      else if (perfilUser === 'MARKETING') mods = ['dashboard', 'kanban', 'arquivados', 'relatorios', 'relatorios-comerciais'];
      else if (perfilUser === 'COMERCIAL') mods = PERFIS_PRESET['COMERCIAL'];
      else mods = ['dashboard', 'kanban'];
    }
    
    setModulosSelecionados(mods);
    setIsModalOpen(true);
  };

  const handleSalvarUsuario = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      if (editandoId) {
        const res = await fetch('/api/usuarios', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editandoId, nome, perfil, modulos: modulosSelecionados, ativo })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Erro ao atualizar usuário");
        alert("Acessos do usuário atualizados com sucesso!");
      } else {
        const res = await fetch('/api/usuarios', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, nome, perfil, modulos: modulosSelecionados })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Erro ao convidar usuário");
        alert("Convite enviado com sucesso!");
      }

      setIsModalOpen(false);
      verificarAcessoEBuscarUsuarios();
    } catch (error: any) {
      alert(`Erro: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return <div className="flex h-[80vh] items-center justify-center text-slate-400"><Loader2 className="w-8 h-8 animate-spin" /></div>;
  }

  if (!isMaster) {
    return (
      <div className="flex flex-col items-center justify-center h-[80vh] space-y-4 animate-in fade-in duration-500">
        <ShieldAlert className="w-20 h-20 text-red-500/80" />
        <h2 className="text-3xl font-bold text-slate-800">Acesso Restrito</h2>
        <p className="text-slate-500 text-center max-w-md">
          Apenas usuários com permissão de <strong>Administração</strong> podem gerenciar os acessos da equipe.
        </p>
      </div>
    );
  }

  const getBadgePerfil = (role: string) => {
    if (role === 'MASTER' || role === 'ADMIN') return <Badge className="bg-slate-900 hover:bg-slate-800"><ShieldAlert className="w-3 h-3 mr-1" /> Admin</Badge>;
    if (role === 'GERENTE' || role === 'MARKETING') return <Badge className="bg-fuchsia-100 text-fuchsia-700 hover:bg-fuchsia-200"><ShieldCheck className="w-3 h-3 mr-1" /> Marketing</Badge>;
    if (role === 'ATENDENTE' || role === 'COMERCIAL') return <Badge className="bg-indigo-100 text-indigo-700 hover:bg-indigo-200"><User className="w-3 h-3 mr-1" /> Comercial</Badge>;
    return <Badge variant="outline" className="text-slate-600">{role}</Badge>;
  };

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Gestão de Acessos</h1>
          <p className="text-slate-500 mt-2">Convide a equipe e personalize o que cada um pode visualizar.</p>
        </div>

        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <DialogTrigger asChild>
            <Button onClick={abrirModalNovo} className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm font-semibold">
              <UserPlus className="w-4 h-4 mr-2" /> Convidar Usuário
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[480px]">
            <DialogHeader>
              <DialogTitle>{editandoId ? "Editar Acessos do Usuário" : "Convidar Novo Usuário"}</DialogTitle>
              <DialogDescription>
                {editandoId ? "Altere as permissões, módulos ou bloqueie o acesso." : "Selecione um perfil base e ajuste os módulos de acesso abaixo se necessário."}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSalvarUsuario} className="space-y-4 pt-2">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Nome Completo</Label>
                  <Input value={nome} onChange={e => setNome(e.target.value)} required placeholder="Ex: João Silva" />
                </div>
                <div className="space-y-2">
                  <Label>E-mail (Login)</Label>
                  <Input 
                    type="email" 
                    value={email} 
                    onChange={e => setEmail(e.target.value)} 
                    required 
                    placeholder="joao@email.com" 
                    disabled={!!editandoId} 
                    className={editandoId ? "bg-slate-100 text-slate-500" : ""}
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Perfil Base (Template)</Label>
                  <Select value={perfil} onValueChange={handleMudancaPerfil}>
                    <SelectTrigger className="bg-white border-slate-200 text-slate-800">
                      <SelectValue placeholder="Selecione o perfil" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="COMERCIAL">Vendas / Comercial</SelectItem>
                      <SelectItem value="MARKETING">Gestor de Tráfego / MKT</SelectItem>
                      <SelectItem value="ADMIN">CEO / Desenvolvedor</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {editandoId && (
                  <div className="space-y-2">
                    <Label>Status da Conta</Label>
                    <Select value={ativo ? "true" : "false"} onValueChange={(v) => setAtivo(v === "true")}>
                      <SelectTrigger className={ativo ? "bg-emerald-50 border-emerald-200 text-emerald-700 font-medium" : "bg-red-50 border-red-200 text-red-700 font-medium"}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="true">Ativo (Acesso Liberado)</SelectItem>
                        <SelectItem value="false">Bloqueado (Sem Acesso)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              
              <div className={`bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3 mt-2 ${!ativo ? "opacity-50 pointer-events-none grayscale" : ""}`}>
                <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Módulos Liberados
                </Label>
                <div className="grid grid-cols-2 gap-3 mt-2">
                  {MODULOS_SISTEMA.map(mod => (
                    <label key={mod.id} className="flex items-start gap-2 cursor-pointer group">
                      <input 
                        type="checkbox" 
                        checked={modulosSelecionados.includes(mod.id)}
                        onChange={() => toggleModulo(mod.id)}
                        className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                      />
                      <span className="text-sm text-slate-700 group-hover:text-indigo-600 transition-colors leading-tight">
                        {mod.label}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <DialogFooter className="pt-2">
                <Button type="button" variant="ghost" onClick={() => setIsModalOpen(false)}>Cancelar</Button>
                <Button type="submit" disabled={isSubmitting} className="bg-indigo-600 hover:bg-indigo-700 text-white">
                  {isSubmitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : (editandoId ? "Salvar Alterações" : "Enviar Convite Personalizado")}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="shadow-sm border-slate-200 overflow-hidden">
        <CardHeader className="bg-slate-50 border-b border-slate-100">
          <CardTitle className="text-lg flex items-center gap-2"><Users className="w-5 h-5 text-slate-500" /> Equipe Cadastrada</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm text-left">
            <thead className="bg-white border-b border-slate-100">
              <tr className="text-slate-500 font-medium">
                <th className="px-6 py-4">Nome</th>
                <th className="px-6 py-4">E-mail</th>
                <th className="px-6 py-4">Perfil Base</th>
                <th className="px-6 py-4">Acessos</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {usuarios.map((user) => {
                let qtdModulos = user.modulos?.length || 0;
                
                if (qtdModulos === 0) {
                  if (user.perfil === 'MASTER' || user.perfil === 'ADMIN') qtdModulos = 7;
                  else if (user.perfil === 'GERENTE') qtdModulos = 5;
                  else if (user.perfil === 'ATENDENTE' || user.perfil === 'COMERCIAL') qtdModulos = 4;
                  else qtdModulos = 2;
                }

                return (
                  <tr key={user.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4 font-semibold text-slate-700">{user.nome}</td>
                    <td className="px-6 py-4 text-slate-500">{user.email}</td>
                    <td className="px-6 py-4">{getBadgePerfil(user.perfil)}</td>
                    <td className="px-6 py-4">
                      <span className="text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded-md border border-slate-200 font-medium">
                        {qtdModulos} módulos
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {user.ativo ? (
                         <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md border border-emerald-100">
                           <CheckCircle2 className="w-3 h-3" /> Ativo
                         </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 bg-red-50 px-2 py-1 rounded-md border border-red-100">
                           <XCircle className="w-3 h-3" /> Bloqueado
                         </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                        onClick={() => abrirModalEdicao(user)}
                        title="Editar Acessos"
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}