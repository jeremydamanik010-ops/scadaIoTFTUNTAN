// ============================================================
// middleware/auth.js
// Verifikasi Supabase Access Token
// ============================================================

require('dotenv').config();

const supabase = require('../config/database');


async function authMiddleware(req, res, next) {

    const authHeader = req.headers.authorization;

    const token =
        authHeader &&
        authHeader.startsWith('Bearer ')
            ? authHeader.substring(7)
            : null;


    if (!token) {

        return res.status(401).json({
            success: false,
            message: 'Token tidak ditemukan, silakan login'
        });
    }


    try {

        // ----------------------------------------------------
        // Verifikasi token melalui Supabase Auth
        // ----------------------------------------------------

        const {
            data: {
                user
            },
            error
        } = await supabase.auth.getUser(token);


        if (error || !user) {

            return res.status(403).json({
                success: false,
                message:
                    'Token tidak valid atau sudah kadaluarsa, silakan login kembali'
            });
        }


        // ----------------------------------------------------
        // Ambil profile aplikasi
        // ----------------------------------------------------

        const {
            data: profile,
            error: profileError
        } = await supabase
            .from('profiles')
            .select(`
                id,
                username,
                role,
                organization_id,
                joined_at
            `)
            .eq('id', user.id)
            .single();


        if (profileError || !profile) {

            return res.status(403).json({
                success: false,
                message: 'Profil user tidak ditemukan'
            });
        }


        // ----------------------------------------------------
        // Simpan informasi user ke request
        // ----------------------------------------------------

        req.user = {
            id: user.id,
            email: user.email,
            username: profile.username,
            role: profile.role,
            organization_id: profile.organization_id,
            joined_at: profile.joined_at
        };


        next();

    } catch (err) {

        console.error('Auth middleware error:', err);

        return res.status(403).json({
            success: false,
            message:
                'Token tidak valid atau terjadi kesalahan autentikasi'
        });
    }
}


module.exports = authMiddleware;