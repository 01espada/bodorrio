const fs = require("fs");
const xlsx = require("xlsx");
const { Client, LocalAuth } = require("whatsapp-web.js");

const client = new Client({
    authStrategy: new LocalAuth(), // mantiene sesión indefinida
    puppeteer: { headless: true }  // sin abrir ventana
});

// ====================
// 🔹 Utilidades Excel
// ====================
function leerInvitados() {
    const workbook = xlsx.readFile("invitados.xlsx");
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return { workbook, invitados: xlsx.utils.sheet_to_json(sheet) };
}

function guardarInvitados(invitados, workbook) {
    const newSheet = xlsx.utils.json_to_sheet(invitados);
    workbook.Sheets[workbook.SheetNames[0]] = newSheet;
    xlsx.writeFile(workbook, "invitados.xlsx");
}

function marcarAsistencia(numero, estado) {
    const { workbook, invitados } = leerInvitados();

    let actualizado = false;
    invitados.forEach(inv => {
        if (inv.Numero.toString() === numero.replace("@c.us", "")) {
            inv.Confirmacion = estado;
            actualizado = true;
        }
    });

    if (actualizado) guardarInvitados(invitados, workbook);
}

// ====================
// 🔹 Lógica de envío
// ====================
async function enviarInvitaciones() {
    const { invitados } = leerInvitados();

    for (let i = 0; i < invitados.length; i++) {
        const inv = invitados[i];
        let numero = inv.Numero.toString() + "@c.us";
        let mensaje = `Hola ${inv.Nombre} 🎉\n\n¡Estás invitado a nuestra boda 💍!\n\n📅 Fecha: 12 de diciembre\n📍 Lugar: Hacienda XYZ\n\nPor favor responde con *Sí* o *No* para confirmar tu asistencia.`;

        try {
            await client.sendMessage(numero, mensaje);
            console.log(`✅ Invitación enviada a ${inv.Nombre} (${inv.Numero})`);
        } catch (err) {
            console.log(`❌ Error enviando a ${inv.Nombre}:`, err);
        }

        // Esperar 5 segundos entre mensajes (ajústalo a gusto)
        await new Promise(res => setTimeout(res, 5000));
    }
}

// ====================
// 🔹 Eventos WhatsApp
// ====================
client.on("qr", qr => {
    console.log("📱 Escanea este QR con tu WhatsApp:");
    console.log(qr);
});

client.on("ready", () => {
    console.log("🤖 Bot listo y conectado a WhatsApp!");
    // Descomenta la siguiente línea solo cuando quieras enviar todas las invitaciones:
    // enviarInvitaciones();
});

client.on("disconnected", reason => {
    console.log("⚠️ Cliente desconectado:", reason);
});

client.on("message", msg => {
    let texto = msg.body.toLowerCase().trim();

    if (texto === "sí" || texto === "si") {
        marcarAsistencia(msg.from, "Asistirá");
        msg.reply("¡Gracias por confirmar tu asistencia! 🎉💍");
    } else if (texto === "no") {
        marcarAsistencia(msg.from, "No asistirá");
        msg.reply("Gracias, registramos que no podrás asistir 🙏");
    }
});

client.initialize();
