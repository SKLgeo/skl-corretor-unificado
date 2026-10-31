// Financeiro → aba "🏦 Extrato do banco": baixa dos aluguéis pelo extrato que a imobiliária baixa no internet banking (OFX ou CSV).
// O arquivo é lido aqui no aparelho (não sobe para lugar nenhum). Cada crédito é casado com a cobrança em aberto pelo valor
// (com ou sem multa/juros na data do pagamento), pela data, pelo nome do inquilino no histórico e pelo código do PIX do portal.
// Nada é baixado sem a pessoa confirmar. A baixa é a de sempre (RPC fin_conciliar_extrato → fin_registrar_pagamento), e cada
// linha usada fica guardada em fin_extrato_lancamentos: importar o mesmo extrato de novo não baixa duas vezes.
(function () {
    "use strict";
    let ctx = null, ligado = false;
    let arquivo = null;          // { nome, lancamentos: [{chave, data, valor, descricao}] }
    let analise = null;          // resultado do casamento
    let historico = [];
    const $ = id => document.getElementById(id);
    const h = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const pode = () => !!ctx && ctx.podeGerir();
    const erro = e => ctx.traduzErro((e && e.message) || String(e || ""));
    const dinheiro = v => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    const dataBr = iso => iso ? new Date(String(iso).slice(0, 10) + "T12:00:00").toLocaleDateString("pt-BR") : "—";
    const mesAno = iso => iso ? new Date(String(iso).slice(0, 10) + "T12:00:00").toLocaleDateString("pt-BR", { month: "short", year: "numeric" }) : "—";
    const r2 = n => Math.round(Number(n) * 100) / 100;
    const IGNORAR = "__ignorar";

    // ------------------------------------------------------------------ leitura do arquivo (funções puras)
    const normal = t => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    function diasEntre(a, b) { return Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 86400000); }
    function decodificar(buffer) {
        try { return new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
        catch { return new TextDecoder("windows-1252").decode(buffer); }
    }
    // "1.234,56" · "1,234.56" · "-150,00" · "150,00 D" · "(150,00)" · "R$ 3.650,00"
    function lerValor(txt) {
        let s = String(txt || "").trim();
        if (!s) return null;
        let neg = /^-|-$|\(.*\)|\s[dD]$/.test(s);
        s = s.replace(/[^\d.,]/g, "");
        if (!s) return null;
        const v = s.lastIndexOf(","), p = s.lastIndexOf(".");
        if (v > p) s = s.replace(/\./g, "").replace(",", ".");
        else s = s.replace(/,/g, "");
        const n = Number(s);
        if (!Number.isFinite(n)) return null;
        return neg ? -n : n;
    }
    // "31/10/2026" · "31/10/26" · "2026-10-31" · "20261031"
    function lerData(txt) {
        const s = String(txt || "").trim();
        let m = s.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
        if (m) return `${m[1]}-${m[2]}-${m[3]}`;
        m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
        if (m) { const a = m[3].length === 2 ? "20" + m[3] : m[3]; return `${a}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
        return null;
    }
    function lerOfx(texto) {
        const conta = (texto.match(/<ACCTID>([^<\r\n]+)/i) || [])[1] || "";
        const blocos = texto.split(/<STMTTRN>/i).slice(1);
        const campo = (b, t) => { const m = b.match(new RegExp(`<${t}>([^<\\r\\n]*)`, "i")); return m ? m[1].trim() : ""; };
        const vistos = new Map();
        return blocos.map(b => {
            const data = lerData(campo(b, "DTPOSTED"));
            const valor = lerValor(campo(b, "TRNAMT").replace(/^\+/, ""));
            const descricao = [ campo(b, "NAME"), campo(b, "MEMO") ].filter(Boolean).join(" · ") || campo(b, "TRNTYPE");
            const fitid = campo(b, "FITID");
            let chave;
            if (fitid) chave = `ofx:${conta.trim()}:${fitid}`;
            else { const base = `ofx:${data}|${valor}|${normal(descricao).slice(0, 80)}`; const n = (vistos.get(base) || 0) + 1; vistos.set(base, n); chave = `${base}|#${n}`; }
            return { chave, data, valor, descricao, documento: campo(b, "CHECKNUM") || campo(b, "REFNUM") };
        }).filter(l => l.data && l.valor != null);
    }
    function lerCsv(texto) {
        const linhas = texto.split(/\r?\n/).filter(l => l.trim());
        const sep = [ ";", "\t", "," ].map(s => [ s, (linhas.slice(0, 10).join("\n").match(new RegExp(s === "\t" ? "\t" : "\\" + s, "g")) || []).length ])
            .sort((a, b) => b[1] - a[1])[0][0];
        const partir = l => { const out = []; let cur = "", q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === sep && !q) { out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out.map(c => c.trim()); };
        let ini = -1, col = null;
        for (let i = 0; i < Math.min(linhas.length, 20); i++) {
            const cab = partir(linhas[i]).map(normal);
            const iData = cab.findIndex(c => /^data|dt\.? ?lanc|date/.test(c));
            const iCred = cab.findIndex(c => /credito|entrada/.test(c) && !/debito/.test(c));
            const iDeb = cab.findIndex(c => /debito|saida/.test(c) && !/credito/.test(c));
            const iValor = cab.findIndex(c => /^valor|quantia|montante|amount/.test(c));
            const iDesc = cab.findIndex(c => /descri|historico|lancamento|memo|detalhe|identifica/.test(c));
            if (iData >= 0 && (iValor >= 0 || iCred >= 0)) { ini = i; col = { iData, iValor, iCred, iDeb, iDesc }; break; }
        }
        if (ini < 0) {   // sem cabeçalho: 1ª coluna com data, última coluna com número, maior texto = histórico
            col = { iData: 0, iValor: -2, iCred: -1, iDeb: -1, iDesc: -2 };
            ini = -1;
        }
        const vistos = new Map();
        const out = [];
        for (const l of linhas.slice(ini + 1)) {
            const c = partir(l);
            const data = lerData(c[col.iData]);
            if (!data) continue;
            let valor = null;
            if (col.iValor === -2) { for (let k = c.length - 1; k > 0; k--) { const v = lerValor(c[k]); if (v != null && /\d/.test(c[k])) { valor = v; break; } } }
            else if (col.iValor >= 0 && c[col.iValor]) valor = lerValor(c[col.iValor]);
            else if (col.iCred >= 0 && lerValor(c[col.iCred])) valor = Math.abs(lerValor(c[col.iCred]));
            else if (col.iDeb >= 0 && lerValor(c[col.iDeb])) valor = -Math.abs(lerValor(c[col.iDeb]));
            if (valor == null) continue;
            const descricao = col.iDesc >= 0 ? c[col.iDesc] : (col.iDesc === -2 ? c.slice(1).filter(x => !/^[-\d.,R$\s()]+$/.test(x)).sort((a, b) => b.length - a.length)[0] || "" : "");
            const base = `csv:${data}|${valor.toFixed(2)}|${normal(descricao).replace(/\s+/g, " ").slice(0, 80)}`;
            const n = (vistos.get(base) || 0) + 1; vistos.set(base, n);
            out.push({ chave: `${base}|#${n}`, data, valor: r2(valor), descricao });
        }
        return out;
    }
    function lerExtrato(nome, texto) {
        return /<OFX>|<STMTTRN>|OFXHEADER/i.test(texto) || /\.(ofx|qfx)$/i.test(nome) ? lerOfx(texto) : lerCsv(texto);
    }

    // ------------------------------------------------------------------ casamento crédito × cobrança (puro)
    const PALAVRAS_VAZIAS = new Set([ "de", "da", "do", "das", "dos", "e", "ltda", "me", "sa", "eireli", "epp" ]);
    function esperado(b, ct, dataPg) {
        const dias = Math.max(diasEntre(b.vencimento, dataPg), 0);
        const m = dias > 0 ? r2(b.valor_aluguel * (ct.multa_atraso_pct || 0) / 100) : 0;
        const j = dias > 0 ? r2(b.valor_aluguel * (ct.juros_mes_pct || 0) / 100 * dias / 30) : 0;
        const base = Number(b.valor_total);
        return { base, multa: m, juros: j, total: r2(base + m + j), dias };
    }
    function pontuar(t, b) {
        const ct = b._contrato || {};
        const desc = " " + normal(t.descricao).replace(/[^a-z0-9]+/g, " ") + " ";
        const txid = b.id.replace(/-/g, "").slice(0, 10);
        const temTxid = desc.replace(/\s/g, "").includes(txid);
        const diff = diasEntre(b.vencimento, t.data);
        if (!temTxid && (diff < -40 || diff > 120)) return null;
        const e = esperado(b, ct, t.data);
        let valor = null;
        if (Math.abs(t.valor - e.total) <= 0.05) valor = e.dias > 0 ? "com_encargos" : "exato";
        else if (Math.abs(t.valor - e.base) <= 0.05) valor = e.dias > 0 ? "sem_encargos" : "exato";
        else if (Math.abs(t.valor - e.total) <= 1.0) valor = "aproximado";
        if (!valor && !temTxid) return null;
        const nomes = normal(b._inquilino || "").split(/[^a-z0-9]+/).filter(p => p.length >= 3 && !PALAVRAS_VAZIAS.has(p));
        const acertos = nomes.filter(p => desc.includes(" " + p + " ")).length;
        const nome = nomes.length > 0 && (acertos >= 2 || (acertos >= 1 && nomes.length === 1) || (acertos >= 1 && desc.includes(" " + nomes[nomes.length - 1] + " ")));
        const score = (temTxid ? 100 : 0) + ({ exato: 50, com_encargos: 50, sem_encargos: 40, aproximado: 25 }[valor] || 0)
            + (nome ? 35 : 0) + (Math.abs(diff) <= 5 ? 10 : Math.abs(diff) <= 15 ? 5 : 0);
        return { cobranca: b, score, valor, nome, txid: temTxid, diff, esperado: e };
    }
    // devolve um item por crédito: { t, opcoes:[...pontuadas], escolha, auto, situacao }
    function casar(lancamentos, cobrancas, usados) {
        const creditos = lancamentos.filter(l => l.valor > 0);
        const itens = creditos.map(t => ({ t, opcoes: [], escolha: null, auto: false,
            situacao: usados.has(t.chave) ? "usado" : "sem" }));
        const pares = [];
        itens.forEach((it, i) => {
            if (it.situacao === "usado") return;
            cobrancas.forEach(b => { const p = pontuar(it.t, b); if (p) { it.opcoes.push(p); pares.push([ i, p ]); } });
            it.opcoes.sort((a, b) => b.score - a.score);
        });
        // cada cobrança vai para o crédito com mais pontos; empates de valor sem nome/código ficam para a pessoa escolher
        pares.sort((a, b) => b[1].score - a[1].score);
        const tomadas = new Set();
        for (const [ i, p ] of pares) {
            const it = itens[i];
            if (it.escolha || tomadas.has(p.cobranca.id)) continue;
            const mesmoValor = it.opcoes.filter(o => o.valor && o.valor !== "aproximado" && !tomadas.has(o.cobranca.id));
            const forte = p.txid || (p.valor && p.valor !== "aproximado" && p.nome)
                || (p.valor && p.valor !== "aproximado" && mesmoValor.length === 1 && Math.abs(p.diff) <= 15);
            if (!forte) continue;
            it.escolha = p; it.auto = true; it.situacao = "encontrada";
            tomadas.add(p.cobranca.id);
        }
        itens.forEach(it => { if (!it.escolha && it.situacao !== "usado" && it.opcoes.length) it.situacao = "escolher"; });
        return { itens, debitos: lancamentos.filter(l => l.valor <= 0).length, tomadas };
    }

    // ------------------------------------------------------------------ tela
    function iniciar(contexto) {
        ctx = contexto;
        if (!ligado) { montar(); ligado = true; }
        arquivo = null; analise = null; historico = [];
        return Promise.resolve();
    }
    function sair() { arquivo = null; analise = null; historico = []; }
    const temAba = a => a === "extrato" && pode();
    function renderAba(a) {
        const ligada = temAba(a);
        $("finConciliacao").hidden = !ligada;
        const barra = document.querySelector("#page-financeiro > .fin-toolbar");
        if (barra && ligada) barra.hidden = true;
        if (ligada) { desenhar(); carregarHistorico(); }
    }

    function montar() {
        const box = $("finConciliacao");
        box.innerHTML = `<section class="panel conc-topo">
            <span class="eyebrow">BAIXA PELO EXTRATO</span>
            <h2>Extrato do banco</h2>
            <p>No internet banking da imobiliária, baixe o extrato da conta em <b>OFX</b> (às vezes chamado "Money" ou "Quicken") ou em <b>CSV/planilha</b>
              e escolha o arquivo aqui. O sistema encontra cada aluguel pago e você só confere e confirma.</p>
            <div class="conc-acoes">
              <label class="primary-button conc-escolher">📂 Escolher extrato<input id="concArquivo" type="file" accept=".ofx,.qfx,.csv,.txt,text/csv" hidden /></label>
              <span class="muted-text">O arquivo é lido só neste aparelho. Nada é baixado sem você confirmar, e a mesma linha do extrato nunca dá baixa duas vezes.</span>
            </div>
          </section>
          <div id="concResultado"></div>
          <section class="panel conc-hist"><h3>Linhas do extrato já usadas</h3><div id="concHistorico"><p class="muted-text">Carregando…</p></div></section>`;
        $("concArquivo").addEventListener("change", async ev => {
            const f = ev.target.files[0];
            ev.target.value = "";
            if (!f) return;
            if (f.size > 5 * 1024 * 1024) { ctx.toast("Arquivo maior que 5 MB: baixe um período menor do extrato."); return; }
            try {
                const lanc = lerExtrato(f.name, decodificar(await f.arrayBuffer()));
                if (!lanc.length) { ctx.toast("Não encontrei lançamentos neste arquivo. Use o extrato em OFX ou CSV do banco."); return; }
                arquivo = { nome: f.name, lancamentos: lanc };
                await analisar();
            } catch (e) { ctx.toast("Não foi possível ler o arquivo: " + (e.message || e)); }
        });
    }

    async function analisar() {
        if (!arquivo) return;
        $("concResultado").innerHTML = `<p class="muted-text">Procurando os aluguéis pagos…</p>`;
        const cart = ctx.carteiraId();
        const [ rc, rk, rcl, ru ] = await Promise.all([
            ctx.sb.from("aluguel_cobrancas").select("*").eq("carteira_id", cart).eq("status", "aberta").order("vencimento"),
            ctx.sb.from("aluguel_contratos").select("id, numero, construcao_id, imovel_avulso, inquilino_id, inquilino_nome, multa_atraso_pct, juros_mes_pct").eq("carteira_id", cart),
            ctx.sb.from("crm_clientes").select("id, nome").eq("carteira_id", cart),
            ctx.sb.from("fin_extrato_lancamentos").select("chave").eq("carteira_id", cart).in("chave", arquivo.lancamentos.map(l => l.chave).slice(0, 500))
        ]);
        const falha = [ rc, rk, rcl ].find(r => r.error);
        if (falha) { $("concResultado").innerHTML = `<p class="muted-text">${h(erro(falha.error))}</p>`; return; }
        const contratos = new Map((rk.data || []).map(c => [ c.id, c ]));
        const clientes = new Map((rcl.data || []).map(c => [ c.id, c.nome ]));
        const imoveis = new Map(ctx.imoveis().map(i => [ i.id, i ]));
        const cobrancas = (rc.data || []).map(b => {
            const ct = contratos.get(b.contrato_id) || {};
            const im = imoveis.get(ct.construcao_id);
            return { ...b, _contrato: ct, _inquilino: clientes.get(ct.inquilino_id) || ct.inquilino_nome || "",
                _imovel: im ? (im.codigo ? im.codigo + " · " : "") + im.nome : ((ct.imovel_avulso || {}).descricao || "") };
        });
        analise = casar(arquivo.lancamentos, cobrancas, new Set((ru.data || []).map(r => r.chave)));
        analise.cobrancas = cobrancas;
        desenhar();
    }

    function rotuloCobranca(b) {
        return `${b._inquilino || "Inquilino"} · ${mesAno(b.competencia)} · venc. ${dataBr(b.vencimento)} · ${dinheiro(b.valor_total)}`;
    }
    function motivo(p) {
        if (!p) return "";
        const partes = [];
        if (p.txid) partes.push("código do PIX do portal");
        if (p.nome) partes.push("nome do inquilino no extrato");
        if (p.valor === "exato") partes.push("valor igual");
        if (p.valor === "com_encargos") partes.push(`valor com multa e juros de ${p.esperado.dias} dias`);
        if (p.valor === "sem_encargos") partes.push("valor sem multa e juros (pagou atrasado)");
        if (p.valor === "aproximado") partes.push("valor parecido");
        return partes.join(" · ");
    }

    function desenhar() {
        const box = $("concResultado");
        if (!box) return;
        if (!analise) { box.innerHTML = ""; return; }
        const it = analise.itens;
        const n = s => it.filter(x => x.situacao === s).length;
        box.innerHTML = `<section class="panel conc-res">
            <div class="conc-resumo">
              <span><b>${it.length}</b> créditos em <i>${h(arquivo.nome)}</i></span>
              <span class="conc-chip ok">✔ ${n("encontrada")} encontrados</span>
              <span class="conc-chip esc">? ${n("escolher")} para escolher</span>
              <span class="conc-chip sem">${n("sem")} sem cobrança</span>
              ${n("usado") ? `<span class="conc-chip usado">${n("usado")} já usados antes</span>` : ""}
              ${analise.debitos ? `<span class="muted-text">${analise.debitos} saídas ignoradas</span>` : ""}
            </div>
            <div class="conc-lista">${it.map((x, i) => itemHtml(x, i)).join("")}</div>
            <div class="conc-rodape">
              <span id="concContagem" class="muted-text"></span>
              <button id="concConfirmar" type="button" class="primary-button">Confirmar baixas</button>
            </div>
          </section>`;
        box.querySelectorAll("[data-conc-sel]").forEach(s => s.addEventListener("change", () => trocarEscolha(Number(s.dataset.concSel), s.value)));
        box.querySelectorAll("[data-conc-ok]").forEach(c => c.addEventListener("change", contar));
        $("concConfirmar").addEventListener("click", confirmar);
        contar();
    }
    function itemHtml(x, i) {
        const t = x.t, p = x.escolha;
        const selo = { encontrada: `<span class="conc-chip ok">✔ Encontrada</span>`, escolher: `<span class="conc-chip esc">? Escolha a cobrança</span>`,
            sem: `<span class="conc-chip sem">Sem cobrança</span>`, usado: `<span class="conc-chip usado">Já usada antes</span>`, ignorar: `<span class="conc-chip sem">Não é aluguel</span>` }[x.situacao];
        const outras = analise.cobrancas.filter(b => !x.opcoes.some(o => o.cobranca.id === b.id));
        const sel = x.situacao === "usado" ? "" : `<select data-conc-sel="${i}" class="conc-sel">
            <option value="">— Não dar baixa agora —</option>
            ${x.opcoes.length ? `<optgroup label="Mais prováveis">${x.opcoes.map(o => `<option value="${h(o.cobranca.id)}"${p && p.cobranca.id === o.cobranca.id ? " selected" : ""}>${h(rotuloCobranca(o.cobranca))}</option>`).join("")}</optgroup>` : ""}
            ${outras.length ? `<optgroup label="Outras cobranças em aberto">${outras.map(b => `<option value="${h(b.id)}"${p && p.cobranca.id === b.id ? " selected" : ""}>${h(rotuloCobranca(b))}</option>`).join("")}</optgroup>` : ""}
            <option value="${IGNORAR}"${x.situacao === "ignorar" ? " selected" : ""}>Não é aluguel: não mostrar de novo</option>
          </select>`;
        let aviso = "";
        if (p) {
            const e = p.esperado;
            if (p.valor === "sem_encargos") aviso = `Pagou ${e.dias} dia(s) depois do vencimento sem multa e juros: a baixa sai sem encargos.`;
            else if (!p.valor || p.valor === "aproximado") aviso = `Valor diferente do devido na data (${dinheiro(e.total)}). A baixa registra ${dinheiro(t.valor)} como valor pago.`;
            else if (e.dias > 0) aviso = `Inclui multa ${dinheiro(e.multa)} e juros ${dinheiro(e.juros)} (${e.dias} dias de atraso).`;
        }
        return `<div class="conc-item conc-${x.situacao}">
            <div class="conc-linha">
              <div class="conc-banco"><strong>${dinheiro(t.valor)}</strong><small>${dataBr(t.data)}</small></div>
              <div class="conc-desc">${h(t.descricao || "(sem histórico)")}</div>
              ${selo}
            </div>
            ${sel ? `<div class="conc-linha conc-escolha">
              <label class="conc-marcar"><input type="checkbox" data-conc-ok="${i}" ${p && x.situacao !== "ignorar" ? "checked" : ""} ${p ? "" : "disabled"} /> Dar baixa</label>
              ${sel}
            </div>` : ""}
            ${p && motivo(p) ? `<p class="conc-motivo">Por quê: ${h(motivo(p))}</p>` : ""}
            ${aviso ? `<p class="conc-aviso">${h(aviso)}</p>` : ""}
          </div>`;
    }
    function trocarEscolha(i, valor) {
        const x = analise.itens[i];
        if (valor === IGNORAR) { x.escolha = null; x.situacao = "ignorar"; }
        else if (!valor) { x.escolha = null; x.situacao = x.opcoes.length ? "escolher" : "sem"; }
        else {
            const b = analise.cobrancas.find(c => c.id === valor);
            const usadoEm = analise.itens.findIndex((y, k) => k !== i && y.escolha && y.escolha.cobranca.id === valor);
            if (usadoEm >= 0) { analise.itens[usadoEm].escolha = null; analise.itens[usadoEm].situacao = "escolher"; }
            x.escolha = x.opcoes.find(o => o.cobranca.id === valor) || pontuar(x.t, b) || { cobranca: b, score: 0, valor: null, nome: false, txid: false, diff: 0, esperado: esperado(b, b._contrato || {}, x.t.data) };
            x.situacao = "encontrada";
        }
        desenhar();
    }
    function selecionados() {
        return analise.itens.map((x, i) => ({ x, ok: !!document.querySelector(`[data-conc-ok="${i}"]`)?.checked }))
            .filter(({ x, ok }) => (x.escolha && ok) || x.situacao === "ignorar");
    }
    function contar() {
        const s = selecionados();
        const b = s.filter(({ x }) => x.situacao !== "ignorar");
        const total = b.reduce((t, { x }) => t + x.t.valor, 0);
        $("concContagem").textContent = b.length ? `${b.length} baixa(s) · ${dinheiro(total)}` + (s.length > b.length ? ` · ${s.length - b.length} marcada(s) como "não é aluguel"` : "")
            : (s.length ? `${s.length} marcada(s) como "não é aluguel"` : "Nada marcado.");
        $("concConfirmar").disabled = !s.length;
        $("concConfirmar").textContent = b.length ? `Confirmar ${b.length} baixa(s)` : "Confirmar";
    }
    async function confirmar() {
        const s = selecionados();
        if (!s.length) return;
        const itens = s.map(({ x }) => x.situacao === "ignorar"
            ? { chave: x.t.chave, data: x.t.data, valor: x.t.valor, descricao: x.t.descricao, acao: "ignorar" }
            : { chave: x.t.chave, data: x.t.data, valor: x.t.valor, descricao: x.t.descricao, acao: "baixar", cobranca_id: x.escolha.cobranca.id,
                sem_encargos: x.escolha.valor === "sem_encargos" });
        const bt = $("concConfirmar");
        bt.disabled = true; bt.textContent = "Dando baixa…";
        const { data, error } = await ctx.sb.rpc("fin_conciliar_extrato", { p_carteira: ctx.carteiraId(), p_arquivo: arquivo.nome, p_itens: itens });
        if (error) { ctx.toast(erro(error)); bt.disabled = false; contar(); return; }
        const partes = [];
        if (data.baixadas) partes.push(`${data.baixadas} baixa(s) feita(s)`);
        if (data.ignoradas) partes.push(`${data.ignoradas} marcada(s) como "não é aluguel"`);
        if (data.repetidas) partes.push(`${data.repetidas} já tinha(m) sido usada(s)`);
        if ((data.erros || []).length) partes.push(`${data.erros.length} com erro: ${erro({ message: data.erros[0].erro })}`);
        ctx.toast(partes.join(" · ") || "Nada mudou.");
        await analisar();
        carregarHistorico();
    }

    async function carregarHistorico() {
        if (!pode()) return;
        const { data, error } = await ctx.sb.from("fin_extrato_lancamentos").select("*").eq("carteira_id", ctx.carteiraId())
            .order("importado_em", { ascending: false }).limit(40);
        const box = $("concHistorico");
        if (!box) return;
        if (error) { box.innerHTML = `<p class="muted-text">${h(erro(error))}</p>`; return; }
        historico = data || [];
        box.innerHTML = historico.length ? `<div class="conc-lista">${historico.map(l => `<div class="conc-item conc-hist-item">
            <div class="conc-linha">
              <div class="conc-banco"><strong>${dinheiro(l.valor)}</strong><small>${dataBr(l.data)}</small></div>
              <div class="conc-desc">${h(l.descricao || "")}<small>${h(l.arquivo || "")} · ${dataBr(l.importado_em)}</small></div>
              ${l.situacao === "baixado" ? `<span class="conc-chip ok">Baixado</span>` : `<span class="conc-chip sem">Não é aluguel</span>
                <button type="button" class="text-button" data-conc-desfazer="${h(l.id)}">Desfazer</button>`}
            </div></div>`).join("")}</div>
            <p class="muted-text">Para desfazer uma baixa, estorne o pagamento em Cobranças: a linha do extrato volta a poder ser usada.</p>`
            : `<p class="muted-text">Nenhum extrato importado ainda.</p>`;
        box.querySelectorAll("[data-conc-desfazer]").forEach(b => b.addEventListener("click", async () => {
            const { error: e } = await ctx.sb.rpc("fin_extrato_desfazer_ignorado", { p_id: b.dataset.concDesfazer });
            if (e) { ctx.toast(erro(e)); return; }
            ctx.toast("Pronto: a linha volta a aparecer na próxima importação.");
            carregarHistorico();
            if (arquivo) analisar();
        }));
    }

    window.SKLConciliacao = { iniciar, sair, temAba, render: renderAba, _puro: { lerOfx, lerCsv, lerExtrato, lerValor, lerData, casar, pontuar, esperado } };
})();
