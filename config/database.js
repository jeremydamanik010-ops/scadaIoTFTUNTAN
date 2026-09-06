// ============================================================
// config/database.js
// Koneksi Supabase
// ============================================================

require('dotenv').config();

const {
    createClient
} = require('@supabase/supabase-js');


const supabaseUrl =
    process.env.SUPABASE_URL;

const supabaseKey =
    process.env.SUPABASE_KEY;


if (!supabaseUrl) {
    throw new Error(
        '❌ SUPABASE_URL belum ada di .env'
    );
}

if (!supabaseKey) {
    throw new Error(
        '❌ SUPABASE_SERVICE_KEY belum ada di .env'
    );
}


const supabase =
    createClient(
        supabaseUrl,
        supabaseKey
    );


console.log(
    '✅ Supabase database terhubung'
);


module.exports =
    supabase;