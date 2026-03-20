"use client";

import { useState, useEffect } from "react";
import { PlusCircle, UploadCloud, Users, Loader2, FileSpreadsheet, Edit3, Code2, Eye } from "lucide-react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import { createClient } from "@/lib/supabase/client";

interface NovaCampanhaModalProps {
  leads?: any[];
  onSuccess?: () => void;
  campanhaExistente?: any;
}

export function NovaCampanhaModal({ leads = [], onSuccess, campanhaExistente }: NovaCampanhaModalProps) {
  const [open, setOpen] = useState(false);
  const [nomeCampanha, setNomeCampanha] = useState("");
  const [assunto, setAssunto] = useState("");
  const [corpoEmail, setCorpoEmail] = useState("");
  const [origem, setOrigem] = useState("kanban"); 
  const [colunaKanban, setColunaKanban] = useState("Novos Leads");
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const [dadosExcel, setDadosExcel] = useState<any[]>([]);
  const [nomeArquivo, setNomeArquivo] = useState("");

  const supabase = createClient();

  useEffect(() => {
    if (campanhaExistente) {
      setNomeCampanha(campanhaExistente.nome || "");
      setAssunto(campanhaExistente.assunto || "");
      setCorpoEmail(campanhaExistente.corpo_html || "");
    }
  }, [campanhaExistente]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setNomeArquivo(file.name);
    const reader = new FileReader();

    reader.onload = (event) => {
      const bstr = event.target?.result;
      const workbook = XLSX.read(bstr, { type: "binary" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const json: any[] = XLSX.utils.sheet_to_json(sheet);

      const dadosFormatados = json.map(row => ({
        nome: row.nome || row.Nome || row.NOME || "Cliente",
        email: row.email || row.Email || row.EMAIL || row['e-mail'] || row['E-mail'] || row.e_mail || null
      })).filter(item => item.email);

      setDadosExcel(dadosFormatados);
    };

    reader.readAsBinaryString(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const { data: authData } = await supabase.auth.getUser();
      const userId = authData.user?.id;

      if (campanhaExistente) {
        const { error: updateError } = await supabase
          .from('campanhas')
          .update({
            nome: nomeCampanha,
            assunto: assunto,
            corpo_html: corpoEmail,
          })
          .eq('id', campanhaExistente.id);

        if (updateError) throw updateError;
        alert("Campanha atualizada com sucesso!");
        
      } else {
        const { data: campanha, error: insertError } = await supabase
          .from('campanhas')
          .insert([{
              nome: nomeCampanha,
              assunto: assunto,
              corpo_html: corpoEmail,
              status: 'RASCUNHO',
              criado_por: userId
          }])
          .select().single();

        if (insertError) throw insertError;

        let loteEnvios = [];

        if (origem === 'kanban') {
          const leadsDaColuna = leads.filter(l => l.situacao === colunaKanban && l.email);
          loteEnvios = leadsDaColuna.map(l => ({
            campanha_id: campanha.id,
            nome_destinatario: l.nome || "Cliente",
            email_destinatario: l.email.trim(),
            status: 'RASCUNHO'
          }));
        } else {
          loteEnvios = dadosExcel.map(d => ({
            campanha_id: campanha.id,
            nome_destinatario: d.nome,
            email_destinatario: d.email.trim(),
            status: 'RASCUNHO'
          }));
        }

        if (loteEnvios.length > 0) {
          const { error: enviosError } = await supabase.from('envios_campanha').insert(loteEnvios);
          if (enviosError) throw enviosError;
        }

        alert(`Campanha salva como Rascunho com ${loteEnvios.length} destinatários! Vá em "Ver Relatório" para dar o Play.`);
      }

      setNomeCampanha(""); setAssunto(""); setCorpoEmail(""); setDadosExcel([]); setNomeArquivo("");
      setOpen(false);
      if (onSuccess) onSuccess();

    } catch (error: any) {
      console.error(error);
      alert("Erro ao processar campanha.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {campanhaExistente ? (
          <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-indigo-600">
            <Edit3 className="w-4 h-4" />
          </Button>
        ) : (
          <Button className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm font-semibold">
            <PlusCircle className="mr-2 h-4 w-4" /> Nova Campanha
          </Button>
        )}
      </DialogTrigger>
      
      <DialogContent className="sm:max-w-[700px] bg-white max-h-[90vh] overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-slate-900">
            {campanhaExistente ? "Editar Campanha" : "Criar Nova Campanha"}
          </DialogTitle>
          <DialogDescription className="text-slate-500">
            {campanhaExistente 
              ? "Altere os detalhes e a mensagem da campanha selecionada." 
              : "Escolha os destinatários e configure sua mensagem personalizada."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-semibold text-slate-700">Nome Interno</Label>
              <Input placeholder="Ex: Campanha Março 2026" value={nomeCampanha} onChange={e => setNomeCampanha(e.target.value)} required className="h-11 border-slate-200" />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-semibold text-slate-700">Assunto do E-mail</Label>
              <Input placeholder="O que o cliente verá na caixa de entrada" value={assunto} onChange={e => setAssunto(e.target.value)} required className="h-11 border-slate-200" />
            </div>
          </div>

          {!campanhaExistente && (
            <div className="border border-slate-200 rounded-xl p-5 bg-slate-50/50 space-y-4">
              <Label className="text-base font-bold text-indigo-900">Origem dos Contatos</Label>
              <Tabs value={origem} onValueChange={setOrigem} className="w-full">
                <TabsList className="grid w-full grid-cols-2 bg-slate-200/50 p-1 rounded-lg">
                  <TabsTrigger value="kanban" className="flex items-center gap-2 font-medium"><Users className="w-4 h-4" /> Kanban</TabsTrigger>
                  <TabsTrigger value="upload" className="flex items-center gap-2 font-medium"><FileSpreadsheet className="w-4 h-4" /> Excel</TabsTrigger>
                </TabsList>

                <TabsContent value="kanban" className="pt-4 space-y-3">
                  <Label className="text-sm text-slate-500 font-medium">Extrair leads de qual coluna do quadro?</Label>
                  <Select value={colunaKanban} onValueChange={setColunaKanban}>
                    <SelectTrigger className="w-full h-12 bg-white border-slate-200 text-slate-700 shadow-sm transition-all">
                      <SelectValue placeholder="Selecione uma etapa do funil..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Novos Leads">Novos Leads</SelectItem>
                      <SelectItem value="Em contato">Em contato</SelectItem>
                      <SelectItem value="Recontato">Recontato</SelectItem>
                      <SelectItem value="Reunião agendada">Reunião agendada</SelectItem>
                    </SelectContent>
                  </Select>
                </TabsContent>

                <TabsContent value="upload" className="pt-4 space-y-3">
                  <div className="border-2 border-dashed border-slate-300 rounded-xl p-6 text-center bg-white hover:border-indigo-400 hover:bg-indigo-50/30 transition-all group">
                    <Input type="file" accept=".xlsx, .csv" onChange={handleFileUpload} className="hidden" id="excel-upload" />
                    <label htmlFor="excel-upload" className="cursor-pointer flex flex-col items-center">
                      <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-3 group-hover:bg-indigo-100 transition-colors">
                        <UploadCloud className="w-6 h-6 text-slate-400 group-hover:text-indigo-600" />
                      </div>
                      <span className="text-sm font-semibold text-slate-600 group-hover:text-indigo-900">{nomeArquivo || "Clique para importar o ficheiro Excel"}</span>
                    </label>
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          )}

          <div className="space-y-3 border border-slate-200 rounded-xl p-4 bg-slate-50/30">
            <Label className="text-sm font-semibold text-slate-700">Corpo da Mensagem</Label>
            <Tabs defaultValue="codigo" className="w-full">
              <TabsList className="grid w-full grid-cols-2 bg-slate-200/50 p-1 rounded-lg mb-4">
                <TabsTrigger value="codigo" className="flex items-center gap-2 font-medium">
                  <Code2 className="w-4 h-4" /> Código HTML
                </TabsTrigger>
                <TabsTrigger value="preview" className="flex items-center gap-2 font-medium">
                  <Eye className="w-4 h-4" /> Pré-visualização
                </TabsTrigger>
              </TabsList>
              
              <TabsContent value="codigo" className="m-0">
                <textarea 
                  className="w-full rounded-xl border border-slate-200 p-4 text-sm min-h-[250px] focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none shadow-sm transition-all font-mono bg-slate-50"
                  placeholder="<html><body>Olá [nome], temos uma proposta para o seu consultório...</body></html>"
                  value={corpoEmail}
                  onChange={e => setCorpoEmail(e.target.value)}
                  required
                />
              </TabsContent>
              
              <TabsContent value="preview" className="m-0">
                <div className="w-full rounded-xl border border-slate-200 bg-white min-h-[250px] shadow-sm overflow-hidden flex flex-col">
                  {corpoEmail ? (
                    <iframe 
                      srcDoc={corpoEmail} 
                      className="w-full flex-1 min-h-[250px] border-0" 
                      title="Preview do E-mail" 
                    />
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-8 text-center min-h-[250px]">
                      <Eye className="w-8 h-8 mb-2 opacity-50" />
                      <p className="text-sm">Cole o código HTML na aba ao lado para visualizar aqui.</p>
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </div>

          <DialogFooter className="gap-2 sm:gap-0 border-t pt-6">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={isSubmitting} className="font-medium text-slate-500">
              Cancelar
            </Button>
            <Button type="submit" className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 font-bold shadow-lg shadow-indigo-200" disabled={isSubmitting}>
              {isSubmitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processando...</> : (campanhaExistente ? "Salvar Alterações" : "Salvar como Rascunho")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}