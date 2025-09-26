const btn = document.getElementById('startBotBtn');
const statusDiv = document.getElementById('botStatus');
let qrDiv = null;

// Debug helper: botón para forzar mostrar la sección de envío
function addDebugShowButton() {
    try {
        const adminContainer = document.querySelector('.admin-container');
        if (!adminContainer) return;
        if (document.getElementById('showSendDebugBtn')) return;
        const b = document.createElement('button');
        b.id = 'showSendDebugBtn';
        b.textContent = 'Mostrar sección de envío (debug)';
        b.style.marginLeft = '12px';
        b.style.padding = '8px 12px';
        b.style.fontSize = '0.9rem';
        b.style.background = '#ddd';
        b.style.border = '1px solid #ccc';
        b.style.borderRadius = '8px';
        b.style.cursor = 'pointer';
        b.onclick = () => {
            try { mostrarQR(); } catch(e){}
            const qrSection = document.getElementById('qrSection');
            const sendSection = document.getElementById('sendSection');
            if (qrSection) qrSection.style.display = 'none';
            if (sendSection) sendSection.style.display = 'block';
        };
        adminContainer.appendChild(b);
    } catch (e) {}
}

// Agregar botón debug al cargar el script
setTimeout(addDebugShowButton, 400);

function mostrarQR() {
    if (!qrDiv) {
        qrDiv = document.createElement('div');
        qrDiv.id = 'qrDiv';
        qrDiv.style.marginTop = '30px';

        // QR section
        const qrSection = document.createElement('div');
        qrSection.id = 'qrSection';
        const qrTitle = document.createElement('div');
        qrTitle.innerHTML = '<b>Escanea el QR con WhatsApp:</b>';
        const qrBox = document.createElement('div');
        qrBox.id = 'qrBox';
        qrBox.style.marginTop = '8px';
        qrSection.appendChild(qrTitle);
        qrSection.appendChild(qrBox);

        // Send section (hidden until ready)
        const sendSection = document.createElement('div');
        sendSection.id = 'sendSection';
        sendSection.style.display = 'none';
        sendSection.style.marginTop = '16px';
        sendSection.style.textAlign = 'left';
        sendSection.style.maxWidth = '720px';
        sendSection.style.marginLeft = 'auto';
        sendSection.style.marginRight = 'auto';

        const actionsTitle = document.createElement('div');
        actionsTitle.style.marginBottom = '12px';
        actionsTitle.style.fontWeight = '600';
        actionsTitle.style.color = '#4a5a3a';
        actionsTitle.textContent = 'Acciones rápidas';

        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.gap = '8px';
        row.style.flexWrap = 'wrap';

        const numeroInput = document.createElement('input');
        numeroInput.id = 'numeroInput';
        numeroInput.placeholder = 'Número e.g. 523331112233';
        numeroInput.style.padding = '8px';
        numeroInput.style.border = '1px solid #ccc';
        numeroInput.style.borderRadius = '6px';
        numeroInput.style.width = '260px';

        const sendBtn = document.createElement('button');
        sendBtn.id = 'sendBtn';
        sendBtn.textContent = 'Enviar a un número';
        sendBtn.style.padding = '10px 16px';
        sendBtn.style.background = '#8b9b6a';
        sendBtn.style.color = 'white';
        sendBtn.style.border = 'none';
        sendBtn.style.borderRadius = '8px';
        sendBtn.style.cursor = 'pointer';

        row.appendChild(numeroInput);
        row.appendChild(sendBtn);

        const msgLabel = document.createElement('label');
        msgLabel.htmlFor = 'mensajeAll';
        msgLabel.style.display = 'block';
        msgLabel.style.marginTop = '16px';
        msgLabel.style.marginBottom = '6px';
        msgLabel.style.color = '#4a5a3a';
        msgLabel.textContent = 'Mensaje para todos:';

        const mensajeAll = document.createElement('textarea');
        mensajeAll.id = 'mensajeAll';
        mensajeAll.rows = 3;
        mensajeAll.style.width = '100%';
        mensajeAll.style.padding = '8px';
        mensajeAll.style.border = '1px solid #ccc';
        mensajeAll.style.borderRadius = '8px';
        mensajeAll.value = 'Con mucho cariño hemos reservado _ lugares para ustedes.\nAgradeceremos confirmar su asistencia.';

        const advice = document.createElement('div');
        advice.style.marginTop = '6px';
        advice.style.color = '#6b7b5a';
        advice.style.fontSize = '0.9rem';
        advice.textContent = 'Consejo: usa "_" para insertar los boletos asignados de cada invitado.';

        const controls = document.createElement('div');
        controls.style.marginTop = '8px';
        controls.style.display = 'flex';
        controls.style.gap = '12px';
        controls.style.alignItems = 'center';
        controls.style.flexWrap = 'wrap';

        const labelChk = document.createElement('label');
        labelChk.style.display = 'flex';
        labelChk.style.alignItems = 'center';
        labelChk.style.gap = '6px';
        labelChk.style.color = '#4a5a3a';

        const chkPersonalizar = document.createElement('input');
        chkPersonalizar.type = 'checkbox';
        chkPersonalizar.id = 'chkPersonalizar';
        chkPersonalizar.checked = true;
        labelChk.appendChild(chkPersonalizar);
        labelChk.appendChild(document.createTextNode('Personalizar "_" con boletos asignados'));

        const sendAllBtn = document.createElement('button');
        sendAllBtn.id = 'sendAllBtn';
        sendAllBtn.textContent = 'Enviar a todos los invitados';
        sendAllBtn.style.padding = '10px 16px';
        sendAllBtn.style.background = '#6b7b5a';
        sendAllBtn.style.color = 'white';
        sendAllBtn.style.border = 'none';
        sendAllBtn.style.borderRadius = '8px';
        sendAllBtn.style.cursor = 'pointer';

        const sendAllStatus = document.createElement('span');
        sendAllStatus.id = 'sendAllStatus';
        sendAllStatus.style.color = '#6b7b5a';

        controls.appendChild(labelChk);
        controls.appendChild(sendAllBtn);
        controls.appendChild(sendAllStatus);

        // Attach handlers immediately so buttons work even before bot reports ready
        sendBtn.onclick = async () => {
            sendBtn.disabled = true;
            sendStatus.textContent = 'Enviando...';
            try {
                const numeroVal = (numeroInput.value || '').trim();
                if (!numeroVal) {
                    sendStatus.textContent = 'Ingrese un número válido primero.';
                    sendBtn.disabled = false;
                    return;
                }
                // Check bot ready state via /bot-qr
                const st = await fetch('/bot-qr').then(r=>r.json()).catch(()=>({ready:false}));
                if (!st.ready) {
                    sendStatus.textContent = 'Bot no está listo. Escanee el QR primero.';
                    sendBtn.disabled = false;
                    return;
                }
                const resp = await fetch('/send-message', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ numero: numeroVal, texto: '¡Hola! 🤖 BodaBot conectado. Gracias por confirmar.' })
                });
                const js = await resp.json();
                if (js.success) sendStatus.textContent = 'Mensaje enviado ✅';
                else sendStatus.textContent = 'Error: ' + (js.error || '');
            } catch (err) {
                sendStatus.textContent = 'Error: ' + (err.message || err);
            }
            sendBtn.disabled = false;
        };

        sendAllBtn.onclick = async () => {
            if (!confirm('¿Enviar el mensaje a TODOS los números del Excel?')) return;
            sendAllBtn.disabled = true;
            sendAllStatus.textContent = 'Enviando a todos...';
            try {
                const resp = await fetch('/send-all', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ texto: mensajeAll.value, personalizarAsignados: !!chkPersonalizar.checked })
                });
                const js = await resp.json();
                if (js.success) {
                    sendAllStatus.textContent = 'Listo ✅ Enviados: ' + js.sent + '/' + js.total + (js.failed && js.failed.length ? ' | Fallidos: ' + js.failed.length : '');
                } else {
                    sendAllStatus.textContent = 'Error: ' + (js.error || '');
                }
            } catch (err) {
                sendAllStatus.textContent = 'Error: ' + (err.message || err);
            }
            sendAllBtn.disabled = false;
        };

        const sendStatus = document.createElement('div');
        sendStatus.id = 'sendStatus';
        sendStatus.style.marginTop = '12px';
        sendStatus.style.color = '#6b7b5a';

        sendSection.appendChild(actionsTitle);
        sendSection.appendChild(row);
        sendSection.appendChild(msgLabel);
        sendSection.appendChild(mensajeAll);
        sendSection.appendChild(advice);
        sendSection.appendChild(controls);
        sendSection.appendChild(sendStatus);

        qrDiv.appendChild(qrSection);
        qrDiv.appendChild(sendSection);
        document.querySelector('.admin-container').appendChild(qrDiv);
    }

    let qrInterval = null;
    function startQRPolling() {
        if (qrInterval) return;
        qrInterval = setInterval(() => {
            fetch('/bot-qr').then(r => r.json()).then(data => {
                if (data.ready) {
                    clearInterval(qrInterval);
                    qrInterval = null;
                    statusDiv.textContent = 'Bot listo y conectado ✅';
                    const qrSection = document.getElementById('qrSection');
                    const sendSection = document.getElementById('sendSection');
                    if (qrSection) qrSection.style.display = 'none';
                    if (sendSection) sendSection.style.display = 'block';

                    const sendBtnEl = document.getElementById('sendBtn');
                    const numeroInputEl = document.getElementById('numeroInput');
                    const sendStatusEl = document.getElementById('sendStatus');
                    const sendAllBtnEl = document.getElementById('sendAllBtn');
                    const sendAllStatusEl = document.getElementById('sendAllStatus');
                    const mensajeAllEl = document.getElementById('mensajeAll');
                    const chkPersonalizarEl = document.getElementById('chkPersonalizar');

                    sendBtnEl.onclick = async () => {
                        sendBtnEl.disabled = true;
                        sendStatusEl.textContent = 'Enviando...';
                        try {
                            const numeroVal = (numeroInputEl.value || '').trim();
                            if (!numeroVal) {
                                sendStatusEl.textContent = 'Ingrese un número válido primero.';
                                sendBtnEl.disabled = false;
                                return;
                            }
                            const st = await fetch('/bot-qr').then(r=>r.json()).catch(()=>({ready:false}));
                            if (!st.ready) {
                                sendStatusEl.textContent = 'Bot no está listo. Escanee el QR primero.';
                                sendBtnEl.disabled = false;
                                return;
                            }
                            const resp = await fetch('/send-message', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ numero: numeroVal, texto: '¡Hola! 🤖 BodaBot conectado. Gracias por confirmar.' })
                            });
                            const js = await resp.json();
                            if (js.success) sendStatusEl.textContent = 'Mensaje enviado ✅';
                            else sendStatusEl.textContent = 'Error: ' + (js.error || '');
                        } catch (err) {
                            sendStatusEl.textContent = 'Error: ' + err.message;
                        }
                        sendBtnEl.disabled = false;
                    };

                    sendAllBtnEl.onclick = async () => {
                        if (!confirm('¿Enviar el mensaje a TODOS los números del Excel?')) return;
                        sendAllBtnEl.disabled = true;
                        sendAllStatusEl.textContent = 'Enviando a todos...';
                        try {
                            const st = await fetch('/bot-qr').then(r=>r.json()).catch(()=>({ready:false}));
                            if (!st.ready) {
                                sendAllStatusEl.textContent = 'Bot no está listo. Escanee el QR primero.';
                                sendAllBtnEl.disabled = false;
                                return;
                            }
                            const resp = await fetch('/send-all', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ texto: mensajeAllEl.value, personalizarAsignados: !!chkPersonalizarEl.checked })
                            });
                            const js = await resp.json();
                            if (js.success) {
                                sendAllStatusEl.textContent = 'Listo ✅ Enviados: ' + js.sent + '/' + js.total + (js.failed && js.failed.length ? ' | Fallidos: ' + js.failed.length : '');
                            } else {
                                sendAllStatusEl.textContent = 'Error: ' + (js.error || '');
                            }
                        } catch (err) {
                            sendAllStatusEl.textContent = 'Error: ' + err.message;
                        }
                        sendAllBtnEl.disabled = false;
                    };

                    return;
                }
                if (data.qr) {
                    const box = document.getElementById('qrBox');
                    if (box) {
                            box.innerHTML = '';
                            try {
                                if (window.QRCode) {
                                    new QRCode(box, { text: data.qr, width: 220, height: 220 });
                                } else {
                                    // Fallback: use Google Chart API to render QR as image
                                    const img = document.createElement('img');
                                    img.alt = 'QR code';
                                    img.width = 220;
                                    img.height = 220;
                                    img.src = 'https://chart.googleapis.com/chart?chs=220x220&cht=qr&chl=' + encodeURIComponent(data.qr);
                                    box.appendChild(img);
                                    // also show raw QR for debugging (not for scanning, but useful to verify content)
                                    const pre = document.createElement('pre');
                                    pre.style.fontSize = '10px';
                                    pre.style.marginTop = '8px';
                                    pre.textContent = data.qr;
                                    box.appendChild(pre);
                                }
                            } catch (e) {
                                box.textContent = 'Error renderizando QR: ' + (e && e.message);
                            }
                        }
                }
            }).catch(()=>{});
        }, 1500);
    }
    startQRPolling();
}

// Estado inicial
fetch('/bot-status').then(r=>r.json()).then(data=>{
    if(data.started){
        btn.disabled = true;
        statusDiv.textContent = 'Bot iniciado ✅';
        mostrarQR();
    }
});

btn.addEventListener('click', async () => {
    btn.disabled = true;
    statusDiv.textContent = 'Iniciando bot...';
    try {
        const res = await fetch('/start-bot', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            statusDiv.textContent = 'Bot iniciado ✅';
            mostrarQR();
        } else {
            statusDiv.textContent = 'Error al iniciar el bot';
            btn.disabled = false;
        }
    } catch (e) {
        statusDiv.textContent = 'Error de conexión';
        btn.disabled = false;
    }
});
