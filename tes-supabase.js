require('dotenv').config();

const supabase = require('./config/database');

async function test() {

    console.log('URL:', process.env.SUPABASE_URL);
    console.log(
        'KEY:',
        process.env.SUPABASE_KEY
            ? process.env.SUPABASE_KEY.substring(0, 20) + '...'
            : 'TIDAK ADA'
    );

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