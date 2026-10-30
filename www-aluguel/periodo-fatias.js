// Seletor de período "estilo Power BI" do Painel e dos Indicadores: botões de ano, de trimestre (1º a 4º) e de mês (jan a dez).
// Códigos: "2026" = ano inteiro, "2026-T2" = trimestre, "2026-03" = mês. Tocar de novo no trimestre/mês escolhido volta ao ano.
// Meses e trimestres que ainda não começaram ficam desligados.
(function () {
    "use strict";
    const MESES = [ "jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez" ];
    const MESES_LONGOS = [ "janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro" ];
    const pad = n => String(n).padStart(2, "0");
    const fimMes = (a, m) => `${a}-${pad(m)}-${pad(new Date(a, m, 0).getDate())}`;

    function ler(codigo) {
        const c = String(codigo || "");
        let m = c.match(/^(\d{4})$/); if (m) return { tipo: "ano", ano: +m[1] };
        m = c.match(/^(\d{4})-T([1-4])$/); if (m) return { tipo: "tri", ano: +m[1], tri: +m[2] };
        m = c.match(/^(\d{4})-(\d{2})$/); if (m) return { tipo: "mes", ano: +m[1], mes: +m[2] };
        return null;
    }
    // [início, fim] em AAAA-MM-DD, ou null se não for um código de ano/trimestre/mês
    function intervalo(codigo) {
        const f = ler(codigo);
        if (!f) return null;
        if (f.tipo === "ano") return [ `${f.ano}-01-01`, `${f.ano}-12-31` ];
        if (f.tipo === "tri") return [ `${f.ano}-${pad(f.tri * 3 - 2)}-01`, fimMes(f.ano, f.tri * 3) ];
        return [ `${f.ano}-${pad(f.mes)}-01`, fimMes(f.ano, f.mes) ];
    }
    function rotulo(codigo) {
        const f = ler(codigo);
        if (!f) return "";
        if (f.tipo === "ano") return String(f.ano);
        if (f.tipo === "tri") return `${f.tri}º trimestre de ${f.ano}`;
        return `${MESES_LONGOS[f.mes - 1]} de ${f.ano}`;
    }
    // trimestre de referência (metas): o do código, o do mês, o último do ano passado ou o atual
    function trimestre(codigo) {
        const f = ler(codigo), hoje = new Date(), anoAtual = hoje.getFullYear(), triAtual = Math.floor(hoje.getMonth() / 3) + 1;
        if (!f) return { ano: anoAtual, tri: triAtual };
        if (f.tipo === "tri") return { ano: f.ano, tri: f.tri };
        if (f.tipo === "mes") return { ano: f.ano, tri: Math.floor((f.mes - 1) / 3) + 1 };
        return { ano: f.ano, tri: f.ano < anoAtual ? 4 : triAtual };
    }

    // desenha os botões em `box`; opcoes = { codigo, anoInicial, aoEscolher(codigo) }
    function montar(box, opcoes) {
        if (!box) return;
        const hoje = new Date(), anoAtual = hoje.getFullYear(), mesAtual = hoje.getMonth() + 1;
        const f = ler(opcoes.codigo);
        const ano = f ? f.ano : anoAtual;
        const primeiro = Math.min(anoAtual, Math.max(2000, Number(opcoes.anoInicial) || anoAtual - 1));
        const anos = [];
        for (let a = primeiro; a <= anoAtual; a++) anos.push(a);
        const futuro = (a, mes) => a > anoAtual || (a === anoAtual && mes > mesAtual);
        const botao = (cod, texto, ativo, desligado, extra) =>
            `<button type="button" data-fatia="${cod}" aria-pressed="${ativo ? "true" : "false"}"${desligado ? " disabled" : ""}${extra || ""}>${texto}</button>`;
        box.innerHTML = `
          <div class="fatias-linha" role="group" aria-label="Ano">${anos.map(a => botao(String(a), a, !!f && f.ano === a && f.tipo === "ano", false,
              !!f && f.ano === a && f.tipo !== "ano" ? ' class="fatia-ano-base"' : "")).join("")}</div>
          <div class="fatias-linha" role="group" aria-label="Trimestre">${[ 1, 2, 3, 4 ].map(t => botao(`${ano}-T${t}`, `${t}º tri`,
              !!f && f.tipo === "tri" && f.ano === ano && f.tri === t, futuro(ano, t * 3 - 2))).join("")}</div>
          <div class="fatias-linha fatias-meses" role="group" aria-label="Mês">${MESES.map((m, i) => botao(`${ano}-${pad(i + 1)}`, m,
              !!f && f.tipo === "mes" && f.ano === ano && f.mes === i + 1, futuro(ano, i + 1))).join("")}</div>`;
        box.querySelectorAll("[data-fatia]").forEach(b => b.addEventListener("click", () => {
            const cod = b.dataset.fatia;
            const escolhido = b.getAttribute("aria-pressed") === "true" && cod !== String(ano) ? String(ano) : cod;
            opcoes.aoEscolher(escolhido);
        }));
    }

    window.SKLFatias = { ler, intervalo, rotulo, trimestre, montar };
})();
