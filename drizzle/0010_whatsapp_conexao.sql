-- T-081 (fase2c-whatsapp-conexao, US-049): unicidade do nome de instância da
-- Evolution entre empresas (AC-173, ASM-051). `empresa_configuracoes` já
-- isola por tenant via RLS (migration 0001) e já tem unicidade por
-- (empresa_id, chave) (migration 0000) — isso evita duplicata dentro da
-- mesma empresa, mas não impede duas empresas diferentes de gravarem o
-- mesmo `evolution_instance_name`. Como a RLS esconde as linhas de outras
-- empresas, o repositório (T-084) não tem como checar isso por SELECT antes
-- de gravar; a garantia só pode vir do banco, então este índice único
-- parcial é a fonte de verdade e o repositório traduz a violação 23505 em
-- `INSTANCIA_EM_USO`.
CREATE UNIQUE INDEX IF NOT EXISTS "empresa_configuracoes_instancia_whatsapp_unica"
  ON "empresa_configuracoes" USING btree ("valor")
  WHERE "chave" = 'evolution_instance_name';
