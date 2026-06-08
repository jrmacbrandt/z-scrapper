import Database from "better-sqlite3";
import path from "path";

const dbPath = path.join(process.cwd(), "database.sqlite");
const db = new Database(dbPath, { verbose: undefined }); // omit console.log to avoid spamming the log

// Configuração para melhor performance
db.pragma("journal_mode = WAL");

export function initDB() {
    db.exec(`
        -- 1. Criar a tabela de corretores
        CREATE TABLE IF NOT EXISTS corretores (
            id TEXT PRIMARY KEY,
            anunciante_id TEXT UNIQUE NOT NULL,
            nome TEXT NOT NULL,
            creci TEXT,
            telefone TEXT NOT NULL,
            estado TEXT NOT NULL,
            cidade TEXT NOT NULL,
            imobiliaria TEXT,
            foto TEXT,
            link_perfil TEXT,
            zap_id TEXT,
            busca_origem TEXT,
            msg_enviada INTEGER DEFAULT 0,
            criado_em TEXT
        );

        -- 2. Criar a tabela de buscas salvas
        CREATE TABLE IF NOT EXISTS buscas (
            id TEXT PRIMARY KEY,
            estado TEXT NOT NULL,
            cidade TEXT NOT NULL,
            total_contatos INTEGER DEFAULT 0,
            criado_em TEXT
        );

        -- 3. Criar índices para busca rápida
        CREATE INDEX IF NOT EXISTS idx_corretores_estado_cidade ON corretores(estado, cidade);
        CREATE INDEX IF NOT EXISTS idx_corretores_anunciante_id ON corretores(anunciante_id);
        CREATE INDEX IF NOT EXISTS idx_buscas_criado_em ON buscas(criado_em DESC);

        -- Instagram Module Tables
        CREATE TABLE IF NOT EXISTS ig_sessoes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            session_cookie TEXT NOT NULL,
            is_active INTEGER DEFAULT 1,
            criado_em TEXT DEFAULT CURRENT_TIMESTAMP,
            atualizado_em TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS ig_perfis (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            nome_completo TEXT,
            bio TEXT,
            seguidores INTEGER DEFAULT 0,
            seguindo INTEGER DEFAULT 0,
            posts INTEGER DEFAULT 0,
            telefone_extraido TEXT,
            link_bio TEXT,
            email_extraido TEXT,
            is_business INTEGER DEFAULT 0,
            is_private INTEGER DEFAULT 0,
            perfil_pai TEXT,
            dm_enviado INTEGER DEFAULT 0,
            criado_em TEXT DEFAULT CURRENT_TIMESTAMP,
            atualizado_em TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS ig_buscas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tipo_busca TEXT NOT NULL,
            alvo TEXT NOT NULL,
            total_capturado INTEGER DEFAULT 0,
            criado_em TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS ig_leads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            nome_completo TEXT,
            bio TEXT,
            seguidores INTEGER DEFAULT 0,
            posts INTEGER DEFAULT 0,
            telefone TEXT,
            email TEXT,
            link_bio TEXT,
            is_business INTEGER DEFAULT 0,
            origem TEXT,
            dm_enviado INTEGER DEFAULT 0,
            criado_em TEXT DEFAULT CURRENT_TIMESTAMP
        );

        -- Google Maps Module Tables
        CREATE TABLE IF NOT EXISTS gmaps_buscas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            keyword TEXT NOT NULL,
            location TEXT NOT NULL,
            total_leads INTEGER DEFAULT 0,
            criado_em TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS gmaps_leads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            gmb_id TEXT UNIQUE NOT NULL,
            company_name TEXT NOT NULL,
            google_rating REAL DEFAULT 0,
            reviews_count INTEGER DEFAULT 0,
            is_claimed INTEGER DEFAULT 1,
            phone_raw TEXT,
            phone_e164 TEXT,
            phone_type TEXT,
            has_whatsapp INTEGER DEFAULT 0,
            website_url TEXT,
            website_status TEXT,
            opportunity_score INTEGER DEFAULT 100,
            primary_pitch TEXT,
            busca_id INTEGER,
            msg_enviada INTEGER DEFAULT 0,
            criado_em TEXT DEFAULT CURRENT_TIMESTAMP
        );
    `);
}

// Utilitário para gerar UUID localmente, similar ao gen_random_uuid()
export function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

export default db;
