// ============================================================
// auth.js — SCADA IoT Authentication
// Terhubung ke Node.js backend API → MySQL database
// ============================================================

// URL backend Node.js kamu — sesuaikan kalau port berbeda

// -------------------------------------------------------
// LOGIN — fetch ke /api/auth/login
// -------------------------------------------------------
async function login() {
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;

  clearMessage("loginMsg");

  if (!username || !password) {
    showMessage("loginMsg", "Username dan password wajib diisi.", "error");
    return;
  }

  // Tampilkan loading
  showMessage("loginMsg", "⏳ Memverifikasi...", "success");

  try {
   const res = await fetch('/api/auth/login', {
   method: "POST",
   headers: { "Content-Type": "application/json" },
   body: JSON.stringify({ username, password }),
});

const data = await res.json();

    if (res.ok && data.success) {
      // Simpan token JWT dan info user ke sessionStorage
      // sessionStorage otomatis hapus saat browser ditutup
      sessionStorage.setItem("scada_token", data.token);
      sessionStorage.setItem("scada_session", JSON.stringify({
        username: data.user.username,
        role:     data.user.role,
        joinDate: data.user.joinedAt
          ? new Date(data.user.joinedAt).toLocaleDateString("id-ID")
          : "-",
      }));

      showMessage("loginMsg", `✅ ${data.message}`, "success");
      setTimeout(() => { window.location.href = "dashboard.html"; }, 1000);

    } else {
      showMessage("loginMsg", `❌ ${data.message || "Login gagal"}`, "error");
      document.getElementById("password").value = "";
    }

  } catch (err) {
    // Jika Node.js belum jalan atau tidak bisa konek
    showMessage(
      "loginMsg",
      "❌ Tidak bisa konek ke server. Pastikan Node.js sudah jalan.",
      "error"
    );
    console.error("Login error:", err);
  }
}

// -------------------------------------------------------
// REGISTER — fetch ke /api/auth/register
// -------------------------------------------------------
async function register() {
  const username        = document.getElementById("regUsername").value.trim();
  const password        = document.getElementById("regPassword").value;
  const confirmPassword = document.getElementById("regConfirmPassword").value;
  const email = document.getElementById("regEmail").value.trim();

  clearMessage("registerMsg");

  // Validasi frontend dulu sebelum kirim ke server
  if (!username || !password || !confirmPassword || !email) {
    showMessage("registerMsg", "Semua field wajib diisi.", "error");
    return;
  }
  if (username.length < 3) {
    showMessage("registerMsg", "Username minimal 3 karakter.", "error");
    return;
  }
  if (password.length < 6) {
    showMessage("registerMsg", "Password minimal 6 karakter.", "error");
    return;
  }
  if (password !== confirmPassword) {
    showMessage("registerMsg", "Password dan konfirmasi tidak sama.", "error");
    return;
  }

  showMessage("registerMsg", "⏳ Mendaftarkan akun...", "success");

  try {
   const res = await fetch('/api/auth/register', {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    username,
    email,
    password
  }),
});

const data = await res.json();

    if (res.ok && data.success) {
      showMessage("registerMsg", `✅ ${data.message}`, "success");
      setTimeout(() => {
        toggleLogin();
        document.getElementById("username").value = username;
      }, 1500);
    } else {
      showMessage("registerMsg", `❌ ${data.message || "Registrasi gagal"}`, "error");
    }

  } catch (err) {
    showMessage(
      "registerMsg",
      "❌ Tidak bisa konek ke server. Pastikan Node.js sudah jalan.",
      "error"
    );
    console.error("Register error:", err);
  }
}

// -------------------------------------------------------
// TOGGLE FORM (Login <-> Register)
// -------------------------------------------------------
function toggleRegister() {
  document.getElementById("loginForm").style.display    = "none";
  document.getElementById("registerForm").style.display = "block";
  clearAllMessages();
}

function toggleLogin() {
  document.getElementById("loginForm").style.display    = "block";
  document.getElementById("registerForm").style.display = "none";
  clearAllMessages();
}

// -------------------------------------------------------
// HELPERS — tampilkan & hapus pesan
// -------------------------------------------------------
function showMessage(id, message, type) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = message;
  el.className   = "msg " + type;
}

function clearMessage(id) {
  const el = document.getElementById(id);
  if (el) { el.textContent = ""; el.className = "msg"; }
}

function clearAllMessages() {
  clearMessage("loginMsg");
  clearMessage("registerMsg");
}

// -------------------------------------------------------
// ENTER KEY
// -------------------------------------------------------
document.addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  const isRegister = document.getElementById("registerForm")?.style.display === "block";
  isRegister ? register() : login();
});
