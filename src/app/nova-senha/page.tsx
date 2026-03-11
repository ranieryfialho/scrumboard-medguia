"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Lock, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function NovaSenhaPage() {
  const [senha, setSenha] = useState("");
  const [confirmarSenha, setConfirmarSenha] = useState("");
  const [loading, setLoading] = useState(false);
  const [verificando, setVerificando] = useState(true);
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    // O token de convite chega como hash na URL (#access_token=...&type=invite)
    // O Supabase SSR detecta isso automaticamente via onAuthStateChange
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === "SIGNED_IN" || event === "USER_UPDATED") {
          // Sessão estabelecida pelo link mágico — pode prosseguir
          setVerificando(false);
        } else if (!session) {
          // Aguarda um pouco para o Supabase processar o hash da URL
          setTimeout(async () => {
            const { data } = await supabase.auth.getSession();
            if (!data.session) {
              setErro("Sessão inválida ou link expirado. Solicite um novo convite ao administrador.");
            }
            setVerificando(false);
          }, 1500);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro("");

    if (senha.length < 6) {
      setErro("A senha deve ter no mínimo 6 caracteres.");
      return;
    }
    if (senha !== confirmarSenha) {
      setErro("As senhas não coincidem.");
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: senha });
      if (error) throw error;

      setSucesso(true);
      setTimeout(() => router.push("/"), 2000);
    } catch (error: any) {
      setErro(error.message || "Erro ao salvar a senha. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  if (verificando) {
    return (
      <div className="min-h-screen bg-[#e4e5e7] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-slate-500">
          <Loader2 className="w-8 h-8 animate-spin" />
          <p className="text-sm font-medium">Verificando seu convite...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#e4e5e7] flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl overflow-hidden">
        <div className="bg-[#111111] p-6 text-center">
          <h1 className="text-2xl font-bold text-white tracking-wider">MedGuia Hub</h1>
          <p className="text-zinc-400 text-sm mt-1">Defina sua senha de acesso</p>
        </div>

        <div className="p-8">
          {sucesso ? (
            <div className="flex flex-col items-center justify-center text-center space-y-4 py-8">
              <CheckCircle2 className="w-16 h-16 text-emerald-500" />
              <h2 className="text-2xl font-bold text-slate-800">Senha salva!</h2>
              <p className="text-slate-500">Sua conta está pronta. Entrando no painel...</p>
            </div>
          ) : (
            <form onSubmit={handleUpdatePassword} className="space-y-6">
              {erro && (
                <div className="bg-red-50 border border-red-200 text-red-600 p-3 rounded-lg flex items-start gap-3 text-sm">
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                  <p>{erro}</p>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="senha">Sua Senha Definitiva</Label>
                <div className="relative">
                  <Lock className="w-5 h-5 text-slate-400 absolute left-3 top-2.5" />
                  <Input
                    id="senha" type="password"
                    placeholder="Mínimo 6 caracteres"
                    className="pl-10"
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmarSenha">Confirmar Senha</Label>
                <div className="relative">
                  <Lock className="w-5 h-5 text-slate-400 absolute left-3 top-2.5" />
                  <Input
                    id="confirmarSenha" type="password"
                    placeholder="Repita a senha"
                    className="pl-10"
                    value={confirmarSenha}
                    onChange={(e) => setConfirmarSenha(e.target.value)}
                    required
                  />
                </div>
              </div>

              <Button
                type="submit"
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-6 shadow-md"
                disabled={loading || !!erro}
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Salvar Senha e Entrar"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}