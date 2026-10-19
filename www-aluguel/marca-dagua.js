// Marca d'água nas fotos dos imóveis (contra cópia por outras imobiliárias).
// Só age quando a marca do cliente pede (window.SKL_MARCA.marca_dagua, escrito pelo Web_Imobiliaria/gerar.js):
//   { imagem: "marca-dagua.png", opacidade: 0.3, largura: 0.42, max_px: 1920, qualidade: 0.85 }
// A foto é reduzida (lado maior até max_px), recebe a logo transparente no centro e vira JPEG — a marca fica gravada
// no arquivo, então vale no app, no site e nos portais. Sem configuração (app da SKL) a foto sobe como veio.
// Se o navegador não conseguir abrir a imagem (ex.: HEIC no Chrome), a foto também sobe como veio.
window.SKLMarcaDagua = (() => {
    const cfg = () => (window.SKL_MARCA && window.SKL_MARCA.marca_dagua) || null;
    let logoPromessa = null;

    function carregarImagem(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error("não abriu " + src));
            img.src = src;
        });
    }

    async function abrirFoto(file) {
        if (window.createImageBitmap) {
            try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch (_) { /* tenta pelo <img> */ }
        }
        const url = URL.createObjectURL(file);
        try { return await carregarImagem(url); } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
    }

    function ativa() { return !!(cfg() && cfg().imagem); }

    async function preparar(file) {
        const c = cfg();
        if (!c || !c.imagem || !file || !/^image\//.test(file.type || "image/")) return file;
        try {
            if (!logoPromessa) logoPromessa = carregarImagem(c.imagem);
            const [foto, logo] = await Promise.all([ abrirFoto(file), logoPromessa ]);
            const max = Number(c.max_px) || 1920;
            const escala = Math.min(1, max / Math.max(foto.width, foto.height));
            const w = Math.round(foto.width * escala), h = Math.round(foto.height * escala);
            const canvas = document.createElement("canvas");
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(foto, 0, 0, w, h);
            if (foto.close) foto.close();
            // logo no centro: largura proporcional à foto, sem passar de 40% da altura
            let lw = w * (Number(c.largura) || 0.42);
            let lh = lw * logo.height / logo.width;
            if (lh > h * 0.4) { lh = h * 0.4; lw = lh * logo.width / logo.height; }
            ctx.globalAlpha = Math.min(1, Math.max(0.05, Number(c.opacidade) || 0.3));
            // sombra leve: a logo clara continua legível em parede branca ou céu
            if (c.sombra !== false) {
                ctx.shadowColor = "rgba(0,0,0,0.55)";
                ctx.shadowBlur = Math.max(2, lw * 0.012);
                ctx.shadowOffsetX = ctx.shadowOffsetY = Math.max(1, lw * 0.003);
            }
            ctx.drawImage(logo, (w - lw) / 2, (h - lh) / 2, lw, lh);
            ctx.globalAlpha = 1;
            ctx.shadowColor = "transparent";
            const blob = await new Promise(r => canvas.toBlob(r, "image/jpeg", Number(c.qualidade) || 0.85));
            if (!blob) return file;
            const nome = (file.name || "foto").replace(/\.[^.]+$/, "") + ".jpg";
            return new File([ blob ], nome, { type: "image/jpeg", lastModified: Date.now() });
        } catch (erro) {
            console.warn("Marca d'água não aplicada:", erro);
            return file;
        }
    }

    return { ativa, preparar };
})();
