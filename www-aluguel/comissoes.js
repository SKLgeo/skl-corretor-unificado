// Regras de comissão configuráveis (Configurações → Regras de comissão), simulador, lista de comissões e o bloco
// "Comissões deste negócio" na negociação. O cálculo vive no banco (_comissao_calcular): o simulador e o lançamento
// automático ao fechar usam a mesma função, então a prévia é exatamente o que será lançado.
(function () {
    "use strict";
    const $ = id => document.getElementById(id);
    const BASES = {
        primeiro_aluguel: "1º aluguel",
        aluguel_mensal: "Aluguel do mês",
        valor_venda: "Valor da venda",
        comissao_imobiliaria: "Comissão da imobiliária",
        fixo: "Valor fixo em R$"
    };
    const QUEM = {
        corretor: "Quem fechou o negócio",
        captador: "Quem captou o imóvel",
        pessoa: "Pessoa da equipe (gestor, etc.)",
        parceiro: "Parceiro de fora (outra imobiliária)"
    };
    const FINS = { "": "Locação e venda", locacao: "Só locação", venda: "Só venda" };
    const SITUACAO = { pendente: "A pagar", aprovada: "Aprovada", paga: "Paga", cancelada: "Cancelada" };
    const TIPO = { fechamento: "Fechamento", captacao: "Captação", mensal: "Mensal", renovacao: "Renovação", bonus: "Bônus", parceria: "Parceria", gestao: "Gestão" };
    const MODELOS = {
        aluguel_integral: { nome: "1º aluguel integral", partes: [
            { rotulo: "1º aluguel integral", beneficiario: "corretor", base: "primeiro_aluguel", percentual: 100, recorrencia: "unica", finalidade: "locacao" }] },
        aluguel_mais_mensal: { nome: "1º aluguel + 2% ao mês", partes: [
            { rotulo: "1º aluguel integral", beneficiario: "corretor", base: "primeiro_aluguel", percentual: 100, recorrencia: "unica", finalidade: "locacao" },
            { rotulo: "2% do aluguel mensal", beneficiario: "corretor", base: "aluguel_mensal", percentual: 2, recorrencia: "mensal", inicio_mes: 2, finalidade: "locacao" }] },
        venda_captador: { nome: "Venda com captador", partes: [
            { rotulo: "Comissão de venda", beneficiario: "corretor", base: "comissao_imobiliaria", percentual: 40, recorrencia: "unica", finalidade: "venda" },
            { rotulo: "Captação", beneficiario: "captador", base: "comissao_imobiliaria", percentual: 10, recorrencia: "unica", finalidade: "venda" }] },
        parceria: { nome: "Venda em parceria 50/50", partes: [
            { rotulo: "Parte da parceira", beneficiario: "parceiro", parceiro_nome: "Imobiliária parceira", base: "comissao_imobiliaria", percentual: 50, recorrencia: "unica", finalidade: "venda" },
            { rotulo: "Comissão do corretor", beneficiario: "corretor", base: "comissao_imobiliaria", percentual: 20, recorrencia: "unica", finalidade: "venda" }] },
        meta: { nome: "Escalonada por meta", partes: [
            { rotulo: "Até a meta", beneficiario: "corretor", base: "comissao_imobiliaria", percentual: 30, recorrencia: "unica", finalidade: "venda", meta_max: 1000000 },
            { rotulo: "Acima da meta", beneficiario: "corretor", base: "comissao_imobiliaria", percentual: 40, recorrencia: "unica", finalidade: "venda", meta_min: 1000000 }] },
        bonus: { nome: "Bônus fixo por locação", partes: [
            { rotulo: "Bônus por locação", beneficiario: "corretor", base: "fixo", valor_fixo: 200, recorrencia: "unica", finalidade: "locacao" }] }
    };
    let ctx = null, ligado = false;
    let regras = [];
    let regraAberta = null;
    let partes = [];

    const h = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const podeGerir = () => !!ctx && ctx.podeGerir();
    function dinheiro(v) {
        if (v == null || v === "") return "—";
        return "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    function mesAno(d) {
        if (!d) return "—";
        const dt = new Date(String(d).slice(0, 10) + "T12:00:00");
        return dt.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }).replace(".", "").replace(" de ", "/");
    }
    function inicioDoMes() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); }
    function eFutura(c) { return c.competencia && new Date(c.competencia + "T12:00:00") >= new Date(inicioDoMes().getFullYear(), inicioDoMes().getMonth() + 1, 1); }
    function numero(v) { if (v === "" || v == null) return null; const n = ctx.parseValor(String(v)); return n == null ? null : n; }
    function msg(el, texto, ok) { el.textContent = texto; el.style.background = ok ? "#dff4e8" : "#f7e8e6"; el.style.color = ok ? "#247346" : "#9a3b34"; el.hidden = false; }
    function erro(e) { return ctx.traduzErro((e && e.message) || String(e || "")); }
    function nomePessoa(id) { const u = ctx.equipe().find(x => x.id === id); return u ? u.display_name : "pessoa da equipe"; }

    // ------------------------------------------------------------------ início
    function iniciar(contexto) {
        ctx = contexto;
        if (!ligado) { ligarEventos(); ligado = true; }
        document.querySelectorAll("[data-comissao]").forEach(el => { el.hidden = !podeGerir(); });
        $("newComissaoAluguelButton").hidden = !podeGerir();
        return carregarRegras();
    }
    async function carregarRegras() {
        if (!ctx || !ctx.carteiraId()) return;
        const { data, error } = await ctx.sb.from("comissao_regras_aluguel").select("*").eq("carteira_id", ctx.carteiraId()).eq("ativa", true).order("created_at");
        if (error) { console.warn("Regras de comissão:", error); return; }
        regras = data || [];
        renderRegras();
    }
    function ligarEventos() {
        $("comNovaRegra").addEventListener("click", () => abrirRegra(null));
        $("comModelo").addEventListener("change", () => {
            const m = MODELOS[$("comModelo").value];
            $("comModelo").value = "";
            if (!m) return;
            partes = JSON.parse(JSON.stringify(m.partes));
            if (!$("comRegraNome").value.trim()) $("comRegraNome").value = m.nome;
            desenharPartes();
            simular();
        });
        $("comAddParte").addEventListener("click", () => {
            partes.push({ rotulo: "", beneficiario: "corretor", base: "primeiro_aluguel", percentual: 100, recorrencia: "unica", finalidade: "locacao" });
            desenharPartes();
        });
        $("comRegraSalvar").addEventListener("click", salvarRegra);
        $("comRegraExcluir").addEventListener("click", excluirRegra);
        $("comSimular").addEventListener("click", simular);
        $("comSimFinalidade").addEventListener("change", () => {
            const venda = $("comSimFinalidade").value === "venda";
            $("comSimValorRotulo").textContent = venda ? "Valor da venda" : "Aluguel mensal";
            $("comSimValor").value = venda ? "500.000" : "2.500";
            $("comSimPrazoLabel").hidden = venda;
            $("comSimMetaLabel").hidden = !venda;
            simular();
        });
        [ "comFiltroSituacao", "comFiltroPessoa", "comFiltroMes" ].forEach(id => $(id).addEventListener("change", () => renderLista()));
        // nomes dos clientes vêm do CRM, que carrega depois: redesenha quando ele avisar
        document.addEventListener("skl-crm-render", () => { if (ctx && $("page-comissoes").classList.contains("active-page")) renderLista(); });
    }

    // ------------------------------------------------------------------ texto das partes (para listas e conferência)
    function resumoParte(p) {
        const quem = p.beneficiario === "pessoa" ? nomePessoa(p.pessoa_id) : p.beneficiario === "parceiro" ? (p.parceiro_nome || "parceiro") : { corretor: "quem fechou", captador: "quem captou" }[p.beneficiario] || "quem fechou";
        const quanto = p.base === "fixo" ? dinheiro(p.valor_fixo) : `${String(p.percentual ?? 0).replace(".", ",")}% ${{ primeiro_aluguel: "do 1º aluguel", aluguel_mensal: "do aluguel", valor_venda: "do valor da venda", comissao_imobiliaria: "da comissão da imobiliária" }[p.base] || ""}`;
        let quando = p.recorrencia === "mensal"
            ? `todo mês${Number(p.inicio_mes) > 1 ? ` a partir do ${p.inicio_mes}º mês` : ""}${p.meses ? `, por ${p.meses} meses` : ", durante o contrato"}`
            : "uma vez, no fechamento";
        const cond = [];
        if (p.finalidade) cond.push(p.finalidade === "venda" ? "só venda" : "só locação");
        if (p.valor_min) cond.push("valor a partir de " + dinheiro(p.valor_min));
        if (p.valor_max) cond.push("valor até " + dinheiro(p.valor_max));
        if (p.meta_min) cond.push("quando o corretor já fechou " + dinheiro(p.meta_min) + " no mês");
        if (p.meta_max) cond.push("enquanto o corretor fechou menos de " + dinheiro(p.meta_max) + " no mês");
        if (p.tipos && p.tipos.length) cond.push(p.tipos.join(", "));
        return `<strong>${h(p.rotulo || "Parte")}:</strong> ${h(quanto)} para ${h(quem)}, ${h(quando)}${cond.length ? ` <em>(${h(cond.join("; "))})</em>` : ""}`;
    }
    function renderRegras() {
        const box = $("comRegrasLista");
        if (!box) return;
        const usos = id => ctx.equipe().filter(u => u.regra_comissao_id === id).length;
        box.innerHTML = regras.length ? regras.map(r => `<article class="com-regra${r.padrao ? " padrao" : ""}">
            <header><strong>${h(r.nome)}</strong>${r.padrao ? `<span class="com-selo">Padrão da casa</span>` : ""}${usos(r.id) ? `<span class="com-uso">${usos(r.id)} corretor(es)</span>` : ""}</header>
            ${r.descricao ? `<p class="muted-text">${h(r.descricao)}</p>` : ""}
            <ul>${(r.componentes || []).map(p => `<li>${resumoParte(p)}</li>`).join("")}</ul>
            <div class="com-regra-acoes">
              <button type="button" class="secondary-button" data-reg-editar="${h(r.id)}">Editar e simular</button>
              <button type="button" class="secondary-button" data-reg-duplicar="${h(r.id)}">Duplicar</button>
              ${r.padrao ? "" : `<button type="button" class="secondary-button" data-reg-padrao="${h(r.id)}">Tornar padrão</button>`}
            </div>
          </article>`).join("")
            : `<div class="empty-state">Nenhuma regra ainda. Toque em "+ Nova regra" e comece de um modelo.</div>`;
        box.querySelectorAll("[data-reg-editar]").forEach(b => b.addEventListener("click", () => abrirRegra(regras.find(r => r.id === b.dataset.regEditar))));
        box.querySelectorAll("[data-reg-duplicar]").forEach(b => b.addEventListener("click", () => {
            const r = regras.find(x => x.id === b.dataset.regDuplicar);
            abrirRegra(null, { ...r, nome: r.nome + " (cópia)", padrao: false });
        }));
        box.querySelectorAll("[data-reg-padrao]").forEach(b => b.addEventListener("click", () => tornarPadrao(b.dataset.regPadrao)));
    }

    // ------------------------------------------------------------------ editor
    function abrirRegra(regra, base) {
        regraAberta = regra ? regra.id : null;
        const r = regra || base || { nome: "", descricao: "", honorarios_venda_pct: 6, padrao: !regras.length, componentes: [] };
        $("comRegraTitulo").textContent = regra ? "Editar regra" : "Nova regra de comissão";
        $("comRegraNome").value = r.nome || "";
        $("comRegraDescricao").value = r.descricao || "";
        $("comRegraHonorarios").value = String(r.honorarios_venda_pct ?? 6).replace(".", ",");
        $("comRegraPadrao").checked = !!r.padrao;
        $("comRegraExcluir").hidden = !regra;
        $("comRegraMsg").hidden = true;
        partes = JSON.parse(JSON.stringify(r.componentes || []));
        if (!partes.length) partes = JSON.parse(JSON.stringify(MODELOS.aluguel_integral.partes));
        $("comSimFinalidade").value = partes.some(p => p.finalidade === "locacao" || !p.finalidade) ? "locacao" : "venda";
        $("comSimFinalidade").dispatchEvent(new Event("change"));
        desenharPartes();
        $("comRegraDialog").showModal();
    }
    function opcoes(mapa, atual) { return Object.entries(mapa).map(([ v, t ]) => `<option value="${h(v)}"${v === (atual ?? "") ? " selected" : ""}>${h(t)}</option>`).join(""); }
    function desenharPartes() {
        const equipe = ctx.equipe().filter(u => u.active !== false);
        const tipos = ctx.tiposImovel ? ctx.tiposImovel() : [];
        $("comPartes").innerHTML = partes.map((p, i) => `<div class="com-parte" data-i="${i}">
            <div class="com-parte-topo"><span class="com-parte-num">${i + 1}</span>
              <input data-k="rotulo" value="${h(p.rotulo || "")}" placeholder="Nome da parte (ex.: 1º aluguel)" autocomplete="off" />
              <button type="button" class="text-button crm-remover" data-remover title="Tirar esta parte">✕</button></div>
            <div class="com-parte-grade">
              <label><span>Quem recebe</span><select data-k="beneficiario">${opcoes(QUEM, p.beneficiario || "corretor")}</select></label>
              ${p.beneficiario === "pessoa" ? `<label><span>Qual pessoa</span><select data-k="pessoa_id"><option value="">Escolha</option>${equipe.map(u => `<option value="${h(u.id)}"${u.id === p.pessoa_id ? " selected" : ""}>${h(u.display_name)}</option>`).join("")}</select></label>` : ""}
              ${p.beneficiario === "parceiro" ? `<label><span>Nome do parceiro</span><input data-k="parceiro_nome" value="${h(p.parceiro_nome || "")}" autocomplete="off" /></label>` : ""}
              <label><span>Calculado sobre</span><select data-k="base">${opcoes(BASES, p.base || "primeiro_aluguel")}</select></label>
              ${p.base === "fixo"
                ? `<label><span>Valor (R$)</span><input data-k="valor_fixo" inputmode="decimal" value="${h(p.valor_fixo ?? "")}" /></label>`
                : `<label><span>Percentual (%)</span><input data-k="percentual" inputmode="decimal" value="${h(String(p.percentual ?? "").replace(".", ","))}" /></label>`}
              <label><span>Quando paga</span><select data-k="recorrencia">${opcoes({ unica: "Uma vez, no fechamento", mensal: "Todo mês" }, p.recorrencia || "unica")}</select></label>
              ${p.recorrencia === "mensal" ? `<label><span>A partir do mês</span><input data-k="inicio_mes" type="number" min="1" value="${h(p.inicio_mes ?? 1)}" /></label>
                <label><span>Por quantos meses</span><input data-k="meses" type="number" min="1" max="120" value="${h(p.meses ?? "")}" placeholder="todo o contrato" /></label>` : ""}
              <label><span>Vale para</span><select data-k="finalidade">${opcoes(FINS, p.finalidade || "")}</select></label>
            </div>
            <details class="com-parte-cond"${p.valor_min || p.valor_max || p.meta_min || p.meta_max || (p.tipos && p.tipos.length) ? " open" : ""}>
              <summary>Condições (opcional)</summary>
              <div class="com-parte-grade">
                <label><span>Só se o valor for a partir de</span><input data-k="valor_min" inputmode="decimal" value="${h(p.valor_min ?? "")}" placeholder="R$" /></label>
                <label><span>Só se o valor for até</span><input data-k="valor_max" inputmode="decimal" value="${h(p.valor_max ?? "")}" placeholder="R$" /></label>
                <label><span>Meta: corretor já fechou no mês ao menos</span><input data-k="meta_min" inputmode="decimal" value="${h(p.meta_min ?? "")}" placeholder="R$" /></label>
                <label><span>Meta: enquanto fechou no mês menos de</span><input data-k="meta_max" inputmode="decimal" value="${h(p.meta_max ?? "")}" placeholder="R$" /></label>
              </div>
              ${tipos.length ? `<div class="com-tipos"><span class="crm-rotulo">Só para estes tipos de imóvel (nenhum marcado = todos)</span>${tipos.map(t => `<label class="check-inline"><input type="checkbox" data-tipo value="${h(t)}"${(p.tipos || []).includes(t) ? " checked" : ""} /> ${h(t)}</label>`).join("")}</div>` : ""}
            </details>
            <p class="com-parte-resumo">${resumoParte(lerParte(p))}</p>
          </div>`).join("") || `<div class="empty-state">Adicione uma parte ou escolha um modelo.</div>`;
        $("comPartes").querySelectorAll(".com-parte").forEach(card => {
            const i = Number(card.dataset.i);
            card.querySelectorAll("[data-k]").forEach(el => {
                const k = el.dataset.k;
                const estrutural = [ "beneficiario", "base", "recorrencia" ].includes(k);
                el.addEventListener(estrutural ? "change" : "input", () => {
                    partes[i][k] = el.value;
                    if (estrutural) desenharPartes();
                    else card.querySelector(".com-parte-resumo").innerHTML = resumoParte(lerParte(partes[i]));
                });
            });
            card.querySelectorAll("[data-tipo]").forEach(cb => cb.addEventListener("change", () => {
                partes[i].tipos = [ ...card.querySelectorAll("[data-tipo]:checked") ].map(x => x.value);
                card.querySelector(".com-parte-resumo").innerHTML = resumoParte(lerParte(partes[i]));
            }));
            card.querySelector("[data-remover]").addEventListener("click", () => { partes.splice(i, 1); desenharPartes(); });
        });
    }
    // normaliza números ("1.000.000", "2,5") antes de mandar ao banco
    function lerParte(p) {
        const q = { ...p };
        [ "percentual", "valor_fixo", "valor_min", "valor_max", "meta_min", "meta_max" ].forEach(k => { q[k] = numero(q[k]); if (q[k] == null) delete q[k]; });
        [ "meses", "inicio_mes" ].forEach(k => { q[k] = q[k] === "" || q[k] == null ? null : parseInt(q[k], 10); if (!q[k]) delete q[k]; });
        if (!q.finalidade) delete q.finalidade;
        if (q.beneficiario !== "pessoa") delete q.pessoa_id;
        if (q.beneficiario !== "parceiro") delete q.parceiro_nome;
        if (q.recorrencia !== "mensal") { delete q.meses; delete q.inicio_mes; }
        if (!q.tipos || !q.tipos.length) delete q.tipos;
        q.rotulo = (q.rotulo || "").trim() || (BASES[q.base] || "Comissão");
        return q;
    }
    function coletarRegra() {
        return {
            nome: $("comRegraNome").value.trim(),
            descricao: $("comRegraDescricao").value.trim(),
            honorarios_venda_pct: numero($("comRegraHonorarios").value) ?? 6,
            padrao: $("comRegraPadrao").checked,
            componentes: partes.map(lerParte)
        };
    }
    async function salvarRegra() {
        const dados = coletarRegra();
        if (!dados.nome) { msg($("comRegraMsg"), "Dê um nome à regra."); return; }
        if (!dados.componentes.length) { msg($("comRegraMsg"), "Adicione pelo menos uma parte."); return; }
        $("comRegraSalvar").disabled = true;
        const { error } = await ctx.sb.rpc("comissao_salvar_regra", { p_carteira: ctx.carteiraId(), p_dados: dados, p_id: regraAberta });
        $("comRegraSalvar").disabled = false;
        if (error) { msg($("comRegraMsg"), erro(error)); return; }
        $("comRegraDialog").close();
        await carregarRegras();
        ctx.toast("Regra salva. Ela vale para os próximos negócios fechados.");
    }
    async function excluirRegra() {
        const r = regras.find(x => x.id === regraAberta);
        if (!r) return;
        const n = ctx.equipe().filter(u => u.regra_comissao_id === r.id).length;
        if (!window.confirm(`Excluir a regra "${r.nome}"?${n ? ` ${n} corretor(es) voltam para a regra padrão.` : ""} As comissões já lançadas não mudam.`)) return;
        const { error } = await ctx.sb.rpc("comissao_excluir_regra", { p_id: r.id });
        if (error) { msg($("comRegraMsg"), erro(error)); return; }
        $("comRegraDialog").close();
        await carregarRegras();
        await ctx.recarregarEquipe();
        ctx.toast("Regra excluída.");
    }
    async function tornarPadrao(id) {
        const r = regras.find(x => x.id === id);
        if (!r) return;
        const { error } = await ctx.sb.rpc("comissao_salvar_regra", { p_carteira: ctx.carteiraId(), p_id: r.id,
            p_dados: { nome: r.nome, descricao: r.descricao, honorarios_venda_pct: r.honorarios_venda_pct, padrao: true, componentes: r.componentes } });
        if (error) { ctx.toast(erro(error)); return; }
        await carregarRegras();
        ctx.toast(`"${r.nome}" agora é a regra padrão da casa.`);
    }

    // ------------------------------------------------------------------ simulador (mesmo cálculo do banco)
    async function simular() {
        const box = $("comSimResultado");
        if (!box) return;
        const regra = coletarRegra();
        if (!regra.componentes.length) { box.innerHTML = `<p class="muted-text">Adicione uma parte para simular.</p>`; return; }
        const cenario = {
            finalidade: $("comSimFinalidade").value, valor: numero($("comSimValor").value),
            contrato_meses: $("comSimPrazo").value || null, volume_mes: numero($("comSimMeta").value)
        };
        box.innerHTML = `<p class="muted-text">Calculando…</p>`;
        const { data, error } = await ctx.sb.rpc("comissao_simular", { p_carteira: ctx.carteiraId(), p_regra: regra, p_cenario: cenario });
        if (error) { box.innerHTML = `<p class="form-message">${h(erro(error))}</p>`; return; }
        const linhas = data || [];
        if (!linhas.length) { box.innerHTML = `<p class="muted-text">Com esse exemplo nenhuma parte se aplica (confira "Vale para" e as condições).</p>`; return; }
        // agrupa as parcelas mensais de cada parte
        const grupos = new Map();
        linhas.forEach(l => { const g = grupos.get(l.idx) || { ...l, total: 0, n: 0, ultima: l.competencia }; g.total += Number(l.valor) || 0; g.n++; g.ultima = l.competencia; grupos.set(l.idx, g); });
        const porPessoa = new Map();
        const quem = g => g.beneficiario === "pessoa" ? nomePessoa(g.pessoa_id) : g.beneficiario === "parceiro" ? (g.parceiro_nome || "Parceiro") : { corretor: "Quem fechou", captador: "Quem captou" }[g.beneficiario];
        grupos.forEach(g => porPessoa.set(quem(g), (porPessoa.get(quem(g)) || 0) + g.total));
        box.innerHTML = `<table class="com-sim-tabela"><thead><tr><th>Parte</th><th>Quem recebe</th><th>Quando</th><th>Valor</th></tr></thead><tbody>
            ${[ ...grupos.values() ].map(g => `<tr><td>${h(g.rotulo)}</td><td>${h(quem(g))}</td>
              <td>${g.parcelas ? `${g.n}× de ${h(dinheiro(g.valor))} (${h(mesAno(g.competencia))} a ${h(mesAno(g.ultima))})` : "No fechamento"}</td>
              <td><strong>${h(dinheiro(g.total))}</strong></td></tr>`).join("")}
          </tbody></table>
          <div class="com-sim-totais">${[ ...porPessoa.entries() ].map(([ p, v ]) => `<span>${h(p)}: <strong>${h(dinheiro(v))}</strong></span>`).join("")}</div>`;
    }

    // ------------------------------------------------------------------ regra de cada corretor (tela Corretores)
    function celulaRegra(user, pode) {
        const padrao = regras.find(r => r.padrao);
        if (!pode || user.papel !== "corretor") {
            const r = regras.find(x => x.id === user.regra_comissao_id);
            return h(r ? r.nome : (user.papel === "corretor" && padrao ? `Padrão (${padrao.nome})` : "—"));
        }
        return `<select class="com-regra-select" data-regra-usuario="${h(user.id)}">
            <option value="">Padrão da casa${padrao ? ` (${h(padrao.nome)})` : ""}</option>
            ${regras.filter(r => !r.padrao).map(r => `<option value="${h(r.id)}"${r.id === user.regra_comissao_id ? " selected" : ""}>${h(r.nome)}</option>`).join("")}
          </select>`;
    }
    function ligarCelulas(container) {
        container.querySelectorAll("[data-regra-usuario]").forEach(sel => sel.addEventListener("change", async () => {
            sel.disabled = true;
            const { error } = await ctx.sb.rpc("comissao_definir_regra_corretor", { p_carteira: ctx.carteiraId(), p_usuario: sel.dataset.regraUsuario, p_regra: sel.value || null });
            sel.disabled = false;
            if (error) { ctx.toast(erro(error)); return; }
            await ctx.recarregarEquipe();
            renderRegras();
            ctx.toast("Regra de comissão do corretor atualizada. Vale para os próximos negócios.");
        }));
    }

    // ------------------------------------------------------------------ lista de comissões
    function situacaoDe(c) {
        if (c.status === "cancelada") return "canceladas";
        if (c.status === "paga") return "pagas";
        return eFutura(c) ? "previstas" : "apagar";
    }
    function pill(c) {
        const s = situacaoDe(c);
        const rot = s === "previstas" ? "Prevista" : SITUACAO[c.status] || c.status;
        const cls = { pagas: "disponivel", canceladas: "alugado", previstas: "indisponivel", apagar: c.status === "aprovada" ? "reservado" : "em_negociacao" }[s];
        return `<span class="status-pill ${cls}">${h(rot)}</span>`;
    }
    function negocioDe(c) {
        const I = window.SKLCRM && window.SKLCRM.interno;
        const n = I && c.negociacao_id ? I.negs.get(c.negociacao_id) : null;
        const cli = n && I.clientes.get(n.cliente_id);
        const im = c.construcao_id && ctx.imoveis().find(i => i.id === c.construcao_id);
        return [ cli ? cli.nome : "", im ? (im.codigo ? im.codigo + " · " : "") + im.nome : "" ].filter(Boolean).join(" — ") || (c.observacao || "Lançamento manual");
    }
    function baseTexto(c) {
        if (c.base_tipo === "fixo") return "Valor fixo";
        const rot = { primeiro_aluguel: "1º aluguel", aluguel_mensal: "Aluguel", valor_venda: "Venda", comissao_imobiliaria: "Comissão da imobiliária" }[c.base_tipo];
        const base = c.base_valor ?? c.valor_aluguel;
        return `${rot || "Aluguel"} ${dinheiro(base)}${c.percentual != null ? " · " + String(c.percentual).replace(".", ",") + "%" : ""}`;
    }
    function preencherFiltros(lista) {
        const pessoas = new Map();
        lista.forEach(c => pessoas.set(c.corretor_id || "__" + (c.beneficiario_nome || c.corretor_nome || ""), c.corretor_nome || c.beneficiario_nome || "—"));
        const selP = $("comFiltroPessoa"), atualP = selP.value;
        selP.innerHTML = `<option value="">Todas as pessoas</option>` + [ ...pessoas.entries() ].sort((a, b) => String(a[1]).localeCompare(String(b[1]))).map(([ id, nome ]) => `<option value="${h(id)}">${h(nome)}</option>`).join("");
        selP.value = [ ...selP.options ].some(o => o.value === atualP) ? atualP : "";
        selP.hidden = !podeGerir();
        const meses = [ ...new Set(lista.map(c => (c.competencia || String(c.criado_em || "").slice(0, 10)).slice(0, 7)).filter(Boolean)) ].sort().reverse();
        const selM = $("comFiltroMes"), atualM = selM.value;
        selM.innerHTML = `<option value="">Todos os meses</option>` + meses.map(m => `<option value="${m}">${h(mesAno(m + "-01"))}</option>`).join("");
        selM.value = meses.includes(atualM) ? atualM : "";
    }
    function renderLista() {
        if (!ctx) return;
        const todas = ctx.comissoes();
        preencherFiltros(todas);
        const sit = $("comFiltroSituacao").value, pessoa = $("comFiltroPessoa").value, mes = $("comFiltroMes").value;
        const lista = todas.filter(c => (!sit || situacaoDe(c) === sit)
            && (!pessoa || (c.corretor_id || "__" + (c.beneficiario_nome || c.corretor_nome || "")) === pessoa)
            && (!mes || (c.competencia || String(c.criado_em || "").slice(0, 10)).startsWith(mes)))
            .sort((a, b) => String(a.competencia || a.criado_em).localeCompare(String(b.competencia || b.criado_em)) || (a.parcela || 0) - (b.parcela || 0));
        const soma = arr => arr.reduce((s, c) => s + (Number(c.valor_comissao) || 0), 0);
        const ini = inicioDoMes();
        const pagoMes = todas.filter(c => c.status === "paga" && c.pago_em && new Date(c.pago_em) >= ini);
        $("comResumo").innerHTML = [
            [ "A pagar", soma(todas.filter(c => situacaoDe(c) === "apagar")), "pendentes e aprovadas até este mês" ],
            [ "Previsto", soma(todas.filter(c => situacaoDe(c) === "previstas")), "parcelas dos próximos meses" ],
            [ "Pago este mês", soma(pagoMes), pagoMes.length + " lançamento(s)" ],
            [ "Pago no total", soma(todas.filter(c => c.status === "paga")), "" ]
        ].map(([ r, v, s ]) => `<div class="crm-resumo-item"><span>${h(r)}</span><strong>${h(dinheiro(v))}</strong>${s ? `<small>${h(s)}</small>` : ""}</div>`).join("");
        $("comContagem").textContent = `${lista.length} lançamento(s) · ${dinheiro(soma(lista))}`;
        $("comissaoAluguelTableEmpty").hidden = lista.length > 0;
        const gerir = podeGerir();
        $("comissaoAluguelTableBody").innerHTML = lista.slice(0, 400).map(c => {
            const futura = situacaoDe(c) === "previstas";
            const acoes = !gerir || c.status === "paga" || c.status === "cancelada" ? "" :
                (c.status === "pendente" && !futura ? `<button class="row-button" data-com-status="aprovada" data-id="${h(c.id)}">Aprovar</button>` : "")
                + (!futura ? `<button class="row-button" data-com-status="paga" data-id="${h(c.id)}">Marcar paga</button>` : "")
                + `<button class="row-button" data-com-status="cancelada" data-id="${h(c.id)}">Cancelar</button>`;
            return `<tr>
              <td><strong>${h(c.corretor_nome || c.beneficiario_nome || "—")}</strong>${c.tipo && c.tipo !== "fechamento" ? `<br><small class="muted-text">${h(TIPO[c.tipo] || c.tipo)}</small>` : ""}</td>
              <td>${h(negocioDe(c))}</td>
              <td>${h(c.componente || "Comissão")}${c.parcela ? ` <small class="muted-text">${c.parcela}/${c.parcelas}</small>` : ""}</td>
              <td><small>${h(baseTexto(c))}</small></td>
              <td><strong>${h(dinheiro(c.valor_comissao))}</strong></td>
              <td>${h(mesAno(c.competencia || c.criado_em))}</td>
              <td>${pill(c)}</td>
              <td class="com-acoes">${acoes}</td>
            </tr>`;
        }).join("");
        $("comissaoAluguelTableBody").querySelectorAll("[data-com-status]").forEach(b => b.addEventListener("click", () => mudarStatus(b.dataset.id, b.dataset.comStatus)));
    }
    async function mudarStatus(id, status) {
        if (status === "cancelada" && !window.confirm("Cancelar este lançamento de comissão?")) return;
        const payload = { status };
        if (status === "paga") payload.pago_em = new Date().toISOString();
        const { error } = await ctx.sb.from("comissoes_aluguel").update(payload).eq("id", id);
        if (error) { ctx.toast(erro(error)); return; }
        await ctx.recarregarComissoes();
        ctx.toast({ aprovada: "Comissão aprovada.", paga: "Comissão marcada como paga.", cancelada: "Lançamento cancelado." }[status]);
    }

    // ------------------------------------------------------------------ na negociação fechada
    function desenharNaNegociacao(n, box) {
        if (!box) return;
        if (!ctx || !n || n.situacao !== "ganha") { box.hidden = true; return; }
        const minhas = ctx.comissoes().filter(c => c.negociacao_id === n.id && c.status !== "cancelada");
        const grupos = new Map();
        minhas.forEach(c => {
            const k = (c.corretor_nome || c.beneficiario_nome || "") + "|" + (c.componente || "");
            const g = grupos.get(k) || { quem: c.corretor_nome || c.beneficiario_nome || "—", parte: c.componente || "Comissão", total: 0, n: 0, pagas: 0, parcelas: c.parcelas };
            g.total += Number(c.valor_comissao) || 0; g.n++; if (c.status === "paga") g.pagas++;
            grupos.set(k, g);
        });
        box.hidden = false;
        box.innerHTML = `<span class="eyebrow">COMISSÕES DESTE NEGÓCIO</span>`
            + (grupos.size ? [ ...grupos.values() ].map(g => `<div class="crm-visita crm-visita-realizada"><span class="crm-visita-quando">${h(dinheiro(g.total))}</span>
                <span class="crm-visita-info"><strong>${h(g.quem)}</strong><small>${h(g.parte)}${g.parcelas ? ` · ${g.n} parcela(s)` : ""}${g.pagas ? ` · ${g.pagas} paga(s)` : ""}</small></span></div>`).join("")
              : `<p class="muted-text">${n.valor == null ? "Informe o valor do negócio para calcular as comissões." : "Nenhuma comissão lançada para este negócio."}</p>`)
            + (podeGerir() ? `<button type="button" class="secondary-button" data-com-recalcular>${grupos.size ? "Recalcular pela regra atual" : "Lançar comissões"}</button>` : "");
        const b = box.querySelector("[data-com-recalcular]");
        if (b) b.addEventListener("click", async () => {
            if (grupos.size && !window.confirm("Apagar os lançamentos pendentes deste negócio e calcular de novo pela regra atual?")) return;
            b.disabled = true;
            const { data, error } = await ctx.sb.rpc("comissoes_gerar_negociacao", { p_negociacao: n.id, p_substituir: true });
            b.disabled = false;
            if (error) { ctx.toast(erro(error)); return; }
            await ctx.recarregarComissoes();
            desenharNaNegociacao(n, box);
            ctx.toast(data ? `${data} lançamento(s) de comissão.` : "Nenhuma comissão: confira o valor do negócio e a regra padrão.");
        });
    }

    window.SKLComissoes = { iniciar, carregarRegras, renderRegras, renderLista, celulaRegra, ligarCelulas, desenharNaNegociacao, regras: () => regras };
})();
