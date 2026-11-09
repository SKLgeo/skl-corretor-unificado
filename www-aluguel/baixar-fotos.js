// Baixar fotos do imóvel (09/11/2026, pedido da Cerrado): botão na foto em tela cheia e "Baixar todas as fotos" na ficha.
// Só dentro do sistema (a página do imóvel enviada ao cliente não tem). As fotos saem como estão guardadas (com a marca d'água).
// Celular/tablet: abre a janela de compartilhar do aparelho ("Salvar imagens"). Computador: uma foto baixa direto; várias saem num .zip.
// O iPhone só abre o compartilhar logo depois de um toque: se a preparação demorar, o botão vira "Toque para salvar" e o 2º toque entrega.
(function () {
    "use strict";
    const prontos = new Map(); // chave da lista → File[] já baixados

    // ---------- .zip sem compressão (fotos já são comprimidas), sem biblioteca
    const TAB = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
    function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = TAB[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
    async function zip(arquivos) {
        const partes = [], central = [];
        let pos = 0;
        const agora = new Date();
        const hora = (agora.getHours() << 11) | (agora.getMinutes() << 5) | (agora.getSeconds() >> 1);
        const data = ((agora.getFullYear() - 1980) << 9) | ((agora.getMonth() + 1) << 5) | agora.getDate();
        for (const f of arquivos) {
            const dados = new Uint8Array(await f.arrayBuffer());
            const nome = new TextEncoder().encode(f.name);
            const crc = crc32(dados);
            const loc = new DataView(new ArrayBuffer(30));
            loc.setUint32(0, 0x04034b50, true); loc.setUint16(4, 20, true); loc.setUint16(6, 0x0800, true); loc.setUint16(8, 0, true);
            loc.setUint16(10, hora, true); loc.setUint16(12, data, true); loc.setUint32(14, crc, true);
            loc.setUint32(18, dados.length, true); loc.setUint32(22, dados.length, true); loc.setUint16(26, nome.length, true); loc.setUint16(28, 0, true);
            partes.push(loc.buffer, nome, dados);
            const cen = new DataView(new ArrayBuffer(46));
            cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true); cen.setUint16(10, 0, true);
            cen.setUint16(12, hora, true); cen.setUint16(14, data, true); cen.setUint32(16, crc, true);
            cen.setUint32(20, dados.length, true); cen.setUint32(24, dados.length, true); cen.setUint16(28, nome.length, true);
            cen.setUint32(42, pos, true);
            central.push(cen.buffer, nome);
            pos += 30 + nome.length + dados.length;
        }
        const tamCentral = central.reduce((s, p) => s + (p.byteLength || p.length), 0);
        const fim = new DataView(new ArrayBuffer(22));
        fim.setUint32(0, 0x06054b50, true); fim.setUint16(8, arquivos.length, true); fim.setUint16(10, arquivos.length, true);
        fim.setUint32(12, tamCentral, true); fim.setUint32(16, pos, true);
        return new Blob([ ...partes, ...central, fim.buffer ], { type: "application/zip" });
    }

    function baixarBlob(blob, nome) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = nome; a.rel = "noopener";
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
    const toque = () => !!(window.matchMedia && matchMedia("(pointer: coarse)").matches);
    const nomeSeguro = s => String(s || "imovel").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "imovel";

    async function preparar(itens) {
        const arquivos = [];
        for (const it of itens) {
            const url = typeof it.url === "function" ? await it.url() : it.url;
            if (!url) continue;
            const r = await fetch(url, { cache: "force-cache" });
            if (!r.ok) throw new Error("Não foi possível baixar uma das fotos.");
            const blob = await r.blob();
            const ext = (blob.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
            arquivos.push(new File([ blob ], nomeSeguro(it.nome) + "." + ext, { type: blob.type || "image/jpeg" }));
        }
        if (!arquivos.length) throw new Error("Nenhuma foto para baixar.");
        return arquivos;
    }
    async function entregar(arquivos, nomeZip) {
        if (toque() && navigator.canShare && navigator.share) {
            let pode = false;
            try { pode = navigator.canShare({ files: arquivos }); } catch { pode = false; }
            if (pode) {
                try { await navigator.share({ files: arquivos }); return "ok"; }
                catch (e) {
                    if (e && e.name === "AbortError") return "cancelado";
                    if (e && e.name === "NotAllowedError") return "toque";
                    throw e;
                }
            }
        }
        if (arquivos.length === 1) baixarBlob(arquivos[0], arquivos[0].name);
        else baixarBlob(await zip(arquivos), nomeSeguro(nomeZip) + ".zip");
        return "ok";
    }

    // itens: [{ url: string | () => Promise<string>, nome }]; botao: o botão clicado (mostra o andamento); avisar: toast
    async function baixar(itens, { botao, nomeZip, avisar } = {}) {
        if (!itens || !itens.length) { if (avisar) avisar("Este imóvel ainda não tem fotos."); return; }
        const chave = itens.map(i => i.chave || i.nome).join("|");
        const rotulo = botao ? (botao.dataset.rotulo || (botao.dataset.rotulo = botao.textContent)) : "";
        try {
            let arquivos = prontos.get(chave);
            if (!arquivos) {
                if (botao) { botao.disabled = true; botao.textContent = itens.length > 1 ? `Preparando ${itens.length} fotos…` : "Preparando…"; }
                arquivos = await preparar(itens);
                prontos.set(chave, arquivos);
                if (prontos.size > 6) prontos.delete(prontos.keys().next().value);
            }
            if (botao) { botao.disabled = false; botao.textContent = rotulo; }
            const r = await entregar(arquivos, nomeZip || "fotos-do-imovel");
            if (r === "toque" && botao) {
                botao.textContent = arquivos.length > 1 ? `📲 Toque para salvar ${arquivos.length} fotos` : "📲 Toque para salvar";
                return;
            }
            if (r === "ok" && !toque() && avisar) avisar(arquivos.length > 1 ? `${arquivos.length} fotos baixadas num arquivo .zip.` : "Foto baixada.");
        } catch (e) {
            if (botao) { botao.disabled = false; botao.textContent = rotulo; }
            if (avisar) avisar((e && e.message) || "Não foi possível baixar as fotos.");
        }
    }

    window.SKLBaixarFotos = { baixar, zip };
})();
