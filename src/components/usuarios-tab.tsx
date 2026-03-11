"use client";

import { useState, useEffect } from "react";
import { ShieldAlert, UserPlus, ShieldCheck, User, Users, Loader2, Mail } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";

export function UsuariosTab() {
  const [usuarios, setUsuarios] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isMaster, setIsMaster] = useState(false);

  // Campos do formulário (sem a senha agora!)
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [perfil, setPerfil] = useState("ATENDENTE");

  const supabase = createClient();

  useEffect(() => {
    verificarAcessoEBuscarUsuarios();
  }, []);

  const verificarAcessoEBuscarUsuarios = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (user?.user_metadata?.perfil !== 'MASTER') {
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

  const handleCriarUsuario = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const res = await fetch('/api/usuarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, nome, perfil }) // Enviamos sem senha
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Erro ao convidar usuário");

      alert("Convite enviado com sucesso! O usuário receberá um e-mail para definir a senha.");
      setIsModalOpen(false);
      
      setNome(""); setEmail(""); setPerfil("ATENDENTE");
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
          Apenas usuários com perfil de <strong>Administrador (Master)</strong> têm permissão para visualizar e gerenciar os acessos da equipe.
        </p>
      </div>
    );
  }

  const getBadgePerfil = (role: string) => {
    switch (role) {
      case 'MASTER': return <Badge className="bg-slate-900 hover:bg-slate-800"><ShieldAlert className="w-3 h-3 mr-1" /> Master</Badge>;
      case 'GERENTE': return <Badge className="bg-indigo-100 text-indigo-700 hover:bg-indigo-200"><ShieldCheck className="w-3 h-3 mr-1" /> Gerente</Badge>;
      default: return <Badge variant="outline" className="text-slate-600"><User className="w-3 h-3 mr-1" /> Atendente</Badge>;
    }
  };

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Gestão de Acessos</h1>
          <p className="text-slate-500 mt-2">Gerencie a equipe e defina os níveis de permissão do sistema.</p>
        </div>

        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <DialogTrigger asChild>
            <Button className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm font-semibold">
              <UserPlus className="w-4 h-4 mr-2" /> Convidar Usuário
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Convidar Novo Usuário</DialogTitle>
              <DialogDescription>
                Enviaremos um link mágico por e-mail para que o novo membro defina sua própria senha com segurança.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCriarUsuario} className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>Nome Completo</Label>
                <Input value={nome} onChange={e => setNome(e.target.value)} required placeholder="Ex: João Silva" />
              </div>
              <div className="space-y-2">
                <Label>E-mail (Login)</Label>
                <Input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="joao@medguia.com.br" />
              </div>
              <div className="space-y-2">
                <Label>Perfil de Acesso</Label>
                <Select value={perfil} onValueChange={setPerfil}>
                  <SelectTrigger className="bg-white border-slate-200 text-slate-800">
                    <SelectValue placeholder="Selecione o perfil" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ATENDENTE">Atendente (Apenas Kanban)</SelectItem>
                    <SelectItem value="GERENTE">Gerente (Relatórios + Kanban)</SelectItem>
                    <SelectItem value="MASTER">Master (Acesso Total)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              {/* Alerta visual sobre o e-mail */}
              <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3 flex items-start gap-3 mt-2">
                <Mail className="w-5 h-5 text-indigo-500 shrink-0 mt-0.5" />
                <p className="text-xs text-indigo-700 font-medium leading-relaxed">
                  O usuário receberá um e-mail do sistema com um link para criar a senha e ativar a conta.
                </p>
              </div>

              <DialogFooter className="pt-4">
                <Button type="submit" disabled={isSubmitting} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white">
                  {isSubmitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : "Enviar Convite"}
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
                <th className="px-6 py-4">Perfil</th>
                <th className="px-6 py-4">Data de Cadastro</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {usuarios.map((user) => (
                <tr key={user.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-6 py-4 font-semibold text-slate-700">{user.nome}</td>
                  <td className="px-6 py-4 text-slate-500">{user.email}</td>
                  <td className="px-6 py-4">{getBadgePerfil(user.perfil)}</td>
                  <td className="px-6 py-4 text-slate-500">{new Date(user.criado_em).toLocaleDateString('pt-BR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}