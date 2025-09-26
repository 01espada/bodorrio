const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");
const xlsx = require("xlsx");

const app = express();
const PORT = 3000;

app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.urlencoded({ extended: true }));

// Estado del bot
let botStarted = false;
let botModule = null;

// Leer invitados
function leerInvitados() {
    const workbook = xlsx.readFile(path.join(__dirname, "bodaBot", "invitados.xls"));
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return { workbook, invitados: xlsx.utils.sheet_to_json(sheet) };
}

// Guardar invitados
function guardarInvitados(invitados, workbook) {
    const newSheet = xlsx.utils.json_to_sheet(invitados);
    workbook.Sheets[workbook.SheetNames[0]] = newSheet;
    xlsx.writeFile(workbook, path.join(__dirname, "bodaBot", "invitados.xls"));
}

// Página admin (lista + botón bot + QR)
app.get("/admin", (req, res) => {
    const { invitados } = leerInvitados();

    const rows = invitados
        .map((inv, i) => `
            <tr>
                <td>${inv.Nombre ?? ""}</td>
                <td>${inv.Numero ?? ""}</td>
                <td>${inv.BoletosAsignados ?? ""}</td>
                <td><input type="number" name="confirmados_${i}" value="${inv.BoletosConfirmados ?? ""}"></td>
                <input type="hidden" name="nombre_${i}" value="${inv.Nombre ?? ""}">
                <input type="hidden" name="numero_${i}" value="${inv.Numero ?? ""}">
                <input type="hidden" name="asignados_${i}" value="${inv.BoletosAsignados ?? ""}">
            </tr>`)
        .join("");

    const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Panel de Invitados y Bot</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f9f9f9; }
        table { width: 100%; border-collapse: collapse; background: white; }
        th, td { border: 1px solid #ccc; padding: 10px; text-align: center; }
        th { background: #eee; }
        input { width: 60px; text-align: center; }
        button { padding: 6px 12px; margin-top: 10px; }
        .admin-container { background: white; padding: 30px 20px; border-radius: 16px; box-shadow: 0 8px 32px rgba(0,0,0,0.12); text-align: center; margin-bottom: 30px; }
        .bot-btn { padding: 15px 30px; font-size: 1.1rem; background: linear-gradient(135deg, #8b9b6a 0%, #a0b070 100%); color: white; border: none; border-radius: 10px; cursor: pointer; font-weight: 600; transition: all 0.3s ease; }
        .bot-btn:disabled { background: #bfc9b0; cursor: not-allowed; }
        .status { margin-top: 20px; font-size: 1rem; color: #6b7b5a; }
    </style>
</head>
<body>
    <div class="admin-container">
        <div class="admin-title" style="font-size:2rem;color:#6b7b5a;margin-bottom:20px;">Panel de Administración</div>
        <button id="startBotBtn" class="bot-btn">Iniciar Bot de WhatsApp</button>
        <div class="status" id="botStatus">Bot no iniciado</div>
    </div>
    <h1>Lista de Invitados</h1>
    <form method="POST" action="/admin/save">
    <table>
        <tr>
            <th>Nombre</th>
            <th>Número</th>
            <th>Boletos Asignados</th>
            <th>Boletos Confirmados</th>
        </tr>
        ${rows}
    </table>
    <button type="submit">💾 Guardar cambios</button>
    </form>

    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
    <script src="/admin.js"></script>
</body>
</html>`;

    res.send(html);
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
