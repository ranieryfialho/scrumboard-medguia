export function normalizarEspecialidade(raw: string): string | null {
  if (!raw) return null;
  const lower = raw.toLowerCase().trim();

  if (
    lower.includes('test lead') || 
    lower.includes('adiciona') || 
    lower.includes('não sou médico') || 
    lower.includes('sem especialidade') || 
    lower === 'medico' || 
    lower === 'clínica'
  ) {
    return null;
  }

  if (lower.includes('cardiolog')) return 'Cardiologia';
  if (lower.includes('plástic') || lower.includes('plastic')) return 'Cir. Plástica';
  if (lower.includes('cirurg')) return 'Cirurgia Geral'; 
  if (lower.includes('clínica médica') || lower.includes('clinica medica')) return 'Clínica Médica';
  if (lower.includes('geral') || lower.includes('generalista') || lower === 'mgc') return 'Clínico Geral';
  if (lower.includes('dentist') || lower.includes('odontolog')) return 'Odontologia';
  if (lower.includes('dermatolog') && !lower.includes('veterin')) return 'Dermatologia';
  if (lower.includes('geriatr')) return 'Geriatria';
  if (lower.includes('endocrin') || lower.includes('endócrin')) return 'Endocrinologia';
  if (lower.includes('fisioterap')) return 'Fisioterapia';
  if (lower.includes('ginecolog') || lower.includes('obstetr')) return 'Gineco/Obstetrícia';
  if (lower.includes('mfc') || lower.includes('família')) return 'Medicina de Família';
  if (lower.includes('mastolog')) return 'Mastologia';
  if (lower.includes('integrativa')) return 'Med. Integrativa';
  if (lower.includes('nutricionis') || lower.includes('nutrição')) return 'Nutrição';
  if (lower.includes('nutrolog')) return 'Nutrologia';
  if (lower.includes('oftalmolog')) return 'Oftalmologia';
  if (lower.includes('ortoped')) return 'Ortopedia';
  if (lower.includes('pediatr')) return 'Pediatria';
  if (lower.includes('psiquiatr') || lower.includes('psicoterap')) return 'Psiquiatria/Psico';
  if (lower.includes('radiolog')) return 'Radiologia';
  if (lower.includes('terapia ocupacional')) return 'Ter. Ocupacional';
  if (lower.includes('vascular')) return 'Vascular';
  if (lower.includes('vet')) return 'Veterinária';
  if (lower.includes('urolog')) return 'Urologia';

  return 'Outros'; 
}