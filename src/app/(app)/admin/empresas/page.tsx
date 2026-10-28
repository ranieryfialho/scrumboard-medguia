// T-216 (fase4-admin, AC-598): lista de empresas da rede dentro da casca `(app)`. Só o super admin.
import { Empresas } from '@/components/admin/empresas';

export default function EmpresasPage() {
  return <Empresas />;
}
