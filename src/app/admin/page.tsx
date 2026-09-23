"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getErrorMessage } from "@/lib/utils";
import {
  ArrowLeft, Building2, Plus, Edit, Settings, Loader2, Eye, EyeOff, UserPlus, Mail
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";

interface Empresa {
  id: string;
  nome: string;
  slug: string;
  usa_sheets: boolean;
}

interface Config {
  google_sheet_id_1?: string;
  google_sheet_id_2?: string;
  google_sheet_id_3?: string;
  google_client_email?: string;
  google_private_key?: string;
  resend_api_key?: string;
}

const MODULOS_ADMIN = [
  'dashboard', 'kanban', 'arquivados', 'relatorios',
  'relatorios-comerciais', 'campanhas', 'whatsapp', 'usuarios'
];

function gerarSlug(nome: string) {
  return nome
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export default function AdminPage() {
  const router = useRouter();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [showResendKey, setShowResendKey] = useState(false);

  // Form – dados da empresa
  const [nome, setNome] = useState('');
  const [slug, setSlug] = useState('');
  const [usaSheets, setUsaSheets] = useState(false);
  const [config, setConfig] = useState<Config>({});

  // Form – convite do primeiro usuário
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteNome, setInviteNome] = useState('');

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.user_metadata?.is_super_admin) {
        router.replace('/');
        return;
      }
      await buscarEmpresas();
      setLoading(false);
    }
    init();
  }, []);

  const buscarEmpresas = async () => {
    const res = await fetch('/api/empresas');
    const data = await res.json();
    if (Array.isArray(data)) setEmpresas(data);
  };

  const handleNomeChange = (value: string) => {
    setNome(value);
    if (!editandoId) setSlug(gerarSlug(value));
  };

  const abrirModalNovo = () => {
    setEditandoId(null);
    setNome('');
    setSlug('');
    setUsaSheets(false);
    setConfig({});
    setInviteEmail('');
    setInviteNome('');
    setShowPrivateKey(false);
    setShowResendKey(false);
    setIsModalOpen(true);
  };

  const abrirModalEdicao = async (empresa: Empresa) => {
    setEditandoId(empresa.id);
    setNome(empresa.nome);
    setSlug(empresa.slug);
    setUsaSheets(empresa.usa_sheets);
    setInviteEmail('');
    setInviteNome('');
    setShowPrivateKey(false);
    setShowResendKey(false);
    setConfig({});

    const res = await fetch(`/api/empresas/${empresa.id}/configuracoes`);
    const data = await res.json();
    setConfig(data || {});

    setIsModalOpen(true);
  };

  const handleSalvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);

    try {
      let empresaId = editandoId;

      if (editandoId) {
        await fetch(`/api/empresas/${editandoId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nome, slug, usa_sheets: usaSheets }),
        });
      } else {
        const res = await fetch('/api/empresas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nome, slug, usa_sheets: usaSheets }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erro ao criar empresa');
        empresaId = data.id;
      }

      // Salva configurações da empresa (Sheets + Resend)
      if (empresaId) {
        await fetch(`/api/empresas/${empresaId}/configuracoes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config),
        });
      }

      // Convida primeiro usuário (apenas ao criar)
      if (!editandoId && inviteEmail && inviteNome && empresaId) {
        const res = await fetch('/api/usuarios', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: inviteEmail,
            nome: inviteNome,
            perfil: 'ADMIN',
            modulos: MODULOS_ADMIN,
            empresa_id_override: empresaId,
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Erro ao enviar convite');
        }
      }

      await buscarEmpresas();
      setIsModalOpen(false);
    } catch (error) {
      alert(`Erro: ${getErrorMessage(error)}`);
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-4 sticky top-0 z-10 shadow-sm">
        <Button variant="ghost" size="icon" onClick={() => router.push('/')}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-slate-900">Painel de Administração</h1>
          <p className="text-sm text-slate-500">Gerencie empresas, integrações e configurações do sistema</p>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-6 space-y-6">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
            <Building2 className="w-5 h-5 text-slate-400" />
            Empresas cadastradas
            <span className="text-sm font-normal text-slate-400">({empresas.length})</span>
          </h2>
          <Button onClick={abrirModalNovo} className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm">
            <Plus className="w-4 h-4 mr-2" /> Nova Empresa
          </Button>
        </div>

        <Card className="shadow-sm border-slate-200 overflow-hidden">
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-slate-500 font-medium text-xs uppercase tracking-wider">
                  <th className="text-left px-6 py-3">Nome</th>
                  <th className="text-left px-6 py-3">Slug</th>
                  <th className="text-left px-6 py-3">Integração</th>
                  <th className="text-right px-6 py-3">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {empresas.map(emp => (
                  <tr key={emp.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-6 py-4 font-semibold text-slate-700">{emp.nome}</td>
                    <td className="px-6 py-4 text-slate-400 font-mono text-xs">{emp.slug}</td>
                    <td className="px-6 py-4">
                      {emp.usa_sheets
                        ? <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 text-xs">Google Sheets</Badge>
                        : <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100 text-xs">CRM Interno</Badge>
                      }
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => abrirModalEdicao(emp)}
                        className="text-slate-400 hover:text-indigo-600 hover:bg-indigo-50"
                      >
                        <Edit className="w-4 h-4 mr-1" /> Editar
                      </Button>
                    </td>
                  </tr>
                ))}
                {empresas.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-6 py-12 text-center text-slate-400">
                      Nenhuma empresa cadastrada.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </main>

      {/* Modal criar / editar */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="w-5 h-5 text-indigo-500" />
              {editandoId ? `Editar: ${nome}` : 'Nova Empresa'}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSalvar} className="space-y-6 pt-2">
            {/* Dados básicos */}
            <section className="space-y-4">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Dados da Empresa</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Nome *</Label>
                  <Input
                    value={nome}
                    onChange={e => handleNomeChange(e.target.value)}
                    required
                    placeholder="Ex: Clínica Saúde"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Slug *</Label>
                  <Input
                    value={slug}
                    onChange={e => setSlug(e.target.value)}
                    required
                    placeholder="clinica-saude"
                    className="font-mono text-sm"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Tipo de integração</Label>
                <Select
                  value={usaSheets ? 'sheets' : 'supabase'}
                  onValueChange={v => setUsaSheets(v === 'sheets')}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="supabase">CRM Interno (Supabase)</SelectItem>
                    <SelectItem value="sheets">Google Sheets</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </section>

            {/* Configurações Google Sheets */}
            {usaSheets && (
              <section className="space-y-4 bg-slate-50 rounded-xl p-4 border border-slate-200">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                  <Settings className="w-3.5 h-3.5" /> Configurações Google Sheets
                </h3>
                <div className="grid grid-cols-1 gap-3">
                  {(
                    [
                      { key: 'google_sheet_id_1', label: 'Sheet ID 1', placeholder: 'ID da primeira planilha' },
                      { key: 'google_sheet_id_2', label: 'Sheet ID 2', placeholder: 'ID da segunda planilha' },
                      { key: 'google_sheet_id_3', label: 'Sheet ID 3', placeholder: 'ID da terceira planilha' },
                      { key: 'google_client_email', label: 'Client Email', placeholder: 'service-account@projeto.iam.gserviceaccount.com' },
                    ] satisfies { key: keyof Config; label: string; placeholder: string }[]
                  ).map(field => (
                    <div key={field.key} className="space-y-1">
                      <Label className="text-xs">{field.label}</Label>
                      <Input
                        value={config[field.key] || ''}
                        onChange={e => setConfig(p => ({ ...p, [field.key]: e.target.value }))}
                        placeholder={field.placeholder}
                        className="font-mono text-xs"
                      />
                    </div>
                  ))}

                  <div className="space-y-1">
                    <Label className="text-xs">Private Key</Label>
                    <div className="relative">
                      <textarea
                        value={config.google_private_key || ''}
                        onChange={e => setConfig(p => ({ ...p, google_private_key: e.target.value }))}
                        placeholder="-----BEGIN RSA PRIVATE KEY-----&#10;..."
                        rows={5}
                        className="w-full font-mono text-xs rounded-md border border-input bg-background px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none pr-10"
                        style={{ filter: showPrivateKey ? 'none' : 'blur(3px)' }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPrivateKey(p => !p)}
                        className="absolute right-2 top-2 p-1 rounded hover:bg-slate-100 transition-colors"
                      >
                        {showPrivateKey
                          ? <EyeOff className="w-4 h-4 text-slate-400" />
                          : <Eye className="w-4 h-4 text-slate-400" />
                        }
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* Resend API Key */}
            <section className="space-y-4 bg-slate-50 rounded-xl p-4 border border-slate-200">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                <Mail className="w-3.5 h-3.5" /> Integração de E-mail (Resend)
              </h3>
              <div className="space-y-1">
                <Label className="text-xs">Resend API Key</Label>
                <div className="relative">
                  <Input
                    type={showResendKey ? 'text' : 'password'}
                    value={config.resend_api_key || ''}
                    onChange={e => setConfig(p => ({ ...p, resend_api_key: e.target.value }))}
                    placeholder="re_xxxxxxxxxxxxxxxxxxxx"
                    className="font-mono text-sm pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowResendKey(p => !p)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-slate-100 transition-colors"
                  >
                    {showResendKey
                      ? <EyeOff className="w-4 h-4 text-slate-400" />
                      : <Eye className="w-4 h-4 text-slate-400" />
                    }
                  </button>
                </div>
              </div>
            </section>

            {/* Convite primeiro usuário — apenas na criação */}
            {!editandoId && (
              <section className="space-y-4 bg-indigo-50 rounded-xl p-4 border border-indigo-100">
                <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-wider flex items-center gap-2">
                  <UserPlus className="w-3.5 h-3.5" /> Convidar Administrador
                </h3>
                <p className="text-xs text-slate-500">Opcional — convida o primeiro usuário admin ao criar a empresa.</p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Nome</Label>
                    <Input
                      value={inviteNome}
                      onChange={e => setInviteNome(e.target.value)}
                      placeholder="Nome completo"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">E-mail</Label>
                    <Input
                      type="email"
                      value={inviteEmail}
                      onChange={e => setInviteEmail(e.target.value)}
                      placeholder="admin@empresa.com"
                    />
                  </div>
                </div>
              </section>
            )}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setIsModalOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isSaving} className="bg-indigo-600 hover:bg-indigo-700 text-white">
                {isSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {editandoId ? 'Salvar Alterações' : 'Criar Empresa'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
