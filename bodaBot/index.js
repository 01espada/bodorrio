const fs = require("fs");
const xlsx = require("xlsx");
const { Client, LocalAuth } = require("whatsapp-web.js");


// ====================
// 🔹 Utilidades Excel
// ====================
function leerInvitados() {
    const workbook = xlsx.readFile("invitados.xls");
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return { workbook, invitados: xlsx.utils.sheet_to_json(sheet) };
}

function guardarInvitados(invitados, workbook) {
    const newSheet = xlsx.utils.json_to_sheet(invitados);
    workbook.Sheets[workbook.SheetNames[0]] = newSheet;
    xlsx.writeFile(workbook, "invitados.xls");
}

function actualizarBoletos(numero, confirmados) {
    const { workbook, invitados } = leerInvitados();

    invitados.forEach(inv => {
        if (inv.Numero.toString() === numero.replace("@c.us", "")) {
            inv.BoletosConfirmados = confirmados;
        }
    });

    guardarInvitados(invitados, workbook);
}

// ====================
// 🔹 Lógica WhatsApp
// ====================
let lastQR = null;
let client = null;
let ready = false;
let _handlersInstalled = false;

function iniciarBot(qrCallback) {
    if (client) return; // Ya iniciado
    // instalar manejadores globales una sola vez para evitar que errores no capturados
    // terminen el proceso cuando ocurren errores en puppeteer/whatsapp-web.js
    if (!_handlersInstalled) {
        _handlersInstalled = true;
        process.on('unhandledRejection', (reason, promise) => {
            console.error('UnhandledRejection en bodaBot:', reason && (reason.stack || reason.message || reason));
            if (client) {
                try { client.destroy && client.destroy(); } catch (e) {}
                client = null; ready = false;
                setTimeout(() => { try { iniciarBot(); } catch (e) { console.error('Retry after unhandledRejection failed:', e && e.message); } }, 5000);
            }
        });

        process.on('uncaughtException', (err) => {
            console.error('UncaughtException en bodaBot:', err && (err.stack || err.message || err));
            if (client) {
                try { client.destroy && client.destroy(); } catch (e) {}
                client = null; ready = false;
                setTimeout(() => { try { iniciarBot(); } catch (e) { console.error('Retry after uncaughtException failed:', e && e.message); } }, 5000);
            }
        });
    }
    client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu'
            ]
        }
    });

    client.on("message", msg => {
        let texto = msg.body.trim().toLowerCase();
        const { invitados } = leerInvitados();
        let invitado = invitados.find(inv => inv.Numero.toString() === msg.from.replace("@c.us", ""));
        if (!invitado) return;
        if (texto === "todos") {
            actualizarBoletos(msg.from, invitado.BoletosAsignados);
            msg.reply(`¡Gracias! 🎉 Hemos confirmado tus ${invitado.BoletosAsignados} boletos.`);
        } else if (!isNaN(parseInt(texto))) {
            let num = parseInt(texto);
            if (num > invitado.BoletosAsignados) {
                msg.reply(`⚠️ Solo tienes ${invitado.BoletosAsignados} boletos asignados. Por favor indica un número válido.`);
            } else {
                actualizarBoletos(msg.from, num);
                msg.reply(`¡Gracias! 🎉 Hemos confirmado ${num} boleto(s) para ti.`);
            }
        } else {
            msg.reply("Por favor responde con *Todos* si van todos tus boletos, o con un número (ej. 2) para indicar cuántos asistirán.");
        }
    });

    client.on("qr", qr => {
        lastQR = qr;
        if (typeof qrCallback === 'function') qrCallback(qr);
        console.log("📱 Escanea este QR con tu WhatsApp:");
        console.log(qr);
    });

    client.on("ready", () => {
        ready = true;
        console.log("🤖 Bot listo y conectado a WhatsApp!");
    });

    client.on('disconnected', (reason) => {
        ready = false;
        console.log('⚠️ Bot desconectado:', reason);
        // intentamos reiniciar tras un corto retardo
        try {
            client && client.destroy && client.destroy();
        } catch (e) {}
        client = null;
        // reintentar iniciar en 5s
        setTimeout(() => {
            try {
                iniciarBot();
            } catch (e) {
                console.error('Error re-iniciando bot:', e && e.message);
            }
        }, 5000);
    });

    // initialize with basic protection against synchronous throws
    try {
        client.initialize();
    } catch (err) {
        console.error('Error during client.initialize():', err && err.message);
        // cleanup and schedule a retry
        try { client && client.destroy && client.destroy(); } catch (e) {}
        client = null;
        setTimeout(() => {
            try { iniciarBot(qrCallback); } catch (e) { console.error('Retry iniciarBot failed:', e && e.message); }
        }, 5000);
    }
}

function getLastQR() {
    return lastQR;
}

function isReady() {
    return ready;
}

async function sendMessage(numeroE164, text) {
    if (!client || !ready) throw new Error("Bot no está listo");
    const digits = (numeroE164 || "").toString().replace(/\D/g, "");
    if (!digits) throw new Error("Número inválido");
    const chatId = digits.endsWith("@c.us") ? digits : `${digits}@c.us`;
    return client.sendMessage(chatId, text || "");
}

module.exports = { iniciarBot, getLastQR, isReady, sendMessage };
