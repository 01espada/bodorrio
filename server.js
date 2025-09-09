const express = require("express");
const path = require("path");
const xlsx = require("xlsx");

const app = express();
const PORT = 3000;

// Ruta para la invitación (index.html)
app.use("/", express.static(path.join(__dirname, "public")));

// Ruta para ver invitados en /admin
app.get("/admin", (req, res) => {
    // Leer Excel
    const workbook = xlsx.readFile(path.join(__dirname, "bodaBot", "invitados.xlsx"));
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const invitados = xlsx.utils.sheet_to_json(sheet);

    // Generar tabla HTML
    let html = `
    <html>
    <head>
        <meta charset="utf-8">
        <title>Panel de Invitados</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 20px; background: #f9f9f9; }
            h1 { text-align: center; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; background: white; }
            th, td { border: 1px solid #ccc; padding: 10px; text-align: left; }
            th { background: #f4f4f4; }
            tr:nth-child(even) { background: #fdfdfd; }
            .ok { color: green; font-weight: bold; }
            .no { color: red; font-weight: bold; }
        </style>
    </head>
    <body>
        <h1>Lista de Invitados</h1>
        <table>
            <tr>
                <th>Nombre</th>
                <th>Número</th>
                <th>Confirmación</th>
            </tr>`;

    invitados.forEach(inv => {
        html += `
            <tr>
                <td>${inv.Nombre}</td>
                <td>${inv.Numero}</td>
                <td class="${inv.Confirmacion === "Asistirá" ? "ok" : (inv.Confirmacion === "No asistirá" ? "no" : "")}">
                    ${inv.Confirmacion || "Pendiente"}
                </td>
            </tr>`;
    });

    html += `</table></body></html>`;
    res.send(html);
});

app.listen(PORT, () => {
    console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
});
