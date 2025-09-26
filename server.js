const express = require("express");
const path = require("path");
const fs = require("fs");
const xlsx = require("xlsx");
const cors = require("cors");

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

function readRows() {
  const wb = xlsx.readFile(EXCEL_PATH);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: "" });
  return { wb, rows, sheetName: wb.SheetNames[0] };
}

// Reintentos para evitar EBUSY/EPERM al escribir en OneDrive/Excel
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function safeWriteWorkbook(wb, destPath) {
  const dir = path.dirname(destPath);
  let lastErr = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const tmp = path.join(dir, `.~invitados_${Date.now()}_${attempt}.xls`);
    try {
      // Escribe a un archivo temporal primero
      xlsx.writeFile(wb, tmp);
      // Intenta reemplazar el destino
      try { fs.rmSync(destPath, { force: true }); } catch {}
      fs.renameSync(tmp, destPath);
      return; // éxito
    } catch (err) {
      lastErr = err;
      try { fs.rmSync(tmp, { force: true }); } catch {}
      if (err && (err.code === 'EBUSY' || err.code === 'EPERM')) {
        await sleep(250 * attempt); // backoff
        continue;
      }
      throw err;
    }
  }
  const e = new Error('Archivo Excel en uso, intenta de nuevo.');
  e.code = 'EBUSY';
  throw e;
}

// Cambiar a async para usar safeWriteWorkbook
async function writeRows(rows, wb, sheetName) {
  const ws = xlsx.utils.json_to_sheet(rows);
  wb.Sheets[sheetName] = ws;
  await safeWriteWorkbook(wb, EXCEL_PATH);
}

// ===== Middleware =====
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static index.html from root or /public if present
const staticDir = fs.existsSync(path.join(__dirname, "public")) ? "public" : "";
if (staticDir) app.use("/", express.static(path.join(__dirname, "public")));
app.use("/", express.static(__dirname));

// ===== API =====
// Ruta para servir el formulario de asistencia
app.get('/asistencia', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'asistencia.html'));
});

// Dev: quick check path
app.get("/api/info", (req, res) => {
  res.json({ excelPath: EXCEL_PATH });
});

// Lista de invitados (incluye confirmados)
app.get("/api/invitados", (req, res) => {
  try {
    const { rows } = readRows();
    const invitados = rows.map(r => {
      const asign = r.BoletosAsignados ?? r.Boletos ?? r["Boletos Asignados"] ?? r.boletos ?? r.boletosAsignados;
      const conf = r.Confirmados;
      return {
        nombre: (r.Nombre || "").toString().trim(),
        boletosAsignados: Number.isFinite(Number(asign)) ? Number(asign) : null,
        confirmados: Number.isFinite(Number(conf)) ? Number(conf) : 0
      };
    }).filter(i => i.nombre);
    res.json({ ok: true, invitados });
  } catch (e) {
    console.error(e);
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
    } else if (asistir === "si") {
      const assignedRaw = rows[idx].BoletosAsignados ?? rows[idx].Boletos ?? rows[idx]["Boletos Asignados"] ?? rows[idx].boletos ?? rows[idx].boletosAsignados;
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
app.get("/api/admin/rows", (req, res) => {
  try {
    const { rows } = readRows();
    const mapped = rows.map(r => {
      const confirmados = (r.Confirmados ?? "");
      const mensaje = (r.Mensaje ?? "");
      const boletosAsignados = (r.BoletosAsignados ?? r.Boletos ?? r["Boletos Asignados"] ?? "");
      const telefono =
        r.Telefono ?? r["Teléfono"] ?? r.Numero ?? r["Número"] ?? r.Celular ?? r.CELULAR ??
        r.WhatsApp ?? r.Whatsapp ?? r["WhatsApp"] ?? r["Whatsapp"] ?? "";
      return {
        Nombre: r.Nombre || "",
        Telefono: telefono,                              // ← devolver Telefono
        Confirmacion: r.Confirmacion || "Pendiente",
        BoletosAsignados: boletosAsignados,
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

// Serve admin page as static HTML
app.get("/admin", (req, res) => {
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
        botModule = require('./bodaBot/index.js');
        // pasar callback para recibir notificaciones de QR y loguearlas
        botModule.iniciarBot((qr) => {
            console.log('QR generado por bot:', !!qr);
        });
        botStarted = true;
        // devolver el QR actual si existe
        const currentQR = botModule.getLastQR ? botModule.getLastQR() : null;
        res.json({ success: true, qr: currentQR });
    } catch (e) {
        res.json({ success: false, error: e.message });
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
                const asignados = invitado && (invitado.BoletosAsignados != null) ? String(invitado.BoletosAsignados) : '';
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
        BoletosAsignados: parseInt(req.body[`asignados_${i}`] ?? inv.BoletosAsignados),
        BoletosConfirmados: req.body[`confirmados_${i}`]
            ? parseInt(req.body[`confirmados_${i}`])
            : inv.BoletosConfirmados ?? ""
    }));

    guardarInvitados(nuevos, workbook);
    res.redirect("/admin");
});

app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
});

// ...existing code (dentro del handler de GET /admin, justo después de abrir el <form> antes de <table>)...
    html += `
    <div id="statsResumen" style="
        display:flex;
        flex-wrap:wrap;
        gap:14px;
        margin:18px 0 14px;
        padding:14px 18px;
        background:#ffffff;
        border:1px solid #d9dfd1;
        border-radius:12px;
        font-size:.95rem;
        color:#4a5a3a;
        box-shadow:0 2px 6px rgba(0,0,0,.05);
    ">
        <span><b>Total:</b> ${invitados.length}</span>
        <span><b>Pendientes:</b> ${
            invitados.filter(i => i.BoletosConfirmados === '' || i.BoletosConfirmados === undefined || i.BoletosConfirmados === null).length
        }</span>
        <span><b>Irán:</b> ${
            invitados.filter(i => {
                const v = parseInt(i.BoletosConfirmados,10);
                return !isNaN(v) && v > 0;
            }).length
        }</span>
        <span><b>No irán:</b> ${
            invitados.filter(i => {
                // Se considera "No irán" cuando explícitamente está 0 (distinto de vacío)
                return (i.BoletosConfirmados !== '' && i.BoletosConfirmados !== null && i.BoletosConfirmados !== undefined) &&
                       (parseInt(i.BoletosConfirmados,10) === 0);
            }).length
        }</span>
    </div>
    <table id="invitadosTable">
        <tr>
            <th>Nombre</th>
            <th>Número</th>
            <th>Boletos Asignados</th>
            <th>Boletos Confirmados</th>
        </tr>`;
// ...existing code...
