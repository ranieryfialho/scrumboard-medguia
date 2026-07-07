"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

interface Conversa {
  numero: string;
  lastMessage: string;
  lastAt: string;
  count: number;
}

interface WhatsappUnreadContextValue {
  totalUnread: number;
  unreadByNumero: Record<string, boolean>;
  conversasNaoLidas: Conversa[];
  markRead: (numero: string) => void;
}

const WhatsappUnreadContext = createContext<WhatsappUnreadContextValue>({
  totalUnread: 0,
  unreadByNumero: {},
  conversasNaoLidas: [],
  markRead: () => {},
});

export function useWhatsappUnread() {
  return useContext(WhatsappUnreadContext);
}

function normalizePhone(phone: string): string {
  const d = phone.replace(/\D/g, '');
  return d.startsWith('55') && d.length >= 12 ? d : `55${d}`;
}

function getLastRead(numero: string): string {
  try { return localStorage.getItem(`wpp_read_${numero}`) || '1970-01-01T00:00:00Z'; }
  catch { return '1970-01-01T00:00:00Z'; }
}

export function WhatsappUnreadProvider({ children }: { children: React.ReactNode }) {
  const [conversas, setConversas] = useState<Conversa[]>([]);
  const supabase = createClient();

  // Busca inicial
  const fetchUnread = useCallback(async () => {
    try {
      const res = await fetch('/api/whatsapp/unread');
      if (res.ok) {
        const data = await res.json();
        setConversas(data.conversas || []);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchUnread();

    // Supabase Realtime — atualiza instantaneamente quando chega mensagem nova
    let channel: ReturnType<typeof supabase.channel> | null = null;

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      const empresaId = user.user_metadata?.empresa_id;
      if (!empresaId) return;

      channel = supabase
        .channel('wpp-unread-realtime')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'whatsapp_mensagens',
            filter: `empresa_id=eq.${empresaId}`,
          },
          (payload) => {
            const row = payload.new as {
              numero: string;
              mensagem: string;
              created_at: string;
              direcao: string;
            };
            if (row.direcao !== 'recebida') return;

            setConversas(prev => {
              const existing = prev.find(c => c.numero === row.numero);
              if (existing) {
                return prev.map(c =>
                  c.numero === row.numero
                    ? { ...c, count: c.count + 1, lastMessage: row.mensagem, lastAt: row.created_at }
                    : c
                );
              }
              return [...prev, { numero: row.numero, lastMessage: row.mensagem, lastAt: row.created_at, count: 1 }];
            });
          }
        )
        .subscribe();
    });

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [fetchUnread]);

  const markRead = useCallback((numero: string) => {
    const normalized = normalizePhone(numero);
    try { localStorage.setItem(`wpp_read_${normalized}`, new Date().toISOString()); }
    catch {}
    setConversas(prev => [...prev]);
  }, []);

  const unreadByNumero: Record<string, boolean> = {};
  const conversasNaoLidas: Conversa[] = [];
  let totalUnread = 0;
  for (const c of conversas) {
    const lastRead = getLastRead(c.numero);
    if (c.lastAt > lastRead) {
      unreadByNumero[c.numero] = true;
      conversasNaoLidas.push(c);
      totalUnread++;
    }
  }

  return (
    <WhatsappUnreadContext.Provider value={{ totalUnread, unreadByNumero, conversasNaoLidas, markRead }}>
      {children}
    </WhatsappUnreadContext.Provider>
  );
}
