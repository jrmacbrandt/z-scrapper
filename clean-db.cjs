const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
sb.from('ig_perfis').delete().eq('perfil_pai', 'melhor_hotel_fazenda_rj').then(res => console.log('Cleaned db', res));
