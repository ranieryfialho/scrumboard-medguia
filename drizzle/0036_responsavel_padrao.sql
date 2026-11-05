-- Responsável padrão dos cards novos. Cada empresa escolhe, em Equipe, quem recebe por padrão os cards que nascem sem responsável (a closer da
-- equipe, por exemplo). A escolha fica em `empresa_configuracoes` (chave `responsavel_padrao_id`, o id do usuário). O banco aplica sozinho na
-- criação do card, qualquer que seja a origem (novo lead, planilha, formulário, WhatsApp...): quem informar um responsável continua valendo, e
-- se o escolhido saiu da empresa ou foi desativado o card nasce sem responsável, como antes. Só acrescenta; não mexe em cards que já existem.
CREATE OR REPLACE FUNCTION oportunidade_responsavel_padrao() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_responsavel uuid;
BEGIN
  IF NEW.responsavel_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT u.id INTO v_responsavel
  FROM empresa_configuracoes c
  JOIN usuarios u ON u.id::text = (c.valor #>> '{}')
  JOIN empresas_usuarios eu ON eu.usuario_id = u.id AND eu.empresa_id = NEW.empresa_id AND eu.ativo
  WHERE c.empresa_id = NEW.empresa_id
    AND c.chave = 'responsavel_padrao_id'
    AND u.ativo
  LIMIT 1;

  NEW.responsavel_id := v_responsavel;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oportunidades_responsavel_padrao ON oportunidades;
CREATE TRIGGER oportunidades_responsavel_padrao
  BEFORE INSERT ON oportunidades
  FOR EACH ROW EXECUTE FUNCTION oportunidade_responsavel_padrao();
