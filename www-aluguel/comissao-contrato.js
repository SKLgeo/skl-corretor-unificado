// Contrato de compra e venda → "💰 Comissão": quando a imobiliária recebe a comissão e quando repassa a corretores e parceiros.
// A venda em si é paga pelo comprador à incorporadora/vendedor; aqui só entra a comissão da imobiliária.
// Recebimentos → crm_comissao_recebiveis (o mesmo "A receber" do Financeiro, Painel e Contabilidade).
// Repasses → comissoes_aluguel (aparecem em Comissões e em "Minhas comissões" do corretor).
// Tudo é gravado pela RPC contrato_venda_salvar_comissao depois que o contrato é salvo. O bloco começa fechado quando está vazio.
(function () {
    "use strict";
    const $ = id => document.getElementById(id);
    const h = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const dinheiro = v => v == null || !isFinite(v) ? "—" : "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const dataBr = d => d ? String(d).slice(0, 10).split("-").reverse().join("/") : "—";
    const campo = v => v == null || v === "" ? "" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const hoje = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
    function somarDias(iso, dias) { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + (Number(dias) || 0)); return d.toISOString().slice(0, 10); }
    function somarMeses(iso, meses) {
        const [ a, m, d ] = iso.split("-").map(Number), mes = m - 1 + meses, ano = a + Math.floor(mes / 12), mm = (mes % 12) + 1;
        return `${ano}-${String(mm).padStart(2, "0")}-${String(Math.min(d, new Date(ano, mm, 0).getDate())).padStart(2, "0")}`;
    }
    const STATUS = { pendente: "A pagar", aprovada: "Aprovada", paga: "Paga", cancelada: "Cancelada" };

    let op = null;          // opções vindas do financeiro.js (ctx, contrato, pode, parceiros, participantes, total, dataContrato)
    let rec = [];           // recebimentos: {id?, vencimento, valor, observacao, recebido_em?}
    let regras = [];        // repasses: {tipo, usuario_id, parceiro_id, nome, pct, valor, quando: recebimento|data, dias, vencimento}
    let linhas = [];        // repasses já gravados (comissoes_aluguel)
    let travado = false;    // há repasse aprovado ou pago: as regras não mudam mais por aqui
    let mexeu = false, montado = false;
    const num = v => op && op.ctx.parseValor ? op.ctx.parseValor(String(v == null ? "" : v)) : (Number(String(v).replace(/\./g, "").replace(",", ".")) || null);

    function montar() {
        if (montado) return;
        const pg = document.querySelector("#finContratoForm .fin-pg-bloco");
        if (!pg) return;
        pg.insertAdjacentHTML("beforebegin", `<details id="finComBloco" class="fin-com-bloco" hidden>
          <summary><span>💰 Comissão — recebimento e repasses</span><small id="finComResumo"></small></summary>
          <p class="muted-text fin-com-intro">Aqui fica só a comissão da imobiliária: quando ela recebe e quando paga corretores e parceiros. A venda em si é paga pelo comprador à incorporadora ou ao vendedor.</p>
          <p class="fin-com-total">Comissão total: <b id="finComTotal">—</b> <small>(campo "Comissão" acima)</small></p>
          <h4 class="fin-com-h">1 · Quando a imobiliária recebe</h4>
          <div class="fin-com-modo" role="group" aria-label="Como a comissão é recebida">
            <label class="check-inline"><input type="radio" name="finComModo" value="unica" checked /> Uma vez só</label>
            <label class="check-inline"><input type="radio" name="finComModo" value="parcelada" /> Parcelada</label>
          </div>
          <div class="fin-grade fin-com-gerar">
            <label data-com-unica><span>Dias depois da assinatura (0 = na assinatura)</span><input id="finComDias" type="number" min="0" max="3650" value="0" /></label>
            <label data-com-parc hidden><span>Quantas parcelas</span><input id="finComQtd" type="number" min="2" max="120" value="3" /></label>
            <label data-com-parc hidden><span>1ª parcela: dias depois da assinatura</span><input id="finComPrimeira" type="number" min="0" max="3650" value="30" /></label>
            <label data-com-parc hidden><span>Intervalo entre as parcelas</span><select id="finComIntervalo"><option value="m1">Todo mês (mesmo dia)</option><option value="30">A cada 30 dias</option><option value="60">A cada 60 dias</option><option value="90">A cada 90 dias</option></select></label>
          </div>
          <button id="finComMontar" type="button" class="secondary-button fin-mini">Montar as datas do recebimento</button>
          <div id="finComRec" class="fin-com-lista"></div>
          <button id="finComAddRec" type="button" class="text-button">+ Recebimento</button>
          <p id="finComRecNota" class="muted-text fin-pg-nota"></p>
          <h4 class="fin-com-h">2 · Repasse para corretores e parceiros</h4>
          <div id="finComRegras" class="fin-com-lista"></div>
          <div class="fin-com-botoes">
            <button id="finComAddPessoa" type="button" class="text-button">+ Pessoa</button>
            <button id="finComTrazer" type="button" class="text-button">Trazer quem trabalhou neste contrato</button>
          </div>
          <div id="finComPrevia" class="fin-com-previa"></div>
          <button id="finComSalvar" type="button" class="primary-button fin-mini" hidden>Salvar comissão</button>
        </details>`);
        document.querySelectorAll("input[name=finComModo]").forEach(r => r.addEventListener("change", mostrarModo));
        $("finComMontar").addEventListener("click", montarDatas);
        $("finComAddRec").addEventListener("click", () => { rec.push({ vencimento: dataBase(), valor: "", observacao: "" }); mexeu = true; desenhar(); });
        $("finComAddPessoa").addEventListener("click", () => { regras.push({ tipo: "corretor", usuario_id: "", pct: "", valor: "", quando: "recebimento", dias: 0 }); mexeu = true; desenhar(); });
        $("finComTrazer").addEventListener("click", trazerEquipe);
        $("finComSalvar").addEventListener("click", async () => {
            if (!op || !op.contrato) return;
            $("finComSalvar").disabled = true;
            const ok = await salvar(op.contrato.id);
            $("finComSalvar").disabled = false;
            if (ok) { op.ctx.toast("Comissão salva."); if (op.aoSalvar) await op.aoSalvar(); await abrir(op); }
        });
        montado = true;
    }
    const modo = () => (document.querySelector("input[name=finComModo]:checked") || {}).value || "unica";
    function mostrarModo() {
        const p = modo() === "parcelada";
        document.querySelectorAll("[data-com-unica]").forEach(el => { el.hidden = p; });
        document.querySelectorAll("[data-com-parc]").forEach(el => { el.hidden = !p; });
    }
    const total = () => (op && op.total ? op.total() : null) || 0;
    const dataBase = () => (op && op.dataContrato && op.dataContrato()) || hoje();

    // ------------------------------------------------------------------ abrir
    async function abrir(opcoes) {
        op = opcoes;
        montar();
        const bloco = $("finComBloco");
        if (!bloco) return;
        const c = op.contrato;
        rec = []; regras = []; linhas = []; travado = false; mexeu = false;
        bloco.hidden = op.tipo !== "venda";
        if (op.tipo !== "venda") return;
        const cfg = (c && c.comissao_config) || {};
        document.querySelectorAll("input[name=finComModo]").forEach(r => { r.checked = r.value === (cfg.modo || "unica"); });
        $("finComDias").value = cfg.dias ?? 0; $("finComQtd").value = cfg.qtd ?? 3; $("finComPrimeira").value = cfg.primeira ?? 30; $("finComIntervalo").value = cfg.intervalo || "m1";
        mostrarModo();
        // contrato novo criado a partir de um negócio: já mostra as parcelas a receber que o negócio tiver (são as mesmas)
        const negId = (c && c.negociacao_id) || op.negociacaoId || null;
        if ((c && c.id) || negId) {
            const sb = op.ctx.sb;
            const filtro = [ c && c.id ? `contrato_venda_id.eq.${c.id}` : "", negId ? `negociacao_id.eq.${negId}` : "" ].filter(Boolean).join(",");
            const [ a, b ] = await Promise.all([
                sb.from("crm_comissao_recebiveis").select("id, vencimento, valor, observacao, recebido_em, recebido_sem_data, parcela").or(filtro).order("vencimento"),
                c && c.id ? sb.from("comissoes_aluguel").select("id, corretor_id, corretor_nome, beneficiario_nome, valor_comissao, competencia, status, parcela, parcelas, tipo").eq("contrato_venda_id", c.id).order("competencia")
                    : Promise.resolve({ data: [] })
            ]);
            rec = (a.data || []).map(r => ({ id: r.id, vencimento: r.vencimento, valor: campo(r.valor), observacao: r.observacao || "", recebido_em: r.recebido_em, recebido_sem_data: r.recebido_sem_data }));
            linhas = b.data || [];
            travado = linhas.some(l => l.status !== "pendente" && l.status !== "cancelada");
            regras = (cfg.repasses || []).map(x => ({ ...x }));
        }
        bloco.open = rec.length > 0 || linhas.length > 0 || regras.length > 0;
        desenhar();
    }

    // ------------------------------------------------------------------ recebimentos
    function montarDatas() {
        const t = total();
        if (!t) { op.ctx.toast("Preencha a comissão (% ou R$) do contrato antes de montar as datas."); return; }
        const recebidos = rec.filter(r => r.recebido_em || r.recebido_sem_data);
        const jaRecebido = recebidos.reduce((s, r) => s + (num(r.valor) || 0), 0);
        const falta = Math.round((t - jaRecebido) * 100) / 100;
        if (falta <= 0) { op.ctx.toast("A comissão já foi toda recebida."); return; }
        const base = dataBase(), novos = [];
        if (modo() === "unica") novos.push({ vencimento: somarDias(base, $("finComDias").value), valor: campo(falta), observacao: Number($("finComDias").value) ? `${$("finComDias").value} dias após a assinatura` : "Na assinatura" });
        else {
            const qtd = Math.min(120, Math.max(2, parseInt($("finComQtd").value, 10) || 2));
            const primeira = somarDias(base, $("finComPrimeira").value), iv = $("finComIntervalo").value;
            const cada = Math.floor(falta / qtd * 100) / 100;
            for (let k = 0; k < qtd; k++) {
                const venc = iv === "m1" ? somarMeses(primeira, k) : somarDias(primeira, k * Number(iv));
                const valor = k === qtd - 1 ? Math.round((falta - cada * (qtd - 1)) * 100) / 100 : cada;
                novos.push({ vencimento: venc, valor: campo(valor), observacao: `Parcela ${k + 1} de ${qtd}` });
            }
        }
        rec = [ ...recebidos, ...novos ];
        mexeu = true;
        desenhar();
    }
    async function marcarRecebido(i) {
        const r = rec[i];
        if (!r || !r.id) return;
        const { error } = await op.ctx.sb.rpc("crm_baixar_recebivel", { p_id: r.id, p_recebido_em: hoje(), p_conta: null });
        if (error) { op.ctx.toast(op.ctx.traduzErro(error.message || String(error))); return; }
        r.recebido_em = hoje();
        op.ctx.toast("Recebimento marcado como recebido hoje. A conta e a data podem ser ajustadas em Despesas e receitas → A receber.");
        desenhar();
    }

    // ------------------------------------------------------------------ repasses
    function trazerEquipe() {
        const ps = op.participantes ? op.participantes() : [];
        const ja = new Set(regras.map(r => r.usuario_id || r.parceiro_id || r.nome));
        ps.forEach(p => {
            const chave = p.usuario_id || p.parceiro_id || p.nome;
            if (!chave || ja.has(chave)) return;
            regras.push({ tipo: p.tipo, usuario_id: p.usuario_id || "", parceiro_id: p.parceiro_id || "", nome: p.nome || "", pct: "", valor: "", quando: "recebimento", dias: 0 });
            ja.add(chave);
        });
        if (!ps.length) op.ctx.toast("O contrato ainda não tem corretor nem parceiros. Use \"+ Pessoa\".");
        mexeu = true;
        desenhar();
    }
    const nomePessoa = r => {
        if (r.tipo === "corretor") { const u = (op.ctx.equipe() || []).find(x => x.id === r.usuario_id); return u ? u.display_name : "Corretor"; }
        if (r.parceiro_id) { const p = (op.parceiros || []).find(x => x.id === r.parceiro_id); return p ? p.nome : "Parceiro"; }
        return (r.nome || "").trim() || "Parceiro";
    };
    // transforma as regras em repasses com data e valor (é isto que vai para o banco)
    function expandir() {
        const t = total(), saida = [];
        const recs = rec.filter(r => r.vencimento && num(r.valor) > 0).sort((a, b) => a.vencimento.localeCompare(b.vencimento));
        const somaRec = recs.reduce((s, r) => s + num(r.valor), 0);
        regras.forEach(r => {
            const base = num(r.valor) || (num(r.pct) ? t * num(r.pct) / 100 : 0);
            if (!base || (r.tipo === "corretor" && !r.usuario_id) || (r.tipo !== "corretor" && !nomePessoa(r))) return;
            const quem = r.tipo === "corretor" ? { tipo: "corretor", usuario_id: r.usuario_id } : { tipo: "parceiro", nome: nomePessoa(r) };
            const pct = num(r.pct) || null;
            if (r.quando === "data" || !recs.length || !somaRec) {
                saida.push({ ...quem, valor: Math.round(base * 100) / 100, percentual: pct, competencia: r.vencimento || (recs[0] && recs[0].vencimento) || dataBase() });
            } else {
                let usado = 0;
                recs.forEach((p, k) => {
                    const v = k === recs.length - 1 ? Math.round((base - usado) * 100) / 100 : Math.round(base * num(p.valor) / somaRec * 100) / 100;
                    usado += v;
                    saida.push({ ...quem, valor: v, percentual: pct, competencia: somarDias(p.vencimento, r.dias), parcela: k + 1, parcelas: recs.length });
                });
            }
        });
        return saida;
    }

    // ------------------------------------------------------------------ desenho
    function desenhar() {
        if (!op || op.tipo !== "venda") return;
        const pode = !!op.pode;
        $("finComTotal").textContent = total() ? dinheiro(total()) : "não informada";
        $("finComRec").innerHTML = rec.map((r, i) => {
            const ok = !!(r.recebido_em || r.recebido_sem_data);
            return `<div class="fin-com-linha${ok ? " ok" : ""}" data-rec="${i}">
              <span class="fin-pg-n">${i + 1}ª</span>
              <label><span>Data</span><input type="date" data-k="vencimento" value="${h(r.vencimento)}"${ok || !pode ? " disabled" : ""} /></label>
              <label><span>Valor (R$)</span><input inputmode="decimal" autocomplete="off" data-k="valor" value="${h(r.valor)}"${ok || !pode ? " disabled" : ""} /></label>
              <label class="fin-com-obs"><span>Observação</span><input data-k="observacao" value="${h(r.observacao)}" autocomplete="off"${ok || !pode ? " disabled" : ""} /></label>
              <span class="fin-com-sit">${ok ? `✓ Recebida${r.recebido_em ? " em " + h(dataBr(r.recebido_em)) : ""}`
                : pode && r.id ? `<button type="button" class="secondary-button fin-mini" data-recebi="${i}">✓ Recebi</button>` : `<em>${r.id ? "A receber" : "Nova"}</em>`}</span>
              ${!ok && pode ? `<button type="button" class="text-button fin-pg-del" data-tirar-rec="${i}" title="Tirar">✕</button>` : ""}
            </div>`;
        }).join("") || `<p class="muted-text">Nenhuma data ainda. Escolha "Uma vez só" ou "Parcelada" e toque em "Montar as datas", ou inclua uma por uma.</p>`;
        $("finComRec").querySelectorAll("[data-rec]").forEach(linha => {
            const i = Number(linha.dataset.rec);
            linha.querySelectorAll("[data-k]").forEach(inp => inp.addEventListener("input", () => { rec[i][inp.dataset.k] = inp.value; mexeu = true; notaRec(); previa(); }));
        });
        $("finComRec").querySelectorAll("[data-tirar-rec]").forEach(b => b.addEventListener("click", () => { rec.splice(+b.dataset.tirarRec, 1); mexeu = true; desenhar(); }));
        $("finComRec").querySelectorAll("[data-recebi]").forEach(b => b.addEventListener("click", () => marcarRecebido(+b.dataset.recebi)));
        notaRec();
        // regras de repasse
        const equipe = (op.ctx.equipe() || []).filter(u => u.active !== false && u.papel !== "financeiro");
        const optsPessoa = r => `<optgroup label="Equipe">${equipe.map(u => `<option value="c:${h(u.id)}"${r.tipo === "corretor" && r.usuario_id === u.id ? " selected" : ""}>${h(u.display_name)}</option>`).join("")}</optgroup>
            <optgroup label="Parceiros de fora">${(op.parceiros || []).map(p => `<option value="p:${h(p.id)}"${r.tipo !== "corretor" && r.parceiro_id === p.id ? " selected" : ""}>${h(p.nome)}</option>`).join("")}
            <option value="n:"${r.tipo !== "corretor" && !r.parceiro_id ? " selected" : ""}>Outro (escrever o nome)</option></optgroup>`;
        const editar = pode && !travado;
        $("finComRegras").innerHTML = (travado ? `<p class="fin-com-aviso">Já há repasse aprovado ou pago neste contrato. Para mudar os outros, use a tela Comissões.</p>` : "")
            + (travado ? "" : regras.map((r, i) => `<div class="fin-com-regra" data-regra="${i}">
              <label class="fin-com-pessoa"><span>Quem recebe</span><select data-k="pessoa"${editar ? "" : " disabled"}><option value="">Escolha…</option>${optsPessoa(r)}</select>
                <input data-k="nome" placeholder="Nome do parceiro" autocomplete="off" value="${h(r.nome || "")}"${r.tipo !== "corretor" && !r.parceiro_id ? "" : " hidden"}${editar ? "" : " disabled"} /></label>
              <label><span>% da comissão</span><input data-k="pct" inputmode="decimal" autocomplete="off" value="${h(r.pct || "")}"${editar ? "" : " disabled"} /></label>
              <label><span>ou valor (R$)</span><input data-k="valor" inputmode="decimal" autocomplete="off" value="${h(r.valor || "")}"${editar ? "" : " disabled"} /></label>
              <label><span>Quando paga</span><select data-k="quando"${editar ? "" : " disabled"}><option value="recebimento"${r.quando !== "data" ? " selected" : ""}>Junto com cada recebimento</option><option value="data"${r.quando === "data" ? " selected" : ""}>Numa data</option></select></label>
              <label${r.quando === "data" ? " hidden" : ""}><span>Dias depois de receber</span><input data-k="dias" type="number" min="0" max="365" value="${h(r.dias || 0)}"${editar ? "" : " disabled"} /></label>
              <label${r.quando === "data" ? "" : " hidden"}><span>Data do pagamento</span><input data-k="vencimento" type="date" value="${h(r.vencimento || "")}"${editar ? "" : " disabled"} /></label>
              ${editar ? `<button type="button" class="text-button fin-pg-del" data-tirar-regra="${i}" title="Tirar">✕</button>` : ""}
            </div>`).join(""))
            + (!travado && !regras.length ? `<p class="muted-text">Ninguém ainda. Toque em "Trazer quem trabalhou neste contrato" ou "+ Pessoa" e informe o % ou o valor de cada um.</p>` : "");
        $("finComRegras").querySelectorAll("[data-regra]").forEach(linha => {
            const i = Number(linha.dataset.regra), r = regras[i];
            linha.querySelectorAll("[data-k]").forEach(inp => inp.addEventListener(inp.tagName === "SELECT" ? "change" : "input", () => {
                const k = inp.dataset.k;
                if (k === "pessoa") {
                    const [ t, id ] = inp.value.split(":");
                    r.tipo = t === "c" ? "corretor" : "parceiro"; r.usuario_id = t === "c" ? id : ""; r.parceiro_id = t === "p" ? id : "";
                    if (t !== "n") r.nome = "";
                    mexeu = true; desenhar(); return;
                }
                r[k] = inp.value;
                if (k === "pct" && inp.value) { r.valor = ""; const v = linha.querySelector("[data-k=valor]"); if (v) v.value = ""; }
                if (k === "valor" && inp.value) { r.pct = ""; const v = linha.querySelector("[data-k=pct]"); if (v) v.value = ""; }
                mexeu = true;
                if (k === "quando") { desenhar(); return; }
                previa();
            }));
        });
        $("finComRegras").querySelectorAll("[data-tirar-regra]").forEach(b => b.addEventListener("click", () => { regras.splice(+b.dataset.tirarRegra, 1); mexeu = true; desenhar(); }));
        [ "finComMontar", "finComAddRec" ].forEach(id => { $(id).hidden = !pode; });
        $("finComSalvar").hidden = !(pode && op.soComissao);
        [ "finComAddPessoa", "finComTrazer" ].forEach(id => { $(id).hidden = !editar; });
        document.querySelectorAll("input[name=finComModo], #finComDias, #finComQtd, #finComPrimeira, #finComIntervalo").forEach(el => { el.disabled = !pode; });
        previa();
    }
    function notaRec() {
        const t = total(), soma = rec.reduce((s, r) => s + (num(r.valor) || 0), 0);
        const recebido = rec.filter(r => r.recebido_em || r.recebido_sem_data).reduce((s, r) => s + (num(r.valor) || 0), 0);
        const partes = [];
        if (rec.length) partes.push(`${rec.length} recebimento(s) · ${dinheiro(soma)} · recebido ${dinheiro(recebido)}`);
        if (t && rec.length && Math.abs(t - soma) >= 0.01) partes.push(`a comissão do contrato é ${dinheiro(t)} (diferença de ${dinheiro(t - soma)})`);
        $("finComRecNota").textContent = partes.join(" · ");
        resumo();
    }
    function previa() {
        const box = $("finComPrevia");
        const futuros = travado ? [] : expandir();
        const pagos = linhas.filter(l => l.status !== "pendente");
        const lista = travado ? linhas.map(l => ({ nome: l.corretor_nome || l.beneficiario_nome, valor: l.valor_comissao, competencia: l.competencia, status: l.status, parcela: l.parcela, parcelas: l.parcelas }))
            : [ ...pagos.map(l => ({ nome: l.corretor_nome || l.beneficiario_nome, valor: l.valor_comissao, competencia: l.competencia, status: l.status, parcela: l.parcela, parcelas: l.parcelas })),
                ...futuros.map(x => ({ nome: x.tipo === "corretor" ? nomePessoa({ tipo: "corretor", usuario_id: x.usuario_id }) : x.nome, valor: x.valor, competencia: x.competencia, status: "pendente", parcela: x.parcela, parcelas: x.parcelas })) ];
        const somaRep = lista.filter(x => x.status !== "cancelada").reduce((s, x) => s + Number(x.valor || 0), 0);
        box.innerHTML = lista.length ? `<span class="crm-rotulo">Repasses ${travado ? "lançados" : "que vão para Comissões"}</span>
            <table class="fin-com-tabela"><thead><tr><th>Quem</th><th>Valor</th><th>Paga em</th><th>Situação</th></tr></thead><tbody>
            ${lista.sort((a, b) => String(a.competencia).localeCompare(String(b.competencia))).map(x => `<tr><td>${h(x.nome)}${x.parcelas ? ` <small>${x.parcela}/${x.parcelas}</small>` : ""}</td>
              <td>${h(dinheiro(Number(x.valor)))}</td><td>${h(dataBr(x.competencia))}</td><td>${h(STATUS[x.status] || x.status)}</td></tr>`).join("")}</tbody></table>
            <p class="muted-text fin-pg-nota">Total repassado: ${h(dinheiro(somaRep))}${total() ? ` · fica com a imobiliária: ${h(dinheiro(total() - somaRep))}` : ""}</p>` : "";
        resumo();
    }
    function resumo() {
        const el = $("finComResumo");
        if (!el) return;
        const recebidos = rec.filter(r => r.recebido_em || r.recebido_sem_data).length;
        const prox = rec.filter(r => !(r.recebido_em || r.recebido_sem_data) && r.vencimento).sort((a, b) => a.vencimento.localeCompare(b.vencimento))[0];
        const nRep = travado ? linhas.length : expandir().length + linhas.filter(l => l.status !== "pendente").length;
        el.textContent = !rec.length && !nRep ? "não preenchida" : [ rec.length ? `${recebidos}/${rec.length} recebido(s)` : "", prox ? `próximo ${dataBr(prox.vencimento)}` : "", nRep ? `${nRep} repasse(s)` : "" ].filter(Boolean).join(" · ");
    }

    // ------------------------------------------------------------------ salvar (chamado depois de salvar o contrato)
    async function salvar(contratoId) {
        if (!op || op.tipo !== "venda" || !op.pode || !mexeu) return true;
        const abertos = rec.filter(r => !(r.recebido_em || r.recebido_sem_data));
        if (abertos.some(r => !r.vencimento || !(num(r.valor) > 0))) { op.ctx.toast("O contrato foi salvo, mas a comissão não: cada recebimento precisa de data e valor."); return false; }
        const dados = {
            recebimentos: abertos.map(r => ({ vencimento: r.vencimento, valor: num(r.valor), observacao: (r.observacao || "").trim() })),
            config: { modo: modo(), dias: Number($("finComDias").value) || 0, qtd: Number($("finComQtd").value) || 3, primeira: Number($("finComPrimeira").value) || 0,
                intervalo: $("finComIntervalo").value, repasses: regras.map(r => ({ tipo: r.tipo, usuario_id: r.usuario_id || "", parceiro_id: r.parceiro_id || "", nome: r.nome || "", pct: r.pct || "", valor: r.valor || "", quando: r.quando || "recebimento", dias: Number(r.dias) || 0, vencimento: r.vencimento || "" })) }
        };
        if (!travado) dados.repasses = expandir();
        const { error } = await op.ctx.sb.rpc("contrato_venda_salvar_comissao", { p_contrato: contratoId, p_dados: dados });
        if (error) { op.ctx.toast("O contrato foi salvo, mas a comissão não: " + op.ctx.traduzErro(error.message || String(error))); return false; }
        mexeu = false;
        return true;
    }
    // a comissão (%/R$) do contrato mudou: atualiza o total e a prévia
    function definirTipo(t) {
        if (!op) return;
        op.tipo = t;
        const b = $("finComBloco");
        if (!b) return;
        b.hidden = t !== "venda";
        if (t === "venda") desenhar();
    }
    function atualizar() { if (op && op.tipo === "venda" && montado) { $("finComTotal").textContent = total() ? dinheiro(total()) : "não informada"; notaRec(); previa(); } }

    window.SKLComissaoContrato = { abrir, salvar, atualizar, definirTipo, esconder: () => { const b = $("finComBloco"); if (b) b.hidden = true; } };
})();
