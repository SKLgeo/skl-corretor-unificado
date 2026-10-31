// PIX "copia e cola" (BR Code estático do Banco Central) com a chave da própria imobiliária: sem banco intermediário, sem tarifa.
// window.SKLPix.payload({ chave, nome, cidade, valor, txid }) → texto do copia e cola (o mesmo texto vira o QR Code).
// Formato EMV/BR Code: campos ID + tamanho (2 dígitos) + valor; termina com o CRC16-CCITT (0x1021, início 0xFFFF).
(function () {
    "use strict";
    const semAcento = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7E]/g, "");
    const campo = (id, valor) => id + String(valor.length).padStart(2, "0") + valor;

    function crc16(texto) {
        let crc = 0xFFFF;
        for (let i = 0; i < texto.length; i++) {
            crc ^= texto.charCodeAt(i) << 8;
            for (let b = 0; b < 8; b++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
        }
        return crc.toString(16).toUpperCase().padStart(4, "0");
    }

    // chave como o banco espera: e-mail em minúsculas; CPF/CNPJ só números; celular +55...; aleatória como veio
    function normalizarChave(chave) {
        const c = String(chave || "").trim();
        if (c.includes("@")) return c.toLowerCase();
        if (/^\+/.test(c)) return "+" + c.replace(/\D/g, "");
        if (/^[\d.\-\/\s()]+$/.test(c)) return c.replace(/\D/g, "");
        return c;
    }

    function payload(o) {
        const conta = campo("00", "br.gov.bcb.pix") + campo("01", normalizarChave(o.chave));
        const valor = Number(o.valor) > 0 ? Number(o.valor).toFixed(2) : "";
        const txid = semAcento(o.txid).replace(/[^A-Za-z0-9]/g, "").slice(0, 25) || "***";
        let p = campo("00", "01")
            + campo("26", conta)
            + campo("52", "0000")
            + campo("53", "986")
            + (valor ? campo("54", valor) : "")
            + campo("58", "BR")
            + campo("59", semAcento(o.nome).toUpperCase().slice(0, 25) || "RECEBEDOR")
            + campo("60", semAcento(o.cidade).toUpperCase().slice(0, 15) || "BRASIL")
            + campo("62", campo("05", txid))
            + "6304";
        return p + crc16(p);
    }

    window.SKLPix = { payload, crc16, normalizarChave };
})();
