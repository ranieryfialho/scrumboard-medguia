"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  MessageCircle, Wifi, WifiOff, QrCode,
  Loader2, CheckCircle2, AlertCircle, RefreshCw, Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ConnectionState = "idle" | "checking" | "open" | "close" | "connecting" | "error";

export function WhatsappConfigTab() {
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<ConnectionState>("idle");
  const [instanceName, setInstanceName] = useState<string>("");
  const [instanceInput, setInstanceInput] = useState<string>("");

  const [qrBase64, setQrBase64] = useState<string | null>(null);
  const [loadingQr, setLoadingQr] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  const checkStatus = useCallback(async () => {
    setState("checking");
    try {
      const res = await fetch("/api/whatsapp/status");
      const data = await res.json();
      setInstanceName(data.instance || "");
      setInstanceInput(data.instance || "");
      setState(data.state === "open" ? "open" : "close");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    Promise.all([
      fetch("/api/whatsapp/config").then(r => r.json()),
      checkStatus(),
    ]).then(([cfg]) => {
      const savedName = cfg.config?.evolution_instance_name || "";
      if (savedName) { setInstanceName(savedName); setInstanceInput(savedName); }
    }).finally(() => setLoading(false));

    return stopPolling;
  }, []);

  const handleConnect = async () => {
    const nome = instanceInput.trim();
    if (!nome) return;

    setLoadingQr(true);
    setQrBase64(null);
    setConnectError(null);
    setState("connecting");
    stopPolling();

    if (nome !== instanceName) {
      const saveRes = await fetch("/api/whatsapp/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ evolution_instance_name: nome }),
      });

      if (!saveRes.ok) {
        const { error } = await saveRes.json();
        setConnectError(error || "Erro ao salvar o nome da instância.");
        setState("close");
        setLoadingQr(false);
        return;
      }

      setInstanceName(nome);
    }

    try {
      const res = await fetch("/api/whatsapp/qrcode");
      const data = await res.json();

      if (data.state === "open") { setState("open"); return; }
      if (data.error) { setConnectError(data.error); setState("close"); return; }
      if (data.base64) setQrBase64(data.base64);

      pollRef.current = setInterval(async () => {
        const r = await fetch("/api/whatsapp/qrcode?action=status");
        const { state: s } = await r.json();
        if (s === "open") {
          setState("open");
          setQrBase64(null);
          stopPolling();
        }
      }, 5000);
    } catch {
      setConnectError("Erro ao conectar com a Evolution API.");
      setState("close");
    } finally {
      setLoadingQr(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
      </div>
    );
  }

  const isConnected = state === "open";
  const isConnecting = state === "connecting" || loadingQr;
  const isChecking = state === "checking";

  return (
    <div className="max-w-2xl mx-auto space-y-6 p-6 pb-12">

      {/* Header */}
      <div>
        <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
          <MessageCircle className="w-5 h-5 text-emerald-600" />
          WhatsApp
        </h2>
        <p className="text-sm text-slate-500 mt-0.5">
          Conecte seu número e configure mensagens automáticas
        </p>
      </div>

      {/* Card principal de conexão */}
      <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">

        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isChecking || isConnecting ? (
              <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
            ) : isConnected ? (
              <Wifi className="w-4 h-4 text-emerald-500" />
            ) : (
              <WifiOff className="w-4 h-4 text-red-400" />
            )}
            <span className={`text-sm font-semibold ${
              isConnected ? "text-emerald-600"
              : isChecking || isConnecting ? "text-amber-500"
              : "text-red-500"
            }`}>
              {isChecking ? "Verificando..." : isConnecting ? "Aguardando QR Code..." : isConnected ? "Conectado" : "Desconectado"}
            </span>
          </div>
          {!isChecking && !isConnecting && (
            <button onClick={checkStatus} className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1 transition-colors">
              <RefreshCw className="w-3.5 h-3.5" /> Atualizar
            </button>
          )}
        </div>

        <div className="p-6">
          {isConnected ? (
            <div className="space-y-4">
              <div className="flex items-center gap-4 p-4 bg-emerald-50 rounded-xl border border-emerald-200">
                <CheckCircle2 className="w-10 h-10 text-emerald-500 shrink-0" />
                <div>
                  <p className="font-semibold text-emerald-800">WhatsApp conectado!</p>
                  <p className="text-sm text-emerald-600">
                    Instância: <span className="font-mono font-bold">{instanceName}</span>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setState("close")}
                className="text-xs text-slate-400 hover:text-red-500 flex items-center gap-1 transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" /> Reconectar com outro número
              </button>
            </div>

          ) : qrBase64 ? (
            <div className="flex flex-col items-center gap-4">
              <p className="text-sm text-slate-600 text-center max-w-xs">
                Abra o WhatsApp → <strong>Dispositivos vinculados</strong> → <strong>Vincular dispositivo</strong> e escaneie:
              </p>
              <div className="p-3 bg-white border-2 border-slate-200 rounded-2xl shadow">
                <img src={qrBase64} alt="QR Code WhatsApp" className="w-56 h-56" />
              </div>
              <div className="flex items-center gap-2 text-sm text-indigo-600">
                <Loader2 className="w-4 h-4 animate-spin" /> Aguardando leitura...
              </div>
              <button onClick={handleConnect} className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1 transition-colors">
                <RefreshCw className="w-3.5 h-3.5" /> Gerar novo QR Code
              </button>
            </div>

          ) : (
            <div className="space-y-4">
              {connectError && (
                <div className="flex items-center gap-2 p-3 bg-red-50 rounded-lg border border-red-200 text-sm text-red-700">
                  <AlertCircle className="w-4 h-4 shrink-0" /> {connectError}
                </div>
              )}

              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-slate-700">Nome da instância</Label>
                <p className="text-xs text-slate-400">Identificador único no Evolution API. Use letras minúsculas, números e hífens.</p>
                <Input
                  value={instanceInput}
                  onChange={e => setInstanceInput(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                  placeholder="ex: clinica-saude-principal"
                  className="font-mono"
                  onKeyDown={e => e.key === "Enter" && handleConnect()}
                />
              </div>

              <Button
                onClick={handleConnect}
                disabled={loadingQr || !instanceInput.trim()}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {loadingQr
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Preparando...</>
                  : <><QrCode className="w-4 h-4 mr-2" />Gerar QR Code e conectar</>
                }
              </Button>
            </div>
          )}
        </div>
      </section>

    </div>
  );
}
