// T-046 (fase2-kanban): singleton preguiçoso do Better Auth para as rotas de
// `/api/oportunidades*` e `/api/motivos-perda`. `criarAuth(getDb(), ...)`
// não pode rodar no escopo do módulo da rota — `next build` coleta dados de
// página importando cada `route.ts`, e nesse momento `DATABASE_URL` não
// existe (só em runtime); `getDb()` lançaria antes mesmo de qualquer
// requisição chegar. `getAuth()` adia a criação para a primeira chamada.
import type { Auth } from './server';
import { criarAuth } from './server';
import { getDb } from '../../db/client';

let instancia: Auth | undefined;

export function getAuth(): Auth {
  if (!instancia) {
    instancia = criarAuth(getDb(), {
      secret: process.env.BETTER_AUTH_SECRET,
      baseURL: process.env.BETTER_AUTH_URL,
    });
  }
  return instancia;
}
