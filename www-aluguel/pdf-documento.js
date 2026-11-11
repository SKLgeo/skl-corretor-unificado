// Documentos (proposta, recibo, ficha, contrato…): "⬇ Baixar PDF" e "🖨 Imprimir" (11/11/2026, pedido da Cerrado).
//
// Baixar PDF: o próprio app monta o PDF em A4, página por página (html2canvas + jsPDF, MIT, carregados só na hora em
// vendor/pdf/), sem passar pela impressão do aparelho. Assim o iPhone não corta mais as bordas: antes o PDF era feito
// pela impressão do Safari, que põe margens e cabeçalho próprios e ignora o "@page margin:0" — a folha de 210×297 mm
// não cabia no A4 (cortava a direita e cada página virava duas; no A3 cabia).
//   Celular: abre o compartilhar do aparelho ("Salvar em Arquivos", WhatsApp, e-mail…).
//   Computador / programa Windows: pergunta onde salvar (quando o navegador deixa); senão baixa na pasta de downloads.
// Imprimir: vai para a impressora. No Safari (iPhone/iPad/Mac) cada folha é reduzida (78%) para caber na margem que
// ele impõe; nos outros navegadores a folha sai em tamanho real.
(function () {
    "use strict";
    const A4 = { w: 210, h: 297 };
    const ehSafari = () => {
        const ua = navigator.userAgent || "";
        const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
        return ios || (/Safari/.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|Edg|Android/.test(ua));
    };
    const toque = () => !!(window.matchMedia && matchMedia("(pointer: coarse)").matches);

    let carregando = null;
    function carregarLibs() {
        if (window.html2canvas && window.jspdf) return Promise.resolve();
        if (carregando) return carregando;
        const um = src => new Promise((ok, erro) => {
            const s = document.createElement("script");
            s.src = src; s.onload = ok; s.onerror = () => erro(new Error("Não foi possível carregar o gerador de PDF (sem internet?)."));
            document.head.appendChild(s);
        });
        carregando = um("vendor/pdf/html2canvas.min.js").then(() => um("vendor/pdf/jspdf.umd.min.js")).catch(e => { carregando = null; throw e; });
        return carregando;
    }

    const nomeSeguro = s => String(s || "documento").normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/[^\w .-]+/g, "").replace(/\s+/g, " ").trim().slice(0, 80) || "documento";

    async function capturar(el) {
        // fotos do documento vêm do Storage (links assinados): o html2canvas precisa delas carregadas antes
        await Promise.all([ ...el.querySelectorAll("img") ].map(i => i.complete ? null : new Promise(ok => { i.onload = i.onerror = ok; })));
        return window.html2canvas(el, {
            scale: 2, useCORS: true, backgroundColor: "#ffffff", logging: false,
            width: el.offsetWidth, height: el.offsetHeight, windowWidth: Math.max(1200, el.offsetWidth + 40),
            onclone: doc => {
                // sem a sombra de "papel na tela" e sem zoom da tela do celular
                doc.documentElement.style.zoom = "1";
                doc.querySelectorAll(".pp-pg").forEach(p => { p.style.boxShadow = "none"; p.style.margin = "0"; });
            }
        });
    }

    async function montar(conteudo) {
        await carregarLibs();
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
        const paginas = [ ...conteudo.querySelectorAll(".pp-pg") ];
        if (paginas.length) {
            // documento já em folhas A4 (proposta): uma imagem por folha, ocupando a folha inteira
            for (let i = 0; i < paginas.length; i++) {
                const cv = await capturar(paginas[i]);
                if (i) pdf.addPage();
                pdf.addImage(cv.toDataURL("image/jpeg", 0.9), "JPEG", 0, 0, A4.w, A4.h);
            }
        } else {
            // documento corrido (recibo, ficha, contrato…): A4 com margem de 12 mm, cortado em páginas
            const el = conteudo.firstElementChild || conteudo;
            const cv = await capturar(el);
            const margem = 12, largura = A4.w - 2 * margem, alturaUtil = A4.h - 2 * margem;
            const pxPorMm = cv.width / largura, fatiaPx = Math.floor(alturaUtil * pxPorMm);
            for (let y = 0, n = 0; y < cv.height; y += fatiaPx, n++) {
                const h = Math.min(fatiaPx, cv.height - y);
                const parte = document.createElement("canvas");
                parte.width = cv.width; parte.height = h;
                const c = parte.getContext("2d"); c.fillStyle = "#fff"; c.fillRect(0, 0, parte.width, h);
                c.drawImage(cv, 0, y, cv.width, h, 0, 0, cv.width, h);
                if (n) pdf.addPage();
                pdf.addImage(parte.toDataURL("image/jpeg", 0.9), "JPEG", margem, margem, largura, h / pxPorMm);
            }
        }
        return pdf.output("blob");
    }

    async function entregar(blob, nome) {
        const arquivo = new File([ blob ], nome + ".pdf", { type: "application/pdf" });
        if (toque() && navigator.canShare && navigator.share) {
            let pode = false;
            try { pode = navigator.canShare({ files: [ arquivo ] }); } catch { pode = false; }
            if (pode) {
                try { await navigator.share({ files: [ arquivo ], title: nome }); return "ok"; }
                catch (e) {
                    if (e && e.name === "AbortError") return "cancelado";
                    if (e && e.name === "NotAllowedError") return "toque";   // iPhone: precisa de um toque novo
                }
            }
        }
        if (!toque() && window.showSaveFilePicker) {
            try {
                const h = await window.showSaveFilePicker({ suggestedName: nome + ".pdf", types: [ { description: "PDF", accept: { "application/pdf": [ ".pdf" ] } } ] });
                const w = await h.createWritable(); await w.write(blob); await w.close();
                return "salvo";
            } catch (e) {
                if (e && e.name === "AbortError") return "cancelado";
                /* sem permissão: baixa do jeito comum */
            }
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = nome + ".pdf"; a.rel = "noopener";
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        return "baixado";
    }

    // conteudo: elemento com o documento; nome: nome do arquivo; botao: mostra o andamento; avisar: toast
    let pronto = null;   // { chave, blob } — no iPhone o 2º toque entrega o PDF já pronto
    async function baixar(conteudo, { nome, botao, avisar } = {}) {
        const rotulo = botao ? (botao.dataset.rotulo || (botao.dataset.rotulo = botao.textContent)) : "";
        const chave = conteudo.innerHTML.length + "|" + (nome || "");
        const arquivo = nomeSeguro(nome || (conteudo.querySelector("h1,h2,h3") || {}).textContent);
        try {
            let blob = pronto && pronto.chave === chave ? pronto.blob : null;
            if (!blob) {
                if (botao) { botao.disabled = true; botao.textContent = "Gerando o PDF…"; }
                blob = await montar(conteudo);
                pronto = { chave, blob };
            }
            if (botao) { botao.disabled = false; botao.textContent = rotulo; }
            const r = await entregar(blob, arquivo);
            if (r === "toque" && botao) { botao.textContent = "📲 Toque para salvar o PDF"; return; }
            if (avisar && r === "salvo") avisar("PDF salvo.");
            if (avisar && r === "baixado") avisar("PDF baixado.");
        } catch (e) {
            if (botao) { botao.disabled = false; botao.textContent = rotulo; }
            if (avisar) avisar((e && e.message) || "Não foi possível gerar o PDF.");
        }
    }

    function imprimir() {
        document.documentElement.classList.toggle("imprimir-safari", ehSafari());
        if (window.NativeBridge && typeof window.NativeBridge.printPage === "function") window.NativeBridge.printPage();
        else window.print();
    }

    window.SKLPdf = { baixar, imprimir, ehSafari };
})();
