-- Z-Scraper: Supabase Initialization Script
-- Execute este script no SQL Editor do seu projeto Supabase.

-- 1. Criar a tabela de corretores
CREATE TABLE IF NOT EXISTS corretores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    anunciante_id VARCHAR(255) UNIQUE NOT NULL,
    nome VARCHAR(255) NOT NULL,
    creci VARCHAR(100),
    telefone VARCHAR(50) NOT NULL,
    estado VARCHAR(2) NOT NULL,
    cidade VARCHAR(255) NOT NULL,
    imobiliaria VARCHAR(255),
    criado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Criar índices para busca rápida
CREATE INDEX IF NOT EXISTS idx_corretores_estado_cidade ON corretores(estado, cidade);
CREATE INDEX IF NOT EXISTS idx_corretores_anunciante_id ON corretores(anunciante_id);

-- 3. Habilitar Realtime (Opcional, para a tabela aparecer no dashboard em tempo real)
ALTER PUBLICATION supabase_realtime ADD TABLE corretores;

-- 4. Políticas de Segurança (RLS)
-- Por padrão, vamos permitir leitura e escrita para testes. 
-- Para produção, configure conforme necessário.
ALTER TABLE corretores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public access" ON corretores
FOR ALL USING (true) WITH CHECK (true);
