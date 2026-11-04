-- T-322 (fase4-admin, US-138): os módulos liberados de cada colaborador (como no CRM antigo): a lista de partes do sistema a que a
-- pessoa tem acesso nesta empresa. NULL = vale o padrão do papel. O papel continua sendo o teto: a lista só restringe.
-- Escrita à mão, no estilo da 0026; `empresas_usuarios` não tem RLS por empresa (o filtro é explícito no código).

ALTER TABLE "empresas_usuarios" ADD COLUMN "modulos" text[];
