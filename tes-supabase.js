require('dotenv').config();

const supabase = require('./config/database');

async function test() {

    console.log('URL:', process.env.SUPABASE_URL);
    console.log('Supabase key dikonfigurasi:', Boolean(
        process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
    ));

    const {
        data,
        error
    } = await supabase
        .from('profiles')
        .select('id, username, role')
        .limit(5);

    console.log('DATA:', data);
    console.log('ERROR:', error);
}

test();