import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { PlusCircle, MailOpen, Send, MousePointerClick } from "lucide-react"
import Link from "next/link"

export default function CampanhasPage() {
  return (
    <div className="flex-1 space-y-6 p-8 pt-6">
      
      {/* Cabeçalho da Página */}
      <div className="flex items-center justify-between space-y-2">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Mala Direta</h2>
          <p className="text-muted-foreground">
            Gerencie seus disparos de e-mail e acompanhe os resultados em tempo real.
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Link href="/campanhas/nova">
            <Button>
              <PlusCircle className="mr-2 h-4 w-4" />
              Nova Campanha
            </Button>
          </Link>
        </div>
      </div>

      {/* Cards de Visão Geral (Métricas Globais) */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total de Envios</CardTitle>
            <Send className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">0</div>
            <p className="text-xs text-muted-foreground">E-mails disparados este mês</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Taxa de Abertura</CardTitle>
            <MailOpen className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">0%</div>
            <p className="text-xs text-muted-foreground">Média de e-mails abertos</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Taxa de Clique</CardTitle>
            <MousePointerClick className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">0%</div>
            <p className="text-xs text-muted-foreground">Cliques em links internos</p>
          </CardContent>
        </Card>
      </div>

      {/* Área da Lista de Campanhas (Vazio por enquanto) */}
      <Card className="col-span-4">
        <CardHeader>
          <CardTitle>Campanhas Recentes</CardTitle>
          <CardDescription>
            Você ainda não criou nenhuma campanha de e-mail.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex h-[300px] items-center justify-center rounded-md border border-dashed">
          <div className="mx-auto flex max-w-[420px] flex-col items-center justify-center text-center">
            <MailOpen className="h-10 w-10 text-muted-foreground mb-4" />
            <h3 className="mt-4 text-lg font-semibold">Nenhuma campanha encontrada</h3>
            <p className="mb-4 mt-2 text-sm text-muted-foreground">
              Comece criando sua primeira campanha para se comunicar com seus leads.
            </p>
            <Link href="/campanhas/nova">
              <Button size="sm">Criar Primeira Campanha</Button>
            </Link>
          </div>
        </CardContent>
      </Card>
      
    </div>
  )
}