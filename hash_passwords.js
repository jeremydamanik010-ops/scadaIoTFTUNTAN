// ============================================================
// hash_passwords.js — Jalankan SEKALI SAJA sebelum login
// Mengubah password plain text di database jadi bcrypt hash
// Cara: node hash_passwords.js
// ============================================================
require('dotenv').config();
const bcrypt = require('bcrypt');
const mysql  = require('mysql2/promise');

async function run() {
  const db = await mysql.createConnection({
    host:     process.env.DB_HOST     || 'localhost',
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME     || 'scada_iot',
  });

  console.log('✅ Terhubung ke database\n');

  const [users] = await db.execute('SELECT id, username, password FROM users');
  console.log(`📋 ${users.length} user ditemukan\n`);

  for (const user of users) {
    // Lewati kalau sudah di-hash (bcrypt diawali $2b$)
    if (user.password.startsWith('$2b$') || user.password.startsWith('$2a$')) {
      console.log(`⏭️  ${user.username} — sudah di-hash, skip`);
      continue;
    }
    const hashed = await bcrypt.hash(user.password, 10);
    await db.execute('UPDATE users SET password = ? WHERE id = ?', [hashed, user.id]);
    console.log(`🔐 ${user.username} — berhasil di-hash`);
  }

  await db.end();
  console.log('\n✅ Selesai! Sekarang bisa login seperti biasa.');
}

run().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
