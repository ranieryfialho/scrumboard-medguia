// T-217 (fase4-admin, AC-608): edição de empresa dentro da casca `(app)`. Só o super admin.
import { EditarEmpresa } from '@/components/admin/editar-empresa';

export default async function EditarEmpresaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EditarEmpresa id={id} />;
}
