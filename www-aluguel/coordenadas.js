// Leitura da coordenada colada no cadastro do imóvel ("Link do Google Maps ou coordenada").
// Mesmo arquivo no navegador (window.SKLCoordenadas) e nos testes (require).
//
// Ordem de confiança (10/11/2026, depois do ponto que caía no interior de SP):
//   1) coordenada digitada: "-16.4761899, -54.617013", com vírgula decimal ("-16,4761899; -54,617013") ou em graus
//      (16°28'34.3"S 54°37'01.2"W);
//   2) ponto DO LUGAR no link: !3d<lat>!4d<lng> (se houver mais de um, o último);
//   3) coordenada explícita no link: q= / query= / ll= / destination= / daddr= ou /search|place|dir/lat,lng.
// O @lat,lng de um link é só o CENTRO DA TELA de quem compartilhou: fica de fora de ler() e só é usado por
// centroDoLink(), como último recurso e avisando que é aproximado.
(function (raiz) {
    "use strict";
    const N = "(-?\\d{1,3}(?:\\.\\d+)?)";

    function valida(lat, lng) {
        return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
    }
    function par(m, fonte) {
        if (!m) return null;
        const lat = parseFloat(String(m[1]).replace(",", ".")), lng = parseFloat(String(m[2]).replace(",", "."));
        return valida(lat, lng) ? { lat, lng, fonte } : null;
    }
    function decodificar(texto) {
        let t = String(texto || "");
        try { t = decodeURIComponent(t); } catch (e) { /* usa como veio */ }
        return t.replace(/\+/g, " ");
    }
    // número de latitude/longitude digitado no campo (aceita vírgula decimal); fora da faixa = NaN
    function numero(valor, limite) {
        const v = parseFloat(String(valor == null ? "" : valor).trim().replace(",", "."));
        return Number.isFinite(v) && Math.abs(v) <= limite && /^\s*-?\d+(?:[.,]\d+)?\s*$/.test(String(valor)) ? v : NaN;
    }
    function ehLink(texto) { return /^\s*https?:\/\//i.test(String(texto || "")); }
    function ehLinkGoogle(texto) {
        return /^\s*https:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs|(www\.|maps\.)?google\.com(\.br)?\/maps|maps\.google\.com(\.br)?\/)/i.test(String(texto || ""));
    }

    function ler(texto) {
        const bruto = String(texto || "").trim();
        if (!bruto) return null;
        if (!ehLink(bruto)) {
            const solta = par(bruto.match(/^\s*(-?\d{1,3}(?:[.,]\d+)?)\s*(?:[,;]\s*|\s+)(-?\d{1,3}(?:[.,]\d+)?)\s*$/), "digitada");
            if (solta) return solta;
            const g = /(\d{1,3})\s*°\s*(\d{1,2})\s*['′]\s*([\d.,]+)\s*(?:["″]|'')?\s*([NS])[\s,;]+(\d{1,3})\s*°\s*(\d{1,2})\s*['′]\s*([\d.,]+)\s*(?:["″]|'')?\s*([LOEW])/i.exec(bruto);
            if (g) {
                const grau = (a, b, c, h) => (Number(a) + Number(b) / 60 + parseFloat(c.replace(",", ".")) / 3600) * (/[SOW]/i.test(h) ? -1 : 1);
                const lat = grau(g[1], g[2], g[3], g[4]), lng = grau(g[5], g[6], g[7], g[8]);
                if (valida(lat, lng)) return { lat, lng, fonte: "digitada" };
            }
            return null;
        }
        const t = decodificar(bruto);
        const lugares = [ ...t.matchAll(new RegExp(`!3d${N}!4d${N}`, "g")) ];
        for (let i = lugares.length - 1; i >= 0; i--) {
            const c = par(lugares[i], "lugar");
            if (c) return c;
        }
        return par(t.match(new RegExp(`[?&](?:q|query|ll|destination|daddr)=(?:loc:)?\\s*${N}\\s*,\\s*${N}(?:[&#]|$)`)), "coordenada")
            || par(t.match(new RegExp(`/(?:search|place|dir)/${N},\\s*${N}(?:[/?#]|$)`)), "coordenada");
    }
    function centroDoLink(texto) {
        if (!ehLink(texto)) return null;
        return par(decodificar(texto).match(new RegExp(`@${N},\\s*${N}`)), "centro_do_link");
    }

    const api = { ler, centroDoLink, numero, ehLink, ehLinkGoogle, valida };
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    else raiz.SKLCoordenadas = api;
})(typeof window !== "undefined" ? window : globalThis);
