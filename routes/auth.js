require('dotenv').config();

const express = require('express');
const supabase = require('../config/database');
const authMiddleware = require('../middleware/auth');

const router = express.Router();


// ============================================================
// REGISTER
// ============================================================

router.post('/register', async (req, res) => {

    const { username, email, password } = req.body;

    if (!username || !email || !password) {
        return res.status(400).json({
            success: false,
            message: 'Username, email, dan password wajib diisi'
        });
    }

    if (username.length < 3) {
        return res.status(400).json({
            success: false,
            message: 'Username minimal 3 karakter'
        });
    }

    if (password.length < 6) {
        return res.status(400).json({
            success: false,
            message: 'Password minimal 6 karakter'
        });
    }

    try {

        // Cek username
        const { data: existingUsername, error: usernameError } =
            await supabase
                .from('profiles')
                .select('id')
                .eq('username', username)
                .maybeSingle();

        if (usernameError) {
            console.error('Username check error:', usernameError);

            return res.status(500).json({
                success: false,
                message: 'Gagal memeriksa username'
            });
        }

        if (existingUsername) {
            return res.status(409).json({
                success: false,
                message: 'Username sudah digunakan'
            });
        }


        // Buat akun Supabase Auth
        const {
        data: authData,
        error: authError 
        } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true
});

        if (authError) {

            console.error('Supabase register error:', authError);

            return res.status(400).json({
                success: false,
                message: authError.message
            });
        }

        if (!authData.user) {
            return res.status(400).json({
                success: false,
                message: 'User Supabase tidak berhasil dibuat'
            });
        }


        // Buat profile
        const { error: profileError } =
            await supabase
                .from('profiles')
                .insert({
                    id: authData.user.id,
                    username,
                    email,
                    role: 'Operator'
                });

        if (profileError) {

            console.error('Profile insert error:', profileError);

            return res.status(500).json({
                success: false,
                message: 'User berhasil dibuat tetapi profile gagal dibuat'
            });
        }


        return res.status(201).json({
            success: true,
            message: 'Registrasi berhasil. Silakan login.'
        });

    } catch (err) {

        console.error('Register error:', err);

        return res.status(500).json({
            success: false,
            message: 'Terjadi kesalahan server'
        });
    }
});


// ============================================================
// LOGIN
// ============================================================

router.post('/login', async (req, res) => {

    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({
            success: false,
            message: 'Username dan password wajib diisi'
        });
    }

    try {

        // Cari username di profiles
        const {
            data: profile,
            error: profileError
        } = await supabase
            .from('profiles')
            .select('id, username, email, role, joined_at')
            .eq('username', username)
            .maybeSingle();

        if (profileError) {

            console.error('Profile lookup error:', profileError);

            return res.status(500).json({
                success: false,
                message: 'Gagal membaca data pengguna'
            });
        }

        if (!profile) {

            return res.status(401).json({
                success: false,
                message: 'Username tidak ditemukan'
            });
        }


        // Login ke Supabase Auth
        const {
            data: authData,
            error: authError
        } = await supabase.auth.signInWithPassword({
            email: profile.email,
            password
        });

        if (authError || !authData.session) {

            console.error('Supabase login error:', authError);

            return res.status(401).json({
                success: false,
                message: 'Password salah'
            });
        }


        // Update last login
        await supabase
            .from('profiles')
            .update({
                last_login: new Date().toISOString()
            })
            .eq('id', profile.id);


        return res.json({
            success: true,
            message: 'Login berhasil',

            token: authData.session.access_token,

            user: {
                id: profile.id,
                username: profile.username,
                role: profile.role,
                joinedAt: profile.joined_at
            }
        });

    } catch (err) {

        console.error('Login error:', err);

        return res.status(500).json({
            success: false,
            message: 'Terjadi kesalahan server'
        });
    }
});


// ============================================================
// CHANGE PASSWORD
// ============================================================

router.post(
    '/change-password',
    authMiddleware,
    async (req, res) => {

        const { newPassword } = req.body;

        if (!newPassword || newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'Password baru minimal 6 karakter'
            });
        }

        try {

            const { error } =
                await supabase.auth.admin.updateUserById(
                    req.user.id,
                    {
                        password: newPassword
                    }
                );

            if (error) {
                throw error;
            }

            return res.json({
                success: true,
                message: 'Password berhasil diubah'
            });

        } catch (err) {

            console.error('Change password error:', err);

            return res.status(500).json({
                success: false,
                message: 'Gagal mengubah password'
            });
        }
    }
);


module.exports = router;