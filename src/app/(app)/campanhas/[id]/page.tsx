// T-199 (fase4-campanhas, AC-547): detalhe da campanha dentro da casca `(app)`.
import { DetalheCampanha } from '@/components/campanhas/detalhe-campanha';

export default async function CampanhaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DetalheCampanha id={id} />;
}
