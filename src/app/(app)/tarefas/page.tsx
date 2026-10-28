// T-182 (fase4-tarefas-agenda, AC-461): fila do turno dentro da casca `(app)`.
// Sem sessão, quem manda ao login é o middleware (AC-204); os dados vêm só da API.
import { FilaTurno } from '@/components/tarefas/fila-turno';

export default function TarefasPage() {
  return <FilaTurno />;
}
