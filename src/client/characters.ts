

// MAGO
function drawPersonaggio13(ctx: CanvasRenderingContext2D, x, y, w, h, style: any = {}) {
    ctx.save();
    // Sposta l'origine (x=0, y=0) al centro del personaggio
    ctx.translate(x, y);
    const startX = -w / 2;
    const startY = -h / 2;

    // Definiamo le proporzioni per farci stare tutto
    const hatH = h * 0.25;
    const headH = h * 0.15;
    const bodyH = h * 0.50;
    const feetH = h * 0.10;

    const robeColor = style.robeColor || "#2c1b4d"; // Viola scuro per la tunica
    const skinColor = style.skinColor || "#eaa66e";
    const magicColor = style.magicColor || "#00e5ff"; // Ciano brillante per la magia

    // +BASTONE MAGICO (Dietro il corpo, lato destro)
    const staffX = startX + w * 1.2;
    // Asta di legno
    ctx.beginPath();
    ctx.fillStyle = "#5c4033"; // Marrone scuro
    ctx.rect(staffX, startY + hatH * 0.5, w * 0.15, h * 0.85);
    ctx.fill();
    // Gemma magica (Esterna)
    ctx.beginPath();
    ctx.fillStyle = "#008b8b"; // Ciano scuro
    ctx.rect(staffX - w * 0.075, startY + hatH * 0.1, w * 0.3, hatH * 0.5);
    ctx.fill();
    // Gemma magica (Luce interna)
    ctx.beginPath();
    ctx.fillStyle = magicColor; 
    ctx.rect(staffX - w * 0.025, startY + hatH * 0.15, w * 0.2, hatH * 0.3);
    ctx.fill();
    // -bastone

    // +CAPPELLO (A strati per fare la punta)
    ctx.beginPath();
    ctx.fillStyle = robeColor;
    // Punta del cappello
    ctx.rect(startX + w * 0.35, startY, w * 0.3, hatH * 0.4);
    // Centro del cappello
    ctx.rect(startX + w * 0.15, startY + hatH * 0.4, w * 0.7, hatH * 0.4);
    // Tesa larga del cappello (Nota: questa sporge ancora dalla bounding box!)
    ctx.rect(startX - w * 0.3, startY + hatH * 0.8, w * 1.6, hatH * 0.2);
    ctx.fill();

    // Fascia del cappello
    ctx.beginPath();
    ctx.fillStyle = "#fbc02d"; // Giallo oro
    ctx.rect(startX + w * 0.15, startY + hatH * 0.7, w * 0.7, hatH * 0.1);
    ctx.fill();
    // -cappello

    // +TESTA E VISO
    const headStartY = startY + hatH;
    ctx.beginPath();
    ctx.fillStyle = skinColor;
    ctx.rect(startX + w * 0.15, headStartY, w * 0.7, headH);
    ctx.fill();

    // Ombra degli occhi sotto il cappello
    ctx.beginPath();
    ctx.fillStyle = "#151514";
    ctx.rect(startX + w * 0.2, headStartY + headH * 0.2, w * 0.6, headH * 0.2);
    ctx.fill();

    // Occhietti brillanti (magici)
    ctx.beginPath();
    ctx.fillStyle = magicColor;
    ctx.rect(startX + w * 0.3, headStartY + headH * 0.25, w * 0.1, headH * 0.1); // Occhio sx
    ctx.rect(startX + w * 0.6, headStartY + headH * 0.25, w * 0.1, headH * 0.1); // Occhio dx
    ctx.fill();
    // -testa

    // +TUNICA E CORPO (Modificato: Braccia più strette)
    const bodyStartY = startY + hatH + headH;
    const sleeveW = w * 0.25; // Larghezza maniche (prima era 0.5)
    const handW = w * 0.15;   // Larghezza mani
    
    // Maniche
    ctx.beginPath();
    ctx.fillStyle = robeColor;
    ctx.rect(startX - sleeveW, bodyStartY, sleeveW, bodyH * 0.7); // Manica sx
    ctx.rect(startX + w, bodyStartY, sleeveW, bodyH * 0.7); // Manica dx
    ctx.fill();

    // Mani che spuntano (centrate sotto la rispettiva manica)
    ctx.beginPath();
    ctx.fillStyle = skinColor;
    ctx.rect(startX - sleeveW + (sleeveW - handW)/2, bodyStartY + bodyH * 0.7, handW, bodyH * 0.15); // Mano sx
    ctx.rect(startX + w + (sleeveW - handW)/2, bodyStartY + bodyH * 0.7, handW, bodyH * 0.15); // Mano dx
    ctx.fill();

    // Corpo principale (Tunica)
    ctx.beginPath();
    ctx.fillStyle = robeColor;
    ctx.rect(startX, bodyStartY, w, bodyH);
    ctx.fill();

    // Cintura con fibbia
    ctx.beginPath();
    ctx.fillStyle = "#151514"; // Cintura nera
    ctx.rect(startX, bodyStartY + bodyH * 0.4, w, bodyH * 0.1);
    ctx.fill();
    ctx.beginPath();
    ctx.fillStyle = "#fbc02d"; // Fibbia d'oro
    ctx.rect(startX + w * 0.3, bodyStartY + bodyH * 0.35, w * 0.4, bodyH * 0.2);
    ctx.fill();
    ctx.beginPath();
    ctx.fillStyle = "#151514"; // Buco fibbia
    ctx.rect(startX + w * 0.4, bodyStartY + bodyH * 0.4, w * 0.2, bodyH * 0.1);
    ctx.fill();
    // -tunica

    // +BARBA MAESTOSA
    ctx.beginPath();
    ctx.fillStyle = "#f5f5f5"; // Bianco/Grigio chiarissimo
    // Barba principale
    ctx.rect(startX + w * 0.05, headStartY + headH * 0.5, w * 0.9, headH * 0.5 + bodyH * 0.3);
    // Baffi
    ctx.rect(startX + w * 0.15, headStartY + headH * 0.6, w * 0.7, headH * 0.2);
    ctx.fill();

    // Bocca buia sotto i baffi
    ctx.beginPath();
    ctx.fillStyle = "#151514";
    ctx.rect(startX + w * 0.4, headStartY + headH * 0.75, w * 0.2, headH * 0.15);
    ctx.fill();
    // -barba

    // +PIEDI
    const feetStartY = startY + h - feetH;
    ctx.beginPath();
    ctx.fillStyle = "#5c4033"; // Scarpe di cuoio
    ctx.rect(startX + w * 0.1, feetStartY, w * 0.3, feetH); // Piede sx
    ctx.rect(startX + w * 0.6, feetStartY, w * 0.3, feetH); // Piede dx
    ctx.fill();
    // -piedi

    ctx.restore();
}





function drawNormalGuy(ctx: CanvasRenderingContext2D, x, y, w, h, style: any = {}) {
    ctx.save();

    // move origin (x=0, y=0) to the person center
    ctx.translate(x, y);
    const startX = -w/2;
    const startY = -h/2;


    // +head
    const headH = h * 0.3;

    ctx.beginPath();
    ctx.fillStyle = style.skinColor || "#eaa66e";
    ctx.rect(startX, startY, w, headH);
    ctx.fill();

    ctx.beginPath();
    ctx.fillStyle = "#151514";
    ctx.rect(startX, startY, w, headH/4);
    ctx.fill();
    // -head

    // +body
    const bodyStartY = startY + headH;
    const bodyH = h * 0.35;
    const armLen = 0.4 * w;

    ctx.beginPath();
    ctx.fillStyle = "#04097f";
    ctx.rect(startX, bodyStartY, w, bodyH); // body
    ctx.rect(startX - armLen, bodyStartY, armLen, 0.35*bodyH); // left arm
    ctx.rect(startX + w, bodyStartY, armLen, 0.35*bodyH); // left arm
    ctx.fill();
    // -body

    // +legs
    const legH = h - headH - bodyH;
    const legStartY = bodyStartY + bodyH;
    const legW = w * 0.35;

    ctx.beginPath();
    ctx.fillStyle = "#100712";
    ctx.rect(startX, legStartY, w, legH/3); // top
    ctx.rect(startX, legStartY, legW, legH); // left leg
    ctx.rect(startX + w - legW, legStartY, legW, legH); // right leg
    ctx.fill();
    // -legs

    ctx.restore();
}

function persona1(ctx: CanvasRenderingContext2D, x, y, w, h, style: any = {}) {
    ctx.save();

    // move origin (x=0, y=0) to the person center
    ctx.translate(x, y);
    const startX = -w/2;
    const startY = -h/2;

    // +hat (berretto di Che Guevara)
    const hatH = h * 0.12;
    ctx.beginPath();
    ctx.fillStyle = "#000000";
    ctx.rect(startX, startY, w, hatH);
    ctx.fill();
    
    // star on hat
    const starSize = w * 0.08;
    drawStar(ctx, 0, startY + hatH*0.5, 5, starSize, starSize * 1.6);

    // +head
    const headH = h * 0.3;
    const headStartY = startY + hatH;
    ctx.beginPath();
    ctx.fillStyle = "#d4a574";
    ctx.rect(startX, headStartY, w, headH);
    ctx.fill();

    // +beard (barba caratteristica)
    ctx.beginPath();
    ctx.fillStyle = "#000000";
    ctx.rect(startX, headStartY + headH*0.6, w, headH*0.4);
    ctx.fill();

    // +eyes
    const eyeSize = w * 0.04;
    ctx.beginPath();
    ctx.fillStyle = "#000000";
    ctx.rect(startX + w*0.25, headStartY + headH*0.3, eyeSize, eyeSize);
    ctx.rect(startX + w*0.65, headStartY + headH*0.3, eyeSize, eyeSize);
    ctx.fill();
    // -head

    // +body (abito da combattente)
    const bodyStartY = headStartY + headH;
    const bodyH = h * 0.35;
    const armLen = 0.4 * w;

    ctx.beginPath();
    ctx.fillStyle = "#2d5016";
    ctx.rect(startX, bodyStartY, w, bodyH); // body
    ctx.rect(startX - armLen, bodyStartY, armLen, 0.35*bodyH); // left arm
    ctx.rect(startX + w, bodyStartY, armLen, 0.35*bodyH); // right arm
    ctx.fill();
    // -body

    // +legs
    const legH = h - hatH - headH - bodyH;
    const legStartY = bodyStartY + bodyH;
    const legW = w * 0.35;

    ctx.beginPath();
    ctx.fillStyle = "#1a1a1a";
    ctx.rect(startX, legStartY, legW, legH); // left leg
    ctx.rect(startX + w - legW, legStartY, legW, legH); // right leg
    ctx.fill();
    // -legs

    ctx.restore();
}

function drawStar(ctx: CanvasRenderingContext2D, cx, cy, spikes, outerRadius, innerRadius) {
    let rot = Math.PI / 2 * 3;
    let step = Math.PI / spikes;

    ctx.beginPath();
    ctx.moveTo(cx, cy - outerRadius);
    for (let i = 0; i < spikes; i++) {
        ctx.lineTo(cx + Math.cos(rot) * outerRadius, cy + Math.sin(rot) * outerRadius);
        rot += step;

        ctx.lineTo(cx + Math.cos(rot) * innerRadius, cy + Math.sin(rot) * innerRadius);
        rot += step;
    }
    ctx.lineTo(cx, cy - outerRadius);
    ctx.closePath();
    ctx.fillStyle = "#ffd700";
    ctx.fill();
}
function draw11(ctx: CanvasRenderingContext2D, x, y, w, h, style: any = {}) {
    ctx.save();

    // move origin (x=0, y=0) to the person center
    ctx.translate(x, y);
    const startX = -w/2;
    const startY = -h/2;


    // +head
    const headH = h * 0.3;

    ctx.beginPath();
    ctx.fillStyle = style.skinColor || "#d3baa5";
    ctx.rect(startX, startY, w, headH);
    ctx.fill();

    ctx.beginPath();
    ctx.fillStyle = "#151514";
    ctx.rect(startX , startY - headH/5 ,w, headH/2);
    ctx.fill();

    const eyeW = w * 0.25;
    const eyeH = headH * 0.18;
    const eyeY = startY + headH * 0.45;
    const leftEyeX = startX + w * 0.22;
    const rightEyeX = startX + w * 0.64;

    ctx.beginPath();
    ctx.fillStyle = "#ffffff";
    ctx.rect(leftEyeX, eyeY, eyeW, eyeH);
    ctx.rect(rightEyeX, eyeY, eyeW, eyeH);
    ctx.fill();

    const pupilW = eyeW * 0.45;
    const pupilH = eyeH * 0.85;
    const pupilY = eyeY + eyeH * 0.08;

    ctx.beginPath();
    ctx.fillStyle = "#1f1f1f";
    ctx.rect(leftEyeX + eyeW * 0.28, pupilY, pupilW, pupilH);
    ctx.rect(rightEyeX + eyeW * 0.28, pupilY, pupilW, pupilH);
    ctx.fill();
    // -head

    // hat
    const hatTopY = startY - headH * 0.32;
    const hatTopH = headH * 0.32;
    const hatBandY = hatTopY + hatTopH;
    const hatBandH = headH * 0.14;
    const brimY = hatBandY + hatBandH;
    const brimH = headH * 0.12;

    ctx.beginPath();
    ctx.fillStyle = "#1a2b6d";
    ctx.rect(startX - w * 0.08, hatTopY, w * 1.16, hatTopH);
    ctx.fill();

    ctx.beginPath();
    ctx.fillStyle = "#0f1d50";
    ctx.rect(startX - w * 0.04, hatBandY, w * 1.08, hatBandH);
    ctx.fill();

    ctx.beginPath();
    ctx.fillStyle = "#121212";
    ctx.rect(startX - w * 0.14, brimY, w * 1.28, brimH);
    ctx.fill();

    ctx.beginPath();
    ctx.fillStyle = "#d6b64c";
    ctx.rect(startX + w * 0.44, hatBandY + hatBandH * 0.1, w * 0.12, hatBandH * 0.8);
    ctx.fill();
    

    // +body
    const bodyStartY = startY + headH;
    const bodyH = h * 0.35;
    const armLen = 0.4 * w;

    ctx.beginPath();
    ctx.fillStyle = "#04097f";
    ctx.rect(startX, bodyStartY, w, bodyH); // body
    ctx.rect(startX - armLen, bodyStartY, armLen, 0.35*bodyH); // left arm
    ctx.rect(startX + w, bodyStartY, armLen, 0.35*bodyH); // right arm
    ctx.fill();

    ctx.beginPath();
    ctx.fillStyle = "#d3baa5";
    ctx.rect(startX - armLen, bodyStartY + 0.35*bodyH, armLen, 0.70*bodyH); // left arm
    ctx.rect(startX + w, bodyStartY + 0.35*bodyH, armLen, 0.70*bodyH); // right arm
    ctx.fill();


    const batonW = w * 0.11;
    const batonH = bodyH * 0.95;
    const batonX = startX - armLen * 0.55;
    const batonY = bodyStartY + bodyH * 0.70;

    ctx.beginPath();
    ctx.fillStyle = "#1a1a1a";
    ctx.rect(batonX, batonY, batonW, batonH); // manganello
    ctx.fill();

    ctx.beginPath();
    ctx.fillStyle = "#0a0a0a";
    ctx.rect(batonX - batonW * 0.15, batonY + batonH * 0.78, batonW * 1.3, batonH * 0.18); // impugnatura
    ctx.fill();

    ctx.beginPath();
    ctx.fillStyle = "#303030";
    ctx.rect(batonX, batonY, batonW, batonH * 0.08); // punta
    ctx.fill();

    const handX = startX + w + armLen * 0.9;
    const handY = bodyStartY + bodyH * 0.90;
    const gunW = w * 0.58;
    const gunH = bodyH * 0.22;

    ctx.save();
    ctx.translate(handX, handY);

    ctx.beginPath();
    ctx.fillStyle = "#2f2f2f";
    ctx.rect(-gunW * 0.20, -gunH * 1.05, gunW, gunH * 0.62); // slide
    ctx.fill();

    ctx.beginPath();
    ctx.fillStyle = "#1d1d1d";
    ctx.rect(-gunW * 0.17, -gunH * 0.70, gunW * 0.70, gunH * 0.55); // frame
    ctx.rect(-gunW * 0.02, -gunH * 0.18, gunW * 0.22, gunH * 0.95); // grip
    ctx.fill();

    ctx.beginPath();
    ctx.fillStyle = "#161616";
    ctx.rect(gunW * 0.50, -gunH * 1.05, gunW * 0.12, gunH * 0.24); // muzzle
    ctx.fill();

    ctx.beginPath();
    ctx.fillStyle = "#0f0f0f";
    ctx.rect(gunW * 0.14, -gunH * 0.15, gunW * 0.15, gunH * 0.22); // trigger guard
    ctx.fill();

    ctx.restore();
    // -body

    // +legs
    const legH = h - headH - bodyH;
    const legStartY = bodyStartY + bodyH;
    const legW = w * 0.35;

    ctx.beginPath();
    ctx.fillStyle = "#100712";
    ctx.rect(startX, legStartY, w, legH/3); // top
    const legBottomStartY = legStartY + legH/3;
    const legBottomH = legH - legH/3;
    ctx.rect(startX, legBottomStartY, legW, legBottomH); // left leg
    ctx.rect(startX + w - legW, legBottomStartY, legW, legBottomH); // right leg
    ctx.fill();
    // -legs

    const beltH = h * 0.03;

    ctx.beginPath();
    ctx.fillStyle = "#4e402f";
    ctx.rect(startX, legStartY, w, beltH);
    ctx.fill();

    ctx.beginPath();
    ctx.fillStyle = "#a0a0a0";
    ctx.rect(startX + w * 0.42, legStartY, w * 0.16, beltH);
    ctx.fill();

    ctx.restore();
}

function drawPersona6(ctx: CanvasRenderingContext2D, x, y, w, h, style = {}) {
    ctx.save();

    ctx.translate(x, y);
    const startX = -w/2;
    const startY = -h/2;

    // ================= HEAD =================
    const headH = h * 0.3;

    // faccia
    ctx.fillStyle = "#eaa66e";
    ctx.fillRect(startX, startY, w, headH);

    // capelli (base)
    ctx.fillStyle = "#f4c542";
    ctx.fillRect(startX, startY, w, headH * 0.25);

    // ciuffo laterale (più caratteristico)
    ctx.fillRect(startX + w*0.5, startY - headH*0.15, w*0.6, headH*0.25);

    // occhi
    ctx.fillStyle = "#000";
    const eyeSize = w * 0.08;
    ctx.fillRect(startX + w*0.25, startY + headH*0.45, eyeSize, eyeSize);
    ctx.fillRect(startX + w*0.65, startY + headH*0.45, eyeSize, eyeSize);

    // ================= BODY =================
    const bodyStartY = startY + headH;
    const bodyH = h * 0.35;
    const armLen = 0.4 * w;

    // giacca
    ctx.fillStyle = "#1c1f3a";
    ctx.fillRect(startX, bodyStartY, w, bodyH);

    // maniche
    ctx.fillRect(startX - armLen, bodyStartY, armLen, bodyH * 0.85);
    ctx.fillRect(startX + w, bodyStartY, armLen, bodyH * 0.85);

    // camicia (centro)
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(startX + w*0.4, bodyStartY, w*0.2, bodyH * 0.4);

    // cravatta
    ctx.fillStyle = "#c51d1d";
    ctx.fillRect(startX + w*0.45, bodyStartY, w*0.1, bodyH * 0.7);

    // ================= LEGS =================
    const legH = h - headH - bodyH;
    const legStartY = bodyStartY + bodyH;
    const legW = w * 0.35;

    ctx.fillStyle = "#111";
    ctx.fillRect(startX, legStartY, legW, legH);
    ctx.fillRect(startX + w - legW, legStartY, legW, legH);


    ctx.restore();
}

function drawPersonaggio10(ctx: CanvasRenderingContext2D, x, y, w, h, style: any = {}) {
    ctx.save();

    ctx.translate(x, y);
    const startY = -h * 0.4;

    const headH = h * 0.34;
    const bodyH = h * 0.36;
    const legH = h - headH - bodyH;

    const headW = w * 0.92;
    const bodyW = w * 0.82;
    const eyeW = w * 0.12;
    const eyeH = h * 0.09;
    const armW = w * 0.18;
    const armH = h * 0.1;

    const alienRed = style.mainColor || "#d61f2d";
    const alienDark = style.shadowColor || "#7c0e16";
    const alienLight = style.highlightColor || "#ff6b6b";
    const alienEye = "#dff8ff";
    const pupil = "#0b1a1d";

    const headCx = 0;
    const headCy = startY + headH * 0.48;

    ctx.fillStyle = alienDark;
    ctx.beginPath();
    ctx.ellipse(headCx - w * 0.18, startY - h * 0.08, w * 0.06, h * 0.14, -0.45, 0, Math.PI * 2);
    ctx.ellipse(headCx + w * 0.18, startY - h * 0.08, w * 0.06, h * 0.14, 0.45, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = alienDark;
    ctx.lineWidth = Math.min(w, h) * 0.03;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(headCx - w * 0.12, startY - h * 0.01);
    ctx.quadraticCurveTo(headCx - w * 0.26, startY - h * 0.15, headCx - w * 0.31, startY - h * 0.28);
    ctx.moveTo(headCx + w * 0.12, startY - h * 0.01);
    ctx.quadraticCurveTo(headCx + w * 0.26, startY - h * 0.15, headCx + w * 0.31, startY - h * 0.28);
    ctx.stroke();

    ctx.fillStyle = alienRed;
    ctx.beginPath();
    ctx.ellipse(headCx, headCy, headW / 2, headH / 2, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = alienLight;
    ctx.beginPath();
    ctx.ellipse(headCx - w * 0.12, headCy - h * 0.06, w * 0.14, h * 0.1, -0.35, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = alienEye;
    ctx.beginPath();
    ctx.ellipse(headCx - w * 0.18, headCy - h * 0.02, eyeW, eyeH, -0.15, 0, Math.PI * 2);
    ctx.ellipse(headCx + w * 0.18, headCy - h * 0.02, eyeW, eyeH, 0.15, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = pupil;
    ctx.beginPath();
    ctx.ellipse(headCx - w * 0.16, headCy - h * 0.01, eyeW * 0.35, eyeH * 0.5, -0.08, 0, Math.PI * 2);
    ctx.ellipse(headCx + w * 0.16, headCy - h * 0.01, eyeW * 0.35, eyeH * 0.5, 0.08, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = alienDark;
    ctx.beginPath();
    ctx.ellipse(headCx, headCy + h * 0.1, w * 0.08, h * 0.028, 0, 0, Math.PI * 2);
    ctx.fill();

    const bodyTop = startY + headH * 0.8;
    ctx.fillStyle = alienRed;
    ctx.beginPath();
    ctx.ellipse(0, bodyTop + bodyH * 0.48, bodyW / 2, bodyH / 2, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = alienDark;
    ctx.beginPath();
    ctx.ellipse(-w * 0.5, bodyTop + bodyH * 0.4, armW, armH, -0.35, 0, Math.PI * 2);
    ctx.ellipse(w * 0.5, bodyTop + bodyH * 0.4, armW, armH, 0.35, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = alienRed;
    ctx.beginPath();
    ctx.ellipse(-w * 0.55, bodyTop + bodyH * 0.42, armW * 0.72, armH * 0.72, -0.1, 0, Math.PI * 2);
    ctx.ellipse(w * 0.55, bodyTop + bodyH * 0.42, armW * 0.72, armH * 0.72, 0.1, 0, Math.PI * 2);
    ctx.fill();

    const legTop = bodyTop + bodyH * 0.8;
    const legW = w * 0.22;
    const footW = w * 0.16;
    const footH = h * 0.06;

    ctx.fillStyle = alienDark;
    ctx.beginPath();
    ctx.ellipse(-w * 0.17, legTop + legH * 0.46, legW, legH * 0.52, 0.05, 0, Math.PI * 2);
    ctx.ellipse(w * 0.17, legTop + legH * 0.46, legW, legH * 0.52, -0.05, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = alienRed;
    ctx.beginPath();
    ctx.ellipse(-w * 0.19, legTop + legH * 0.42, legW * 0.75, legH * 0.42, 0.05, 0, Math.PI * 2);
    ctx.ellipse(w * 0.19, legTop + legH * 0.42, legW * 0.75, legH * 0.42, -0.05, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = alienDark;
    ctx.beginPath();
    ctx.ellipse(-w * 0.2, startY + h * 0.49, footW, footH, 0, 0, Math.PI * 2);
    ctx.ellipse(w * 0.2, startY + h * 0.49, footW, footH, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
}

function drawPersonaggio8(ctx: CanvasRenderingContext2D, x, y, w, h, style: any = {}) {
    ctx.save();

    // Sposta l'origine al centro del personaggio
    ctx.translate(x, y);
    const startX = -w / 2;
    const startY = -h / 2;

    // Proporzioni molto squadrate (stile "cubettoso")
    const headSize = h * 0.35; 
    const bodyH = h * 0.40;
    const legH = h - headSize - bodyH;

    // Colori personalizzabili o di default
    const skin = style.skinColor || "#ffccaa";
    const shirt = style.shirtColor || "#e74c3c";
    const pants = style.pantsColor || "#2980b9";

    // +Testa (Un blocco unico)
    ctx.fillStyle = skin;
    ctx.fillRect(startX, startY, w, headSize);

    // Occhi (quadrati, in pieno stile pixel-art)
    ctx.fillStyle = "#111111";
    ctx.fillRect(startX + w * 0.15, startY + headSize * 0.3, w * 0.25, w * 0.25); // Occhio sx
    ctx.fillRect(startX + w * 0.6, startY + headSize * 0.3, w * 0.25, w * 0.25);  // Occhio dx

    // Bocca (una fessura rettangolare)
    ctx.fillStyle = "#882222";
    ctx.fillRect(startX + w * 0.35, startY + headSize * 0.7, w * 0.3, w * 0.1);
    // -Testa

    // +Corpo (Maglietta)
    const bodyStartY = startY + headSize;
    ctx.fillStyle = shirt;
    ctx.fillRect(startX, bodyStartY, w, bodyH);

    // Braccia (rettangoli rigidi attaccati ai lati)
    const armW = w * 0.35;
    ctx.fillStyle = shirt; // Maniche
    ctx.fillRect(startX - armW, bodyStartY, armW, bodyH * 0.7); // Braccio sx
    ctx.fillRect(startX + w, bodyStartY, armW, bodyH * 0.7);    // Braccio dx

    // Mani (quadrate)
    ctx.fillStyle = skin;
    ctx.fillRect(startX - armW, bodyStartY + bodyH * 0.7, armW, bodyH * 0.25);
    ctx.fillRect(startX + w, bodyStartY + bodyH * 0.7, armW, bodyH * 0.25);
    // -Corpo

    // +Gambe (Pantaloni)
    const legStartY = bodyStartY + bodyH;
    const legW = w * 0.45;
    
    ctx.fillStyle = pants;
    ctx.fillRect(startX, legStartY, legW, legH); // Gamba sx
    ctx.fillRect(startX + w - legW, legStartY, legW, legH); // Gamba dx
    
    // Spazio tra le gambe (per dare l'effetto di due gambe separate se il background è un altro colore, 
    // ma qui disegniamo i blocchi separati, quindi lasciamo uno spiraglio al centro)
    ctx.clearRect(startX + legW, legStartY, w - (legW * 2), legH); 
    // -Gambe

    ctx.restore();
}

function drawPersona15(ctx: CanvasRenderingContext2D, x, y, w, h, style: any = {}) {
    ctx.save();

    // origine al centro del personaggio
    ctx.translate(x, y);
    const startX = -w/2;
    const startY = -h/2;

    // +HEAD
    const headH = h*0.3;

    // testa
    ctx.beginPath();
    ctx.fillStyle = style.skinColor || "#eaa66e";
    ctx.rect(startX, startY, w, headH);
    ctx.fill();

    // capelli neri
    ctx.beginPath();
    ctx.fillStyle = "#151514";
    ctx.rect(startX, startY + headH*0.5, w, headH*0.5);
    ctx.fill();

    // cappello cowboy
    ctx.beginPath();
    ctx.fillStyle = "#8b5a2b"; // marrone
    ctx.rect(startX - w * 0.1, startY - headH*0.2, w*1.2, headH*0.3); // tesa
    ctx.fill();

    ctx.beginPath();
    ctx.fillStyle = "#654321"; // corona cappello
    ctx.rect(startX+w*0.2, startY-headH*0.25, w*0.6, headH*0.25);
    ctx.fill();
    // -HEAD

    // +BODY
    const bodyStartY = startY+headH;
    const bodyH = h*0.35;
    const armLen = 0.4*w;

    // camicia cowboy
    ctx.beginPath();
    ctx.fillStyle = "#a0522d"; // marrone chiaro
    ctx.rect(startX, bodyStartY, w, bodyH);
    ctx.rect(startX-armLen, bodyStartY, armLen, 0.35*bodyH);
    ctx.rect(startX+w, bodyStartY, armLen, 0.35*bodyH);
    ctx.fill();

    // cintura
    ctx.beginPath();
    ctx.fillStyle = "#3e2723";
    ctx.rect(startX, bodyStartY+bodyH*0.7, w, bodyH*0.15);
    ctx.fill();
    // -BODY

    // +LEGS
    const legH = h-headH-bodyH;
    const legStartY = bodyStartY+bodyH;
    const legW = w*0.35;

    ctx.beginPath();
    ctx.fillStyle = "#4b3621"; // pantaloni scuri
    ctx.rect(startX, legStartY, w, legH/3); // top
    ctx.rect(startX, legStartY, legW, legH); // left leg
    ctx.rect(startX+w-legW, legStartY, legW, legH); // right leg
    ctx.fill();

    // stivali
    ctx.beginPath();
    ctx.fillStyle = "#2f1b0e";
    ctx.rect(startX, legStartY + legH*0.8, legW, legH*0.2);
    ctx.rect(startX+w-legW, legStartY + legH*0.8, legW, legH*0.2);
    ctx.fill();
    // -LEGS

    ctx.restore();
}

function drawBatman(ctx: CanvasRenderingContext2D, x, y, w, h, style: any = {}) {
    ctx.save();
    ctx.translate(x, y);

    const startX = -w / 2;
    const startY = -h / 2;

    const headH = h * 0.25;
    const bodyH = h * 0.40;
    const legH = h - headH - bodyH;
    
    const bodyStartY = startY + headH;
    const legStartY = bodyStartY + bodyH;

    // --- MANTELLO (Effetto "Scalloped") ---
    ctx.beginPath();
    ctx.fillStyle = "#1a1a1a";
    const capeW = w * 1.3;
    ctx.moveTo(startX - w * 0.15, bodyStartY);
    ctx.lineTo(startX + w * 1.15, bodyStartY);
    ctx.lineTo(startX + capeW, legStartY + legH);
    // Creazione delle punte del mantello in basso
    for (let i = 0; i <= 3; i++) {
        ctx.quadraticCurveTo(
            startX + capeW - (i * capeW / 3) - (capeW / 6), legStartY + legH * 0.8,
            startX + capeW - ((i + 1) * capeW / 3), legStartY + legH
        );
    }
    ctx.fill();

    // --- CORPO (Muscolatura e Busto) ---
    ctx.beginPath();
    ctx.fillStyle = "#333333";
    // Spalle più arrotondate
    const shoulderRadius = w * 0.05;
    ctx.roundRect(startX, bodyStartY, w, bodyH, [shoulderRadius, shoulderRadius, 0, 0]);
    ctx.fill();

    // Braccia muscolose
    const armW = w * 0.35;
    const armPad = w * 0.025;
    const armRadius = w * 0.04;
    ctx.beginPath();
    ctx.roundRect(startX - armW + armPad, bodyStartY + armPad, armW, bodyH * 0.6, armRadius); // Braccio sx
    ctx.roundRect(startX + w - armPad, bodyStartY + armPad, armW, bodyH * 0.6, armRadius); // Braccio dx
    ctx.fill();

    // --- TESTA (Maschera Sagomata) ---
    ctx.beginPath();
    ctx.fillStyle = "#000000";
    // Maschera con orecchie a punta integrate
    ctx.moveTo(startX, startY + headH); // Angolo basso sx
    ctx.lineTo(startX, startY); // Lato sx
    ctx.lineTo(startX + w * 0.15, startY - headH * 0.4); // Punta orecchia sx
    ctx.lineTo(startX + w * 0.3, startY); // Interno orecchia sx
    ctx.lineTo(startX + w * 0.7, startY); // Interno orecchia dx
    ctx.lineTo(startX + w * 0.85, startY - headH * 0.4); // Punta orecchia dx
    ctx.lineTo(startX + w, startY); // Lato dx
    ctx.lineTo(startX + w, startY + headH); // Angolo basso dx
    ctx.closePath();
    ctx.fill();

    // Viso (Mascella squadrata)
    ctx.beginPath();
    ctx.fillStyle = style.skinColor || "#eaa66e";
    ctx.moveTo(startX + w * 0.2, startY + headH);
    ctx.lineTo(startX + w * 0.8, startY + headH);
    ctx.lineTo(startX + w * 0.75, startY + headH * 0.55);
    ctx.lineTo(startX + w * 0.25, startY + headH * 0.55);
    ctx.closePath();
    ctx.fill();

    // Occhi bianchi (Fessure iconiche)
    ctx.fillStyle = "white";
    ctx.beginPath();
    ctx.moveTo(startX + w * 0.25, startY + headH * 0.35);
    ctx.lineTo(startX + w * 0.45, startY + headH * 0.4);
    ctx.lineTo(startX + w * 0.25, startY + headH * 0.45);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(startX + w * 0.75, startY + headH * 0.35);
    ctx.lineTo(startX + w * 0.55, startY + headH * 0.4);
    ctx.lineTo(startX + w * 0.75, startY + headH * 0.45);
    ctx.fill();

    // --- DETTAGLI PETTO ---
    // Logo (Pipistrello stilizzato dentro l'ovale)
    ctx.beginPath();
    ctx.fillStyle = "#ffcc00";
    ctx.ellipse(startX + w / 2, bodyStartY + bodyH * 0.3, w * 0.28, bodyH * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // Sagoma pipistrello nera semplificata
    ctx.fillStyle = "black";
    ctx.beginPath();
    ctx.arc(startX + w / 2, bodyStartY + bodyH * 0.3, w * 0.1, 0, Math.PI, true);
    ctx.fill();

    // Cintura con tasche
    ctx.fillStyle = "#d4af37";
    const beltY = bodyStartY + bodyH - (bodyH * 0.2);
    ctx.fillRect(startX, beltY, w, bodyH * 0.18);
    // Tasche sulla cintura
    const pocketPad = w * 0.01;
    ctx.fillStyle = "#b8952e";
    for(let i=0; i<4; i++) {
        ctx.fillRect(startX + (i * w/4) + pocketPad, beltY + pocketPad, w/4 - pocketPad * 2, bodyH * 0.14);
    }

    // --- GAMBE ---
    const legW = w * 0.38;
    const bootRadius = w * 0.025;
    ctx.fillStyle = "#111111";
    ctx.beginPath();
    ctx.roundRect(startX, legStartY, legW, legH, [0, 0, bootRadius, bootRadius]);
    ctx.roundRect(startX + w - legW, legStartY, legW, legH, [0, 0, bootRadius, bootRadius]);
    ctx.fill();

    ctx.restore();
}

function drawPersona7(ctx: CanvasRenderingContext2D, x, y, w, h, style: any = {}) {
    ctx.save();
    ctx.translate(x, y);

    const startX = -w / 2;
    const startY = -h / 2;

    // pulsazione neon
    const time = Date.now() / 1000;
    const glow = 0.5 + 0.5 * Math.sin(time * 3);
    const neon = `rgba(0, 255, 200, ${0.6 + 0.4 * glow})`;
    const neonSolid = "#00ffc8";
    const darkBase = "#0f0f23";
    const darkMid = "#16213e";
    const darkHood = "#1a1a2e";

    // ombra a terra
    ctx.beginPath();
    ctx.ellipse(0, startY + h + h * 0.02, w * 0.7, h * 0.03, 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0, 255, 200, ${0.15 + 0.1 * glow})`;
    ctx.fill();

    // === SCIARPA / MANTELLO che pende dietro ===
    ctx.beginPath();
    ctx.fillStyle = "#2d1b4e";
    ctx.moveTo(startX + w * 0.2, startY + h * 0.28);
    ctx.lineTo(startX - w * 0.15, startY + h * 0.75);
    ctx.lineTo(startX + w * 0.05, startY + h * 0.7);
    ctx.lineTo(startX + w * 0.35, startY + h * 0.32);
    ctx.closePath();
    ctx.fill();

    // === TESTA - CAPPUCCIO ===
    const headH = h * 0.28;

    // cappuccio (triangolo arrotondato)
    const hoodOffset = w * 0.03;
    ctx.beginPath();
    ctx.moveTo(startX - hoodOffset, startY + headH + hoodOffset * 0.3);
    ctx.quadraticCurveTo(startX + w / 2, startY - w * 0.1, startX + w + hoodOffset, startY + headH + hoodOffset * 0.3);
    ctx.closePath();
    ctx.fillStyle = darkHood;
    ctx.fill();

    // visiera / maschera
    const borderRadius = w * 0.02;
    ctx.beginPath();
    ctx.roundRect(startX + w * 0.08, startY + headH * 0.3, w * 0.84, headH * 0.5, borderRadius);
    ctx.fillStyle = darkBase;
    ctx.fill();

    // occhi luminosi
    const eyeY = startY + headH * 0.52;
    const eyeW = w * 0.14;
    const eyeH = w * 0.06;

    ctx.shadowColor = neonSolid;
    ctx.shadowBlur = w * 0.08 + w * 0.04 * glow;

    // occhio sinistro
    ctx.beginPath();
    ctx.ellipse(startX + w * 0.3, eyeY, eyeW, eyeH, -0.15, 0, Math.PI * 2);
    ctx.fillStyle = neonSolid;
    ctx.fill();

    // occhio destro
    ctx.beginPath();
    ctx.ellipse(startX + w * 0.7, eyeY, eyeW, eyeH, 0.15, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;

    // === CORPO CORAZZATO ===
    const bodyStartY = startY + headH;
    const bodyH = h * 0.37;
    const armLen = 0.45 * w;

    // corpo principale
    ctx.beginPath();
    ctx.fillStyle = darkMid;
    ctx.rect(startX, bodyStartY, w, bodyH);
    ctx.fill();

    // piastre armatura
    const armorPad = w * 0.015;
    ctx.fillStyle = "#1e2d50";
    ctx.fillRect(startX + armorPad, bodyStartY + armorPad, w - armorPad * 2, bodyH * 0.45);

    // V neon sul petto
    ctx.shadowColor = neonSolid;
    ctx.shadowBlur = w * 0.05 * glow;
    ctx.strokeStyle = neon;
    ctx.lineWidth = w * 0.015;
    ctx.beginPath();
    ctx.moveTo(startX + w * 0.1, bodyStartY + bodyH * 0.08);
    ctx.lineTo(startX + w * 0.5, bodyStartY + bodyH * 0.45);
    ctx.lineTo(startX + w * 0.9, bodyStartY + bodyH * 0.08);
    ctx.stroke();

    // linea orizzontale cintura
    const beltPad = w * 0.02;
    ctx.beginPath();
    ctx.moveTo(startX + beltPad, bodyStartY + bodyH * 0.7);
    ctx.lineTo(startX + w - beltPad, bodyStartY + bodyH * 0.7);
    ctx.stroke();

    // cerchio energia al centro cintura
    const beltCircleR = w * 0.02;
    ctx.beginPath();
    ctx.arc(startX + w / 2, bodyStartY + bodyH * 0.7, beltCircleR, 0, Math.PI * 2);
    ctx.fillStyle = neonSolid;
    ctx.fill();

    ctx.shadowBlur = 0;

    // braccia
    ctx.fillStyle = darkHood;
    ctx.fillRect(startX - armLen, bodyStartY + bodyH * 0.05, armLen, bodyH * 0.3);
    ctx.fillRect(startX + w, bodyStartY + bodyH * 0.05, armLen, bodyH * 0.3);

    // bande neon sulle braccia
    ctx.shadowColor = neonSolid;
    ctx.shadowBlur = w * 0.03 * glow;
    ctx.fillStyle = neon;
    ctx.fillRect(startX - armLen * 0.65, bodyStartY + bodyH * 0.08, armLen * 0.15, bodyH * 0.24);
    ctx.fillRect(startX + w + armLen * 0.5, bodyStartY + bodyH * 0.08, armLen * 0.15, bodyH * 0.24);

    // mani
    ctx.shadowBlur = 0;
    const handW = w * 0.03;
    ctx.fillStyle = "#222";
    ctx.fillRect(startX - armLen - handW * 0.5, bodyStartY + bodyH * 0.05, handW, bodyH * 0.3);
    ctx.fillRect(startX + w + armLen - handW * 0.5, bodyStartY + bodyH * 0.05, handW, bodyH * 0.3);

    // === SPADA ENERGETICA ===
    const swordX = startX + w + armLen + w * 0.01;
    const swordHandleTop = bodyStartY + bodyH * 0.05;

    // impugnatura
    const swordHandleW = w * 0.02;
    ctx.fillStyle = "#555";
    ctx.fillRect(swordX - swordHandleW * 0.5, swordHandleTop, swordHandleW, bodyH * 0.3);

    // guardia
    ctx.fillStyle = "#888";
    ctx.fillRect(swordX - w * 0.03, swordHandleTop - w * 0.01, w * 0.06, w * 0.02);

    // lama energia
    ctx.shadowColor = "#ff0050";
    ctx.shadowBlur = w * 0.07 + w * 0.03 * glow;
    const bladeGrad = ctx.createLinearGradient(0, swordHandleTop - headH, 0, swordHandleTop);
    bladeGrad.addColorStop(0, `rgba(255, 0, 80, ${0.3 + 0.2 * glow})`);
    bladeGrad.addColorStop(1, "#ff0050");
    ctx.strokeStyle = bladeGrad;
    ctx.lineWidth = w * 0.015;
    ctx.beginPath();
    ctx.moveTo(swordX, swordHandleTop - w * 0.01);
    ctx.lineTo(swordX, swordHandleTop - headH * 1.2);
    ctx.stroke();

    // nucleo lama (bianco)
    ctx.strokeStyle = `rgba(255, 200, 220, ${0.6 + 0.4 * glow})`;
    ctx.lineWidth = w * 0.005;
    ctx.beginPath();
    ctx.moveTo(swordX, swordHandleTop - w * 0.01);
    ctx.lineTo(swordX, swordHandleTop - headH * 1.2);
    ctx.stroke();

    ctx.shadowBlur = 0;

    // === GAMBE ===
    const legH = h - headH - bodyH;
    const legStartY = bodyStartY + bodyH;
    const legW = w * 0.35;

    // parte alta gambe
    ctx.fillStyle = darkBase;
    ctx.fillRect(startX, legStartY, w, legH * 0.25);

    // gamba sinistra
    ctx.fillRect(startX, legStartY, legW, legH);
    // gamba destra
    ctx.fillRect(startX + w - legW, legStartY, legW, legH);

    // ginocchiere neon
    const kneeH = h * 0.015;
    ctx.shadowColor = neonSolid;
    ctx.shadowBlur = w * 0.025 * glow;
    ctx.fillStyle = neon;
    ctx.fillRect(startX + legW * 0.2, legStartY + legH * 0.4, legW * 0.6, kneeH);
    ctx.fillRect(startX + w - legW + legW * 0.2, legStartY + legH * 0.4, legW * 0.6, kneeH);
    ctx.shadowBlur = 0;

    // stivali
    const bootPad = w * 0.015;
    ctx.fillStyle = darkMid;
    ctx.fillRect(startX - bootPad, legStartY + legH * 0.78, legW + bootPad * 2, legH * 0.22);
    ctx.fillRect(startX + w - legW - bootPad, legStartY + legH * 0.78, legW + bootPad * 2, legH * 0.22);

    // suole neon
    const soleH = h * 0.01;
    ctx.shadowColor = neonSolid;
    ctx.shadowBlur = w * 0.02 * glow;
    ctx.fillStyle = neon;
    ctx.fillRect(startX - bootPad, legStartY + legH - soleH, legW + bootPad * 2, soleH);
    ctx.fillRect(startX + w - legW - bootPad, legStartY + legH - soleH, legW + bootPad * 2, soleH);
    ctx.shadowBlur = 0;

    ctx.restore();
}

function drawPersona4(ctx: CanvasRenderingContext2D, x, y, w, h, style = {}) {
    ctx.save();
    ctx.translate(x, y);

    const startX = -w / 2;
    const startY = -h / 2;

    const headH = h * 0.3;
    const bodyH = h * 0.35;
    const legH = h - headH - bodyH;

    // testa o croce
    ctx.beginPath();
    ctx.fillStyle = "#f5cba7";
    ctx.rect(startX, startY, w, headH);
    ctx.fill();

    // capelli
    ctx.beginPath();
    ctx.fillStyle = "#c87b08";
    ctx.rect(startX, startY, w, headH * 0.35);
    ctx.fill();

    // occhi
    const eyeSize = w * 0.04;
    ctx.fillStyle = "#000";
    ctx.fillRect(startX + w * 0.25, startY + headH * 0.55, eyeSize, eyeSize);
    ctx.fillRect(startX + w * 0.65, startY + headH * 0.55, eyeSize, eyeSize);

    // corpo
    const bodyStartY = startY + headH;

    ctx.beginPath();
    ctx.fillStyle = "#09c1da";
    ctx.rect(startX, bodyStartY, w, bodyH);
    ctx.fill();

    // bracciaaa
    const armLen = w * 0.4;
    ctx.beginPath();
    ctx.fillStyle = "#f5cba7";
    ctx.rect(startX - armLen, bodyStartY, armLen, bodyH * 0.3);
    ctx.rect(startX + w, bodyStartY, armLen, bodyH * 0.3);
    ctx.fill();

    // gambine
    const legStartY = bodyStartY + bodyH;
    const legW = w * 0.35;

    ctx.beginPath();
    ctx.fillStyle = "#2c3e50";
    ctx.rect(startX, legStartY, legW, legH);
    ctx.rect(startX + w - legW, legStartY, legW, legH);
    ctx.fill();

    // scarpe
    const shoeH = h * 0.03;
    ctx.beginPath();
    ctx.fillStyle = "#000";
    ctx.rect(startX, legStartY + legH - shoeH, legW, shoeH);
    ctx.rect(startX + w - legW, legStartY + legH - shoeH, legW, shoeH);
    ctx.fill();

    ctx.restore();
}

function drawPersona2(ctx: CanvasRenderingContext2D, x, y, w, h, style = {}) {
    ctx.save();
    ctx.translate(x, y);
    const startX = -w / 2;
    const startY = -h / 2;

    const headH      = h * 0.30;
    const bodyH      = h * 0.35;
    const legH       = h - headH - bodyH;
    const bodyStartY = startY + headH;
    const legStartY  = bodyStartY + bodyH;

    // ── BERRETTO MARINARO BLU ────────────────────────────────────────
    // cupola
    ctx.fillStyle = "#2a6fd4";
    ctx.fillRect(startX + w * 0.08, startY - headH * 0.48, w * 0.84, headH * 0.42);
    // falda piatta
    ctx.fillStyle = "#2a6fd4";
    ctx.fillRect(startX - w * 0.06, startY - headH * 0.10, w * 1.12, headH * 0.14);
    // nastro nero sul bordo falda
    ctx.fillStyle = "#111111";
    ctx.fillRect(startX - w * 0.06, startY - headH * 0.10, w * 1.12, headH * 0.06);
    // fiocco/nastro nero sul retro (piccolo rettangolo a destra)
    ctx.fillStyle = "#111111";
    ctx.fillRect(startX + w * 0.78, startY - headH * 0.22, w * 0.10, headH * 0.18);

    // ── TESTA (faccia bianca/crema) ──────────────────────────────────
    ctx.fillStyle = "#f5f0e0";
    ctx.fillRect(startX, startY, w, headH * 0.88);

    // guancia destra più chiara (volume cartoon)
    ctx.fillStyle = "#fff8ee";
   ctx.fillRect(startX + w * 0.25, startY + headH * 0.85, w * 0.50, headH * 0.20);

    // occhi (bianchi + pupille nere)
    const eyeY = startY + headH * 0.12;
    const eyeW = w * 0.20;
    const eyeH = headH * 0.32;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(startX + w * 0.08, eyeY, eyeW, eyeH);
    ctx.fillRect(startX + w * 0.60, eyeY, eyeW, eyeH);
    ctx.fillStyle = "#111111";
    ctx.fillRect(startX + w * 0.13, eyeY + eyeH * 0.30, eyeW * 0.45, eyeH * 0.55);
    ctx.fillRect(startX + w * 0.67, eyeY + eyeH * 0.30, eyeW * 0.45, eyeH * 0.55);
    // lucine occhi
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(startX + w * 0.14, eyeY + eyeH * 0.28, eyeW * 0.14, eyeH * 0.18);
    ctx.fillRect(startX + w * 0.68, eyeY + eyeH * 0.28, eyeW * 0.14, eyeH * 0.18);

    // becco arancione (lungo e piatto, stile foto)
    ctx.fillStyle = "#f07800";
    ctx.fillRect(startX + w * 0.18, startY + headH * 0.55, w * 0.70, headH * 0.24);
    // linea centrale becco
    ctx.fillStyle = "#c05a00";
    ctx.fillRect(startX + w * 0.18, startY + headH * 0.65, w * 0.70, headH * 0.04);
    // punta becco (più scura)
    ctx.fillStyle = "#d06000";
    ctx.fillRect(startX + w * 0.72, startY + headH * 0.55, w * 0.16, headH * 0.24);

    // ── BODY (giacca blu come in foto) ───────────────────────────────
    ctx.fillStyle = "#2a6fd4";
    ctx.fillRect(startX, bodyStartY, w, bodyH);

    // petto bianco centrale (camicia/petto papera)
    ctx.fillStyle = "#f5f0e0";
    ctx.fillRect(startX + w * 0.25, bodyStartY, w * 0.50, bodyH);

    // risvolti giacca blu sopra il petto
    ctx.fillStyle = "#2a6fd4";
    ctx.fillRect(startX + w * 0.25, bodyStartY, w * 0.13, bodyH * 0.60); // risvolto sx
    ctx.fillRect(startX + w * 0.62, bodyStartY, w * 0.13, bodyH * 0.60); // risvolto dx

    // papillon rosso al centro
    ctx.fillStyle = "#cc1111";
    ctx.fillRect(startX + w * 0.32, bodyStartY + bodyH * 0.08, w * 0.16, bodyH * 0.16); // ala sx
    ctx.fillRect(startX + w * 0.52, bodyStartY + bodyH * 0.08, w * 0.16, bodyH * 0.16); // ala dx
    // nodo centrale papillon
    ctx.fillStyle = "#991111";
    ctx.fillRect(startX + w * 0.44, bodyStartY + bodyH * 0.10, w * 0.12, bodyH * 0.12);

    // fascia/cintura gialla in vita
    ctx.fillStyle = "#f0c000";
    ctx.fillRect(startX, bodyStartY + bodyH * 0.84, w, bodyH * 0.16);

    // ── BRACCIA (ali blu con guanti bianchi) ─────────────────────────
    const armW = w * 0.18;
    const armH = bodyH * 0.55;
    const armY = bodyStartY + bodyH * 0.08;

    ctx.fillStyle = "#2a6fd4";
    ctx.fillRect(startX - armW * 0.9, armY, armW, armH);           // braccio sx
    ctx.fillRect(startX + w - armW * 0.1, armY, armW, armH);       // braccio dx

    // guanti bianchi
    ctx.fillStyle = "#f5f0e0";
    ctx.fillRect(startX - armW * 1.1, armY + armH * 0.78, armW * 1.3, armH * 0.30); // guanto sx
    ctx.fillRect(startX + w - armW * 0.1, armY + armH * 0.78, armW * 1.3, armH * 0.30); // guanto dx

    // ── GAMBE (zampe bianche + piedi arancioni) ───────────────────────
    const bootH = legH * 0.38;
    const legW  = w * 0.32;

    ctx.fillStyle = "#f5f0e0";
    ctx.fillRect(startX + w * 0.04, legStartY, legW, legH - bootH);
    ctx.fillRect(startX + w * 0.64, legStartY, legW, legH - bootH);

    // piedi arancioni esagerati
    ctx.fillStyle = "#f07800";
    ctx.fillRect(startX - w * 0.04, startY + h - bootH, legW * 1.4, bootH);
    ctx.fillRect(startX + w * 0.58, startY + h - bootH, legW * 1.4, bootH);

    ctx.restore();
}

function drawClashRoyaleKnight(ctx: CanvasRenderingContext2D, x, y, w, h, style = {}) {
    ctx.save();

    // move origin (x=0, y=0) to the person center
    ctx.translate(x, y);
    const startX = -w/2;
    const startY = -h/2;

    // +head (Elmo rosso)
    const headH = h * 0.3;

    // Viso
    ctx.beginPath();
    ctx.fillStyle = "#d4a574"; // pelle
    ctx.rect(startX, startY + headH*0.4, w, headH*0.6);
    ctx.fill();

    // Elmo rosso
    ctx.beginPath();
    ctx.fillStyle = "#e32f2f"; // rosso brillante
    ctx.rect(startX, startY, w, headH*0.5);
    ctx.fill();

    // Visiera dorata
    ctx.beginPath();
    ctx.fillStyle = "#ffd700";
    ctx.rect(startX, startY + headH*0.35, w, headH*0.15);
    ctx.fill();

    // Occhi (sfondo scuro)
    ctx.beginPath();
    ctx.fillStyle = "#000000";
    const eyeW = w * 0.12;
    const eyeH = w * 0.1;
    ctx.rect(startX + w*0.2, startY + headH*0.5, eyeW, eyeH);
    ctx.rect(startX + w*0.68, startY + headH*0.5, eyeW, eyeH);
    ctx.fill();

    // Bocca
    ctx.beginPath();
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = w * 0.005;
    ctx.moveTo(startX + w*0.25, startY + headH*0.75);
    ctx.lineTo(startX + w*0.75, startY + headH*0.75);
    ctx.stroke();
    // -head

    // +body (Armatura grigia/nera)
    const bodyStartY = startY + headH;
    const bodyH = h * 0.35;
    const armLen = 0.4 * w;

    // Corpo armatura
    ctx.beginPath();
    ctx.fillStyle = "#4a4a4a"; // grigio scuro armatura
    ctx.rect(startX, bodyStartY, w, bodyH);
    ctx.fill();

    // Dettagli armatura (crocchia)
    ctx.beginPath();
    ctx.strokeStyle = "#2a2a2a";
    ctx.lineWidth = w * 0.01;
    ctx.moveTo(startX + w*0.25, bodyStartY);
    ctx.lineTo(startX + w*0.25, bodyStartY + bodyH);
    ctx.moveTo(startX + w*0.75, bodyStartY);
    ctx.lineTo(startX + w*0.75, bodyStartY + bodyH);
    ctx.stroke();

    // Braccia con armatura
    const armPad2 = w * 0.025;
    ctx.beginPath();
    ctx.fillStyle = "#4a4a4a";
    ctx.rect(startX - armLen, bodyStartY + armPad2, armLen - armPad2, 0.4*bodyH);
    ctx.rect(startX + w + armPad2, bodyStartY + armPad2, armLen - armPad2, 0.4*bodyH);
    ctx.fill();

    // Guanti scuri
    const gloveR = w * 0.025;
    ctx.beginPath();
    ctx.fillStyle = "#1a1a1a";
    ctx.arc(startX - armLen + w * 0.015, bodyStartY + 0.2*bodyH, gloveR, 0, Math.PI * 2);
    ctx.arc(startX + w + armLen - w * 0.015, bodyStartY + 0.2*bodyH, gloveR, 0, Math.PI * 2);
    ctx.fill();

    // Scudo sulla sinistra
    const shieldW = w * 0.05;
    ctx.beginPath();
    ctx.fillStyle = "#3a3a3a";
    ctx.rect(startX - armLen - w * 0.04, bodyStartY, shieldW, 0.6*bodyH);
    ctx.fill();
    
    ctx.beginPath();
    ctx.fillStyle = "#ffd700";
    ctx.rect(startX - armLen - w * 0.03, bodyStartY + w * 0.025, w * 0.03, 0.5*bodyH);
    ctx.fill();

    // Spada sulla destra
    ctx.beginPath();
    ctx.strokeStyle = "#c0c0c0";
    ctx.lineWidth = w * 0.015;
    ctx.moveTo(startX + w + armLen, bodyStartY);
    ctx.lineTo(startX + w + armLen + w * 0.025, bodyStartY - h * 0.08);
    ctx.stroke();

    // Punta spada
    ctx.beginPath();
    ctx.fillStyle = "#c0c0c0";
    ctx.moveTo(startX + w + armLen + w * 0.025, bodyStartY - h * 0.08);
    ctx.lineTo(startX + w + armLen + w * 0.04, bodyStartY - h * 0.13);
    ctx.lineTo(startX + w + armLen + w * 0.01, bodyStartY - h * 0.09);
    ctx.fill();
    // -body

    // +legs (Armatura e stivali)
    const legH = h - headH - bodyH;
    const legStartY = bodyStartY + bodyH;
    const legW = w * 0.35;

    // Pantaloni armatura
    ctx.beginPath();
    ctx.fillStyle = "#4a4a4a";
    ctx.rect(startX, legStartY, legW, legH*0.7); // sinistra
    ctx.rect(startX + w - legW, legStartY, legW, legH*0.7); // destra
    ctx.fill();

    // Unione pantaloni
    ctx.beginPath();
    ctx.fillStyle = "#4a4a4a";
    ctx.rect(startX, legStartY, w, legH*0.2);
    ctx.fill();

    // Stivali neri
    ctx.beginPath();
    ctx.fillStyle = "#1a1a1a";
    ctx.rect(startX, legStartY + legH*0.7, legW, legH*0.3);
    ctx.rect(startX + w - legW, legStartY + legH*0.7, legW, legH*0.3);
    ctx.fill();

    // Dettagli stivali (dorature)
    ctx.beginPath();
    ctx.fillStyle = "#ffd700";
    const bootTrim = w * 0.015;
    ctx.rect(startX + bootTrim, legStartY + legH*0.75, legW - bootTrim * 2, h * 0.015);
    ctx.rect(startX + w - legW + bootTrim, legStartY + legH*0.75, legW - bootTrim * 2, h * 0.015);
    ctx.fill();
    // -legs

    ctx.restore();
}

export type CharacterDrawFunction = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    style?: Record<string, any>
) => void;

const drawFunctions: Record<string, CharacterDrawFunction> = {
    normalGuy: drawNormalGuy,
    persona1: persona1,
    persona2: drawPersona2,
    persona4: drawPersona4,
    persona6: drawPersona6,
    persona7: drawPersona7,
    persona8: drawPersonaggio8,
    persona10: drawPersonaggio10,
    persona11: draw11,
    persona13: drawPersonaggio13,
    persona15: drawPersona15,
    batman: drawBatman,
    clashRoyaleKnight: drawClashRoyaleKnight,
}

function defaultDrawFunction(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, style: any = {}) {
    ctx.save();

    ctx.translate(x, y);
    const startX = -w / 2;
    const startY = -h / 2;

    ctx.beginPath();
    ctx.fillStyle = "#FF00FF";
    ctx.rect(startX, startY, w, h);
    ctx.fill();

    ctx.restore();
}

export function getCharacterNames(): string[] {
    return Object.keys(drawFunctions);
}

export function getCharacterDrawFunction(characterName: string): CharacterDrawFunction {
    const drawFunction = drawFunctions[characterName];
    return drawFunction || defaultDrawFunction;
}