const express = require("express");
const path = require("path");
const fs = require("fs");
const xlsx = require("xlsx");
const cors = require("cors");
const session = require("express-session");
const multer = require("multer");

// Configurar multer para subir archivos
const upload = multer({ 
  dest: path.join(__dirname, 'uploads'),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB max
});

const app = express();
const PORT = process.env.PORT || 3000;

// ===== Helpers Excel =====
function resolveExcelPath() {
  const candidates = [
    path.join(__dirname, "invitados.xls"),
    path.join(__dirname, "bodaBot", "invitados.xls"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  // fallback create empty file if none found
  const p = path.join(__dirname, "invitados.xls");
  const wb = xlsx.utils.book_new();
  const ws = xlsx.utils.json_to_sheet([]);
  xlsx.utils.book_append_sheet(wb, ws, "Invitados");
  xlsx.writeFile(wb, p);
  return p;
}

const EXCEL_PATH = resolveExcelPath();
const BACKUP_DIR = path.join(__dirname, 'backups');

// Crea un backup con timestamp del Excel actual
function autoBackup() {
  if (!fs.existsSync(EXCEL_PATH)) return;
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(BACKUP_DIR, `invitados_${ts}.xls`);
  fs.copyFileSync(EXCEL_PATH, dest);
  console.log(`📦 Backup creado: ${dest}`);
  // Conservar solo los últimos 30 backups
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('invitados_') && f.endsWith('.xls'))
    .sort();
  if (files.length > 30) {
    files.slice(0, files.length - 30).forEach(f => {
      try { fs.rmSync(path.join(BACKUP_DIR, f)); } catch {}
    });
  }
}

// BOT opcional (declaración arriba para que lo vean todas las rutas)
let botModule = null;
let botStarted = false;

// ===== Contraseña Admin =====
// CAMBIAR ESTA CONTRASEÑA por una segura
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin2026";

// ===== Middleware =====
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configurar sesiones
app.use(session({
  secret: process.env.SESSION_SECRET || "boda-secret-key-change-this",
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false, // true en producción con HTTPS
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24 // 24 horas
  }
}));

// Middleware de autenticación
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  // Si es una API request, devolver JSON
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ ok: false, error: 'No autorizado' });
  }
  // Si es página HTML, redirigir a login
  res.redirect('/login');
}

// Serve static index.html from root or /public if present
const staticDir = fs.existsSync(path.join(__dirname, "public")) ? "public" : "";
if (staticDir) app.use("/", express.static(path.join(__dirname, "public")));
app.use("/", express.static(__dirname));

// ===== API =====
// Ruta de login
app.get('/login', (req, res) => {
  if (req.session && req.session.authenticated) {
    return res.redirect('/admin');
  }
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// API de login
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  
  if (password === ADMIN_PASSWORD) {
    req.session.authenticated = true;
    res.json({ ok: true });
  } else {
    res.status(401).json({ ok: false, error: 'Contraseña incorrecta' });
  }
});

// API de logout
app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ ok: false, error: 'Error al cerrar sesión' });
    }
    res.json({ ok: true });
  });
});

// Ruta para servir el formulario de asistencia
app.get('/asistencia', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'asistencia.html'));
});

// Dev: quick check path
app.get("/api/info", (req, res) => {
  res.json({ excelPath: EXCEL_PATH });
});

// Lectura segura del Excel (reintenta si está bloqueado)
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function safeReadRows() {
  let lastErr = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const buf = fs.readFileSync(EXCEL_PATH);
      const wb = xlsx.read(buf, { type: 'buffer' });
      const sheetName = wb.SheetNames[0];
      const sheet = wb.Sheets[sheetName];
      const rows = xlsx.utils.sheet_to_json(sheet, { defval: "" });
      return { wb, rows, sheetName };
    } catch (e) {
      lastErr = e;
      if (e.code === 'EBUSY' || e.code === 'EPERM') {
        await sleep(200 * attempt);
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error('No se pudo leer el Excel');
}

// Añadir versiones usadas por el código existente
function readRows() {
  // Versión síncrona simple (el resto del código la usa sin await)
  const buf = fs.readFileSync(EXCEL_PATH);
  const wb = xlsx.read(buf, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: "" });
  return { wb, rows, sheetName };
}

// Escritura segura con archivo temporal (mitiga EBUSY/OneDrive)
async function safeWriteWorkbook(wb, destPath) {
  const dir = path.dirname(destPath);
  let lastErr = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const tmp = path.join(dir, `.~invitados_${Date.now()}_${attempt}.xls`);
    try {
      xlsx.writeFile(wb, tmp);
      try { fs.rmSync(destPath, { force: true }); } catch {}
      fs.renameSync(tmp, destPath);
      return;
    } catch (err) {
      lastErr = err;
      try { fs.rmSync(tmp, { force: true }); } catch {}
      if (err.code === 'EBUSY' || err.code === 'EPERM') {
        await sleep(250 * attempt);
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error('No se pudo escribir el Excel');
}

async function writeRows(rows, wb, sheetName) {
  const ws = xlsx.utils.json_to_sheet(rows);
  wb.Sheets[sheetName] = ws;
  await safeWriteWorkbook(wb, EXCEL_PATH);
}

// API invitados (usa lectura segura y mapeo tolerante)
app.get("/api/invitados", async (req, res) => {
  try {
    const { rows } = await safeReadRows();
    const invitados = rows
      .map(r => {
        const nombre = (r.Nombre || "").toString().trim();
        const asg = r.Boletos ?? r.BoletosAsignados ?? r["Boletos Asignados"] ?? r.boletos ?? r.boletosAsignados;
        const conf = r.Confirmados ?? 0;
        const toNum = v => {
          const n = Number(v);
          return Number.isFinite(n) ? n : null;
        };
        return {
          nombre,
          boletos: toNum(asg),
          confirmados: Number(toNum(conf) ?? 0)
        };
      })
      .filter(i => i.nombre);
    res.json({ ok: true, invitados });
  } catch (e) {
    console.error("GET /api/invitados error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Submit RSVP
app.post("/api/rsvp", async (req, res) => {
  try {
    let { nombre, asistencia, boletos, mensaje } = req.body;
    if (!nombre) return res.status(400).json({ ok: false, error: "Falta 'nombre'." });
    nombre = nombre.toString().trim();
    const asistirRaw = (asistencia || "").toString().toLowerCase();
    const asistir = ["si","sí","cambiar"].includes(asistirRaw) ? "si" : (["ninguno","no"].includes(asistirRaw) ? "no" : "");
    if (!asistir) return res.status(400).json({ ok: false, error: "Valor de 'asistencia' no válido." });

    const b = Number(boletos || 0);
    const { wb, rows, sheetName } = readRows();
    const idx = rows.findIndex(r => (r.Nombre||"").toString().trim().toLowerCase() === nombre.toLowerCase());
    if (idx === -1) return res.status(404).json({ ok: false, error: "Invitado no encontrado en el Excel." });

    const isNo = asistir === "no";
    let confirmados;
    if (isNo) {
      confirmados = 0;
    } else if (asistirRaw === "cambiar") {
      confirmados = isNaN(b) ? 0 : b;
    } else if (asistir === "si") {
      const assignedRaw = rows[idx].Boletos ?? rows[idx].BoletosAsignados ?? rows[idx]["Boletos Asignados"] ?? rows[idx].boletos ?? rows[idx].boletosAsignados;
      const assignedNum = Number(assignedRaw);
      confirmados = Number.isFinite(assignedNum) ? assignedNum : (Number.isFinite(b) ? b : 0);
    } else {
      confirmados = (isNaN(b) ? 0 : b);
    }

    // Escribir solo en "Mensaje" (se elimina uso de "Notas")
    rows[idx].Confirmacion = isNo ? "No asistirá" : "Asistirá";
    rows[idx].Confirmados = confirmados;
    if (mensaje !== undefined) rows[idx].Mensaje = mensaje.toString();
    rows[idx].RSVP_At = new Date().toISOString();

    await writeRows(rows, wb, sheetName);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    if (e && (e.code === 'EBUSY' || e.code === 'EPERM')) {
      return res.status(423).json({ ok: false, error: "El archivo de invitados está en uso (Excel/OneDrive). Ciérralo y vuelve a intentar." });
    }
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Admin data API (used by public/admin.html)
app.get("/api/admin/rows", requireAuth, (req, res) => {
  try {
    const { rows } = readRows();
    const mapped = rows.map(r => {
      const confirmados = (r.Confirmados ?? "");
      const mensaje = (r.Mensaje ?? "");
      const boletos = r.Boletos || r.BoletosAsignados || r["Boletos Asignados"] || r.boletos || r.boletosAsignados || "";
      const telefono =
        r.Telefono || r["Teléfono"] || r.Numero || r["Número"] || r.Celular || r.CELULAR ||
        r.WhatsApp || r.Whatsapp || r["WhatsApp"] || r["Whatsapp"] || "";
      return {
        Nombre: r.Nombre || "",
        Telefono: telefono,
        Confirmacion: r.Confirmacion || "Pendiente",
        Boletos: boletos,
        Confirmados: confirmados,
        Mensaje: mensaje,
        RSVP_At: r.RSVP_At || ""
      };
    });
    res.json({ ok: true, rows: mapped });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Admin API: Add new guest
app.post("/api/admin/add-guest", requireAuth, async (req, res) => {
  try {
    const { nombre, telefono, boletos } = req.body;
    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ ok: false, error: "El nombre es obligatorio" });
    }

    const { wb, rows, sheetName } = readRows();
    
    // Check if guest already exists
    const existing = rows.find(r => 
      (r.Nombre || "").toString().trim().toLowerCase() === nombre.trim().toLowerCase()
    );
    
    if (existing) {
      return res.status(400).json({ ok: false, error: "Ya existe un invitado con ese nombre" });
    }

    // Create new guest
    const newGuest = {
      Nombre: nombre.trim(),
      Telefono: telefono ? telefono.trim() : "",
      Confirmacion: "Pendiente",
      Boletos: Number(boletos) || 1,
      Confirmados: 0,
      Mensaje: "",
      RSVP_At: ""
    };

    rows.push(newGuest);
    await writeRows(rows, wb, sheetName);
    
    res.json({ ok: true, message: "Invitado agregado exitosamente" });
  } catch (e) {
    console.error("Error adding guest:", e);
    if (e && (e.code === 'EBUSY' || e.code === 'EPERM')) {
      return res.status(423).json({ 
        ok: false, 
        error: "El archivo de invitados está en uso (Excel/OneDrive). Ciérralo y vuelve a intentar." 
      });
    }
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Admin API: Download Excel file
app.get("/api/admin/download-excel", requireAuth, (req, res) => {
  try {
    console.log("Intentando descargar Excel desde:", EXCEL_PATH);
    
    if (!fs.existsSync(EXCEL_PATH)) {
      console.error("Archivo no encontrado en:", EXCEL_PATH);
      return res.status(404).send("Archivo no encontrado");
    }
    
    const fileName = path.basename(EXCEL_PATH);
    console.log("Enviando archivo:", fileName);
    
    res.setHeader('Content-Type', 'application/vnd.ms-excel');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    
    const fileStream = fs.createReadStream(EXCEL_PATH);
    fileStream.on('error', (err) => {
      console.error("Error al leer archivo:", err);
      if (!res.headersSent) {
        res.status(500).send("Error al leer el archivo");
      }
    });
    
    fileStream.pipe(res);
  } catch (e) {
    console.error("Error download excel:", e);
    if (!res.headersSent) {
      res.status(500).send("Error: " + e.message);
    }
  }
});

// Admin API: Upload Excel file
app.post("/api/admin/upload-excel", requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "No se recibió ningún archivo" });
    }

    const uploadedPath = req.file.path;
    
    // Validar que sea un archivo Excel válido
    try {
      const buf = fs.readFileSync(uploadedPath);
      const wb = xlsx.read(buf, { type: 'buffer' });
      
      if (!wb.SheetNames || wb.SheetNames.length === 0) {
        throw new Error("El archivo no contiene hojas válidas");
      }

      // Crear backup del archivo actual
      const backupPath = EXCEL_PATH.replace('.xls', `_backup_${Date.now()}.xls`);
      if (fs.existsSync(EXCEL_PATH)) {
        fs.copyFileSync(EXCEL_PATH, backupPath);
        console.log("Backup creado en:", backupPath);
      }

      // Reemplazar el archivo actual
      fs.copyFileSync(uploadedPath, EXCEL_PATH);
      
      // Limpiar archivo temporal
      fs.unlinkSync(uploadedPath);

      res.json({ 
        ok: true, 
        message: "Archivo Excel actualizado exitosamente",
        backup: backupPath
      });
    } catch (validationError) {
      // Limpiar archivo temporal si hay error
      if (fs.existsSync(uploadedPath)) {
        fs.unlinkSync(uploadedPath);
      }
      return res.status(400).json({ 
        ok: false, 
        error: "El archivo no es un Excel válido: " + validationError.message 
      });
    }
  } catch (e) {
    console.error("Error upload excel:", e);
    // Limpiar archivo temporal si hay error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Serve admin page as static HTML
app.get("/admin", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// API: estado del bot
app.get('/bot-status', (req, res) => {
    res.json({ started: botStarted });
});

// API: obtener QR actual
app.get('/bot-qr', (req, res) => {
    if (!botModule || !botModule.getLastQR) return res.json({ qr: null, ready: false });
    const qr = botModule.getLastQR();
    const ready = botModule.isReady ? botModule.isReady() : false;
    console.log('/bot-qr polled -> ready:', ready, 'qr present:', !!qr);
    res.json({ qr, ready });
});

// API: iniciar bot
app.post('/start-bot', (req, res) => {
  if (botStarted) return res.json({ success: true, message: 'Ya iniciado' });
  try {
    // cargar módulo del bot de forma opcional
    const candidates = [
      path.join(__dirname, 'bodaBot', 'index.js'),
      path.join(__dirname, 'index.js'),
    ];
    const found = candidates.find(p => fs.existsSync(p));
    if (!found) return res.status(404).json({ success: false, error: 'Bot no encontrado' });

    botModule = require(found);
    if (botModule && typeof botModule.iniciarBot === 'function') {
      botModule.iniciarBot((qr) => console.log('QR generado por bot:', !!qr));
      botStarted = true;
      const currentQR = botModule.getLastQR ? botModule.getLastQR() : null;
      return res.json({ success: true, qr: currentQR });
    }
    return res.status(500).json({ success: false, error: 'Módulo del bot inválido' });
  } catch (e) {
    return res.json({ success: false, error: e.message });
  }
});

// API: enviar mensaje por WhatsApp
app.post('/send-message', express.json(), async (req, res) => {
    try {
        if (!botModule || !botModule.isReady || !botModule.isReady()) {
            return res.status(400).json({ success: false, error: 'Bot no está listo' });
        }
        const { numero, texto } = req.body || {};
        if (!numero) return res.status(400).json({ success: false, error: 'Falta número' });
        const msgText = texto || '¡Hola! 🤖 BodaBot conectado. Gracias por tu confirmación.';
        await botModule.sendMessage(numero, msgText);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// API: enviar mensaje a todos los números del Excel
app.post('/send-all', express.json(), async (req, res) => {
    try {
        if (!botModule || !botModule.isReady || !botModule.isReady()) {
            return res.status(400).json({ success: false, error: 'Bot no está listo' });
        }
        const texto = (req.body && req.body.texto) || 'Nairobi Aranzazu Montes Águila \n & \n Marco Antonio Ramos Reynoso \n Tenemos el honor de invitarles a celebrar con nosotros el día en que uniremos nuestras vidas. \n Con mucho cariño hemos reservado _ lugares para ustedes. Agradeceremos confirmar su asistencia.';
    const personalizar = !!(req.body && req.body.personalizarAsignados);
    const { invitados } = leerInvitados();
        const allNumbers = invitados
            .map(inv => (inv && inv.Numero != null ? inv.Numero.toString() : ''))
            .map(n => (n || '').trim())
            .filter(n => !!n);
        // Quitar duplicados
        const unique = Array.from(new Set(allNumbers));
        let sent = 0;
        const failed = [];
        // Enviar en serie con pequeña pausa para evitar bloqueos
        for (const numero of unique) {
            try {
                // Encontrar invitado por número para personalizar
                const invitado = invitados.find(inv => (inv && inv.Numero != null) && inv.Numero.toString().trim() === numero);
                const asignados = invitado && (invitado.Boletos != null) ? String(invitado.Boletos) : '';
                const personalized = texto.replace(/_/g, asignados);
                // Validación básica de dígitos
                const digits = numero.replace(/\D/g, '');
                if (!digits) throw new Error('Número inválido');
                await botModule.sendMessage(digits, personalized);
                sent++;
                // pausa 700ms
                await new Promise(r => setTimeout(r, 700));
            } catch (e) {
                failed.push({ numero, error: e.message });
                // pequeña pausa también en fallos
                await new Promise(r => setTimeout(r, 400));
            }
        }
        res.json({ success: true, total: unique.length, sent, failed });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Guardar cambios desde admin
app.post("/admin/save", (req, res) => {
    const { workbook, invitados } = leerInvitados();

    const nuevos = invitados.map((inv, i) => ({
        Nombre: req.body[`nombre_${i}`] ?? inv.Nombre,
        Numero: req.body[`numero_${i}`] ?? inv.Numero,
      Boletos: parseInt(req.body[`asignados_${i}`] ?? inv.Boletos),
        BoletosConfirmados: req.body[`confirmados_${i}`]
            ? parseInt(req.body[`confirmados_${i}`])
            : inv.BoletosConfirmados ?? ""
    }));

    guardarInvitados(nuevos, workbook);
    res.redirect("/admin");
});

app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
  autoBackup();
});

// ===== WhatsApp BOT (legacy) =====
// Elimina el bloque legacy que hacía require('./index.js') y duplicaba rutas.
// Antes:
//   const qrcode = require('qrcode-terminal');
//   const { iniciarBot, getLastQR, isReady, sendMessage } = require('./index.js');
//   app.get("/start-bot", ...)
//   app.get("/bot-qr", ...)
//   app.post("/send-message", ...)
//   app.post("/send-all", ...)
//   ... y el bloque "Inicia bot opcionalmente (si existe)"
// Reemplázalo por este loader opcional que no truena si el bot no existe:

(function initOptionalBot() {
  try {
    const candidates = [
      path.join(__dirname, 'bodaBot', 'index.js'),
      path.join(__dirname, 'index.js'),
    ];
    const found = candidates.find(p => fs.existsSync(p));
    if (found) {
      botModule = require(found);
      console.log('Bot cargado desde:', found);
    } else {
      console.log('Bot no encontrado (opcional). Continuando solo con el servidor web.');
    }
  } catch (e) {
    console.warn('No se pudo cargar el bot (opcional):', e.message);
  }
})();