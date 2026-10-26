// T-143 (fase4-design-system-shell-acesso, AC-382): a raiz vira
// redirecionamento — o middleware (src/middleware.ts) já garante que só
// quem tem sessão chega até aqui (sem sessão, ele vai para `/login` antes
// disso), então esta página só decide o destino de quem está logado.
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/pipeline");
}
