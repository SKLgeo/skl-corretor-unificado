// Divisão do negócio: num negócio ganho, corretores da casa e parceiros de fora, cada um com o seu %. O cálculo é do banco
// (crm_sugerir_divisao / crm_salvar_divisao): a prévia da janela e o que é gravado saem da mesma função. Ao salvar, os
// lançamentos de comissão pendentes do negócio são refeitos a partir da divisão. Também cuida do cadastro de parceiros
// (página Equipe).
(function () {
    "use strict";
    const $ = id => document.getElementById(id);
    const h = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    let ctx = null, parceiros = [], ligado = false;
    let neg = null, boxAtual = null, linhas = [], previaTimer = null, previaSeq = 0, parceiroEditando = null, linhaDoParceiro = null;

    const podeGerir = () => !!ctx && ctx.podeGerir();
    const erro = e => ctx.traduzErro((e && e.message) || String(e || ""));
    function dinheiro(v) {
        if (v == null || v === "") return "—";
        return "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    const pct = v => (v == null || v === "" ? "—" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 3 }) + "%");
    const numero = v => { if (v === "" || v == null) return null; const n = ctx.parseValor(String(v)); return n == null ? null : n; };
    function msg(texto, ok) {
        const el = $("divMsg");
        if (!texto) { el.hidden = true; return; }
        el.textContent = texto; el.style.background = ok ? "#dff4e8" : "#f7e8e6"; el.style.color = ok ? "#247346" : "#9a3b34"; el.hidden = false;
    }

    // ------------------------------------------------------------------ início
    async function iniciar(contexto) {
        ctx = contexto;
        if (!ligado) { criarDialogos(); ligado = true; }
        await carregarParceiros();
        desenharParceirosNaEquipe();
    }
    async function carregarParceiros() {
        parceiros = [];
        if (!podeGerir() || !ctx.carteiraId()) return;
        const { data, error } = await ctx.sb.from("crm_parceiros").select("*").eq("carteira_id", ctx.carteiraId()).order("nome");
        if (error) { console.warn("Parceiros:", error); return; }
        parceiros = data || [];
    }

    // ------------------------------------------------------------------ janelas (criadas aqui, sem mexer no index.html)
    function criarDialogos() {
        const d = document.createElement("dialog");
        d.id = "divDialog";
        d.className = "crm-dialog crm-dialog-larga";
        d.innerHTML = `<form method="dialog" class="dialog-card">
            <button class="dialog-close" type="button" data-fechar>×</button>
            <span class="eyebrow">DIVISÃO DO NEGÓCIO</span>
            <h2 id="divTitulo">Dividir a comissão</h2>
            <p class="muted-text">A sugestão segue a regra da carteira: parceiro com o % dele; corretor com o % do cadastro mais o adicional da meta, dividido entre os corretores do negócio. Ajuste o que precisar antes de salvar.</p>
            <div class="form-row">
              <label><span>Comissão total do negócio</span><input id="divTotal" inputmode="decimal" autocomplete="off" /></label>
              <p id="divTotalDica" class="muted-text div-dica"></p>
            </div>
            <div id="divLinhas" class="div-linhas"></div>
            <div class="div-add">
              <button type="button" class="secondary-button" data-add="corretor">+ Corretor da casa</button>
              <button type="button" class="secondary-button" data-add="parceiro">+ Parceiro de fora</button>
            </div>
            <div id="divResumo" class="div-resumo"></div>
            <div class="div-acoes">
              <button id="divSugerir" type="button" class="secondary-button">Refazer pela regra</button>
              <button id="divRemover" type="button" class="danger-button" hidden>Tirar a divisão</button>
              <button id="divSalvar" type="button" class="primary-button">Salvar divisão</button>
            </div>
            <div id="divMsg" class="form-message" hidden></div>
          </form>`;
        document.body.appendChild(d);
        const p = document.createElement("dialog");
        p.id = "divParceiroDialog";
        p.className = "crm-dialog";
        p.innerHTML = `<form method="dialog" class="dialog-card">
            <button class="dialog-close" type="button" data-fechar>×</button>
            <span class="eyebrow">PARCEIRO DE FORA</span>
            <h2 id="divParcTitulo">Novo parceiro</h2>
            <label><span>Nome</span><input id="divParcNome" autocomplete="off" maxlength="120" /></label>
            <div class="form-row">
              <label><span>CRECI</span><input id="divParcCreci" autocomplete="off" /></label>
              <label><span>% padrão do parceiro</span><input id="divParcPct" inputmode="decimal" autocomplete="off" /></label>
            </div>
            <div class="form-row">
              <label><span>Telefone</span><input id="divParcTel" inputmode="tel" autocomplete="off" /></label>
              <label><span>E-mail</span><input id="divParcEmail" type="email" autocomplete="off" /></label>
            </div>
            <label class="div-check"><input id="divParcAtivo" type="checkbox" checked /> Ativo (aparece para escolher nos negócios)</label>
            <label><span>Observação</span><input id="divParcObs" autocomplete="off" /></label>
            <button id="divParcSalvar" type="button" class="primary-button">Salvar parceiro</button>
            <div id="divParcMsg" class="form-message" hidden></div>
          </form>`;
        document.body.appendChild(p);
        [ d, p ].forEach(x => x.querySelectorAll("[data-fechar]").forEach(b => b.addEventListener("click", () => x.close())));
        $("divTotal").addEventListener("input", () => { previa(); });
        $("divTotal").addEventListener("blur", () => { const v = numero($("divTotal").value); if (v != null) $("divTotal").value = Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); });
        d.querySelectorAll("[data-add]").forEach(b => b.addEventListener("click", () => {
            linhas.push(b.dataset.add === "parceiro" ? { tipo: "parceiro", parceiro_id: "", nome: "", percentual: null }
                : { tipo: "corretor", usuario_id: "", nome: "", percentual: null, adicional_meta: 0, base_tipo: "total" });
            desenharLinhas(); previa();
        }));
        $("divSugerir").addEventListener("click", () => sugerir(true));
        $("divSalvar").addEventListener("click", salvar);
        $("divRemover").addEventListener("click", remover);
        $("divParcSalvar").addEventListener("click", salvarParceiro);
    }

    // ------------------------------------------------------------------ bloco no negócio ganho
    async function desenharNaNegociacao(n, box) {
        if (!box || !ctx) return;
        box.querySelectorAll(".div-negocio").forEach(el => el.remove());
        if (!n || n.situacao !== "ganha") return;
        const sec = document.createElement("div");
        sec.className = "div-negocio";
        box.appendChild(sec);
        let envolvidos = [];
        if (n.divisao_em) {
            const { data } = await ctx.sb.from("crm_negocio_envolvidos").select("*").eq("negociacao_id", n.id).order("ordem");
            envolvidos = data || [];
        }
        if (!sec.isConnected) return;
        sec.innerHTML = (envolvidos.length ? `<div class="div-negocio-resumo">
              <div><span>Comissão total</span><strong>${h(dinheiro(n.comissao_total))}</strong></div>
              ${envolvidos.map(e => `<div><span>${h(e.nome)} <small>${e.tipo === "parceiro" ? "parceiro" : "corretor"} · ${h(textoRegra(e))}</small></span><strong>${h(dinheiro(e.valor))}</strong></div>`).join("")}
              <div class="div-imob"><span>Fica para a imobiliária</span><strong>${h(dinheiro(n.comissao_imobiliaria))}</strong></div>
            </div>` : (podeGerir() ? `<p class="muted-text">Teve parceiro ou mais de um corretor? Divida a comissão entre os envolvidos.</p>` : ""))
            + (podeGerir() ? `<button type="button" class="secondary-button" data-div-abrir>${envolvidos.length ? "Editar divisão" : "Dividir comissão (corretores e parceiros)"}</button>` : "");
        const b = sec.querySelector("[data-div-abrir]");
        if (b) b.addEventListener("click", () => abrir(n, box));
        if (window.SKLFinGestao) window.SKLFinGestao.desenharNaNegociacao(n, box);
    }
    function textoRegra(e) {
        if (e.tipo === "parceiro") return pct(e.percentual) + " da comissão";
        const total = Number(e.percentual) + Number(e.adicional_meta || 0);
        return pct(total) + (Number(e.adicional_meta) > 0 ? ` (${pct(e.percentual)} + ${pct(e.adicional_meta)} da meta)` : "")
            + (e.base_tipo === "restante" ? " do que sobra do parceiro" : "") + (e.divisor > 1 ? ` ÷ ${e.divisor} corretores` : "");
    }

    // ------------------------------------------------------------------ janela
    async function abrir(n, box) {
        neg = n; boxAtual = box;
        msg("");
        $("divTitulo").textContent = "Dividir a comissão" + (n.titulo ? " — " + n.titulo : "");
        $("divRemover").hidden = !n.divisao_em;
        linhas = []; desenharLinhas(); $("divResumo").innerHTML = "";
        $("divDialog").showModal();
        await sugerir(false);
    }
    function dadosAtuais() {
        return {
            comissao_total: numero($("divTotal").value),
            envolvidos: linhas.map(l => l.tipo === "parceiro"
                ? { tipo: "parceiro", parceiro_id: l.parceiro_id || null, nome: l.nome, percentual: l.percentual }
                : { tipo: "corretor", usuario_id: l.usuario_id || null, nome: l.nome, percentual: l.percentual, adicional_meta: l.adicional_meta, base_tipo: l.base_tipo })
        };
    }
    // refazer = true: mantém quem está na lista e recalcula os % pela regra
    async function sugerir(refazer) {
        let p_dados = null;
        if (refazer) {
            const d = dadosAtuais();
            p_dados = { comissao_total: d.comissao_total, envolvidos: d.envolvidos.map(e => ({ tipo: e.tipo, usuario_id: e.usuario_id, parceiro_id: e.parceiro_id, nome: e.nome })) };
        }
        const { data, error } = await ctx.sb.rpc("crm_sugerir_divisao", { p_negociacao: neg.id, p_dados });
        if (error) { msg(erro(error)); return; }
        $("divTotal").value = data.comissao_total != null ? Number(data.comissao_total).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
        $("divTotalDica").textContent = data.finalidade === "venda" ? "Venda: valor do negócio × honorários da regra padrão (ajuste se for outro)." : "Locação: 1º aluguel (ajuste se for outro).";
        linhas = (data.envolvidos || []).map(e => ({
            tipo: e.tipo, usuario_id: e.usuario_id || "", parceiro_id: e.parceiro_id || "", nome: e.nome || "",
            percentual: e.percentual == null ? null : Number(e.percentual), adicional_meta: Number(e.adicional_meta || 0), base_tipo: e.base_tipo || "total"
        }));
        if (data.sem_adicional_com_corretores > 0 && linhas.filter(l => l.tipo === "corretor").length >= data.sem_adicional_com_corretores) {
            msg(`Com ${data.sem_adicional_com_corretores} corretores ou mais no negócio, o adicional da meta não entra (regra da carteira).`, true);
        }
        desenharLinhas();
        previa();
    }
    function opcoesEquipe(atual) {
        const equipe = ctx.equipe().filter(u => u.active !== false || u.id === atual).sort((a, b) => String(a.display_name).localeCompare(String(b.display_name)));
        return `<option value="">Escolha a pessoa</option>` + equipe.map(u => `<option value="${h(u.id)}"${u.id === atual ? " selected" : ""}>${h(u.display_name)}</option>`).join("")
            + `<option value="__fora"${atual === "__fora" ? " selected" : ""}>Outra pessoa (sem acesso ao app)</option>`;
    }
    function opcoesParceiros(atual) {
        const lista = parceiros.filter(p => p.ativo || p.id === atual);
        return `<option value="">Escolha o parceiro</option>` + lista.map(p => `<option value="${h(p.id)}"${p.id === atual ? " selected" : ""}>${h(p.nome)}${p.creci ? " · CRECI " + h(p.creci) : ""}</option>`).join("")
            + `<option value="__novo">+ Cadastrar parceiro novo</option>`;
    }
    function desenharLinhas() {
        const box = $("divLinhas");
        if (!linhas.length) { box.innerHTML = `<p class="muted-text">Nenhum envolvido. Adicione o corretor e, se houver, o parceiro.</p>`; return; }
        box.innerHTML = linhas.map((l, i) => {
            const fora = l.tipo === "corretor" && !l.usuario_id && l.nome;
            if (l.tipo === "parceiro") return `<div class="div-linha" data-i="${i}">
                <span class="div-tipo parceiro">Parceiro</span>
                <label class="div-quem"><span>Quem</span><select data-campo="parceiro">${opcoesParceiros(l.parceiro_id)}</select></label>
                <label class="div-num"><span>% do parceiro</span><input data-campo="percentual" inputmode="decimal" value="${l.percentual == null ? "" : h(String(l.percentual).replace(".", ","))}" /></label>
                <span class="div-valor" data-valor>—</span>
                <button type="button" class="div-tirar" data-tirar aria-label="Tirar">×</button>
              </div>`;
            return `<div class="div-linha" data-i="${i}">
                <span class="div-tipo">Corretor</span>
                <label class="div-quem"><span>Quem</span><select data-campo="usuario">${opcoesEquipe(fora ? "__fora" : l.usuario_id)}</select>
                  <input data-campo="nome" placeholder="Nome da pessoa" value="${h(l.nome)}" ${fora || (!l.usuario_id && l.nome === "" && l._fora) ? "" : "hidden"} /></label>
                <label class="div-num"><span>% do corretor</span><input data-campo="percentual" inputmode="decimal" value="${l.percentual == null ? "" : h(String(l.percentual).replace(".", ","))}" /></label>
                <label class="div-num"><span>+ meta</span><input data-campo="adicional" inputmode="decimal" value="${h(String(l.adicional_meta || 0).replace(".", ","))}" /></label>
                <label class="div-base"><span>Calcular sobre</span><select data-campo="base">
                  <option value="total"${l.base_tipo !== "restante" ? " selected" : ""}>a comissão toda</option>
                  <option value="restante"${l.base_tipo === "restante" ? " selected" : ""}>o que sobra do parceiro</option></select></label>
                <span class="div-valor" data-valor>—</span>
                <button type="button" class="div-tirar" data-tirar aria-label="Tirar">×</button>
              </div>`;
        }).join("");
        box.querySelectorAll(".div-linha").forEach(el => {
            const l = linhas[Number(el.dataset.i)];
            el.querySelector("[data-tirar]").addEventListener("click", () => {
                const eraParceiro = l.tipo === "parceiro";
                linhas.splice(Number(el.dataset.i), 1); desenharLinhas();
                if (eraParceiro) aplicarBaseDaRegra();
                previa();
            });
            const num = (campo, chave) => { const inp = el.querySelector(`[data-campo="${campo}"]`); if (inp) inp.addEventListener("input", () => { l[chave] = numero(inp.value); if (l.tipo === "parceiro") aplicarBaseDaRegra(); previa(); }); };
            num("percentual", "percentual");
            num("adicional", "adicional_meta");
            const base = el.querySelector('[data-campo="base"]');
            if (base) base.addEventListener("change", () => { l.base_tipo = base.value; previa(); });
            const usu = el.querySelector('[data-campo="usuario"]');
            const nome = el.querySelector('[data-campo="nome"]');
            if (usu) usu.addEventListener("change", () => {
                if (usu.value === "__fora") { l.usuario_id = ""; l._fora = true; l.nome = ""; nome.hidden = false; nome.focus(); }
                else {
                    const u = ctx.equipe().find(x => x.id === usu.value);
                    l.usuario_id = usu.value; l.nome = u ? u.display_name : ""; nome.hidden = true;
                    if (u && u.percentual_comissao != null && l.percentual == null) { l.percentual = Number(u.percentual_comissao); el.querySelector('[data-campo="percentual"]').value = String(l.percentual).replace(".", ","); }
                }
                previa();
            });
            if (nome) nome.addEventListener("input", () => { l.nome = nome.value; previa(); });
            const par = el.querySelector('[data-campo="parceiro"]');
            if (par) par.addEventListener("change", () => {
                if (par.value === "__novo") { par.value = l.parceiro_id || ""; abrirParceiro(null, l); return; }
                const p = parceiros.find(x => x.id === par.value);
                l.parceiro_id = par.value; l.nome = p ? p.nome : "";
                if (p) { l.percentual = Number(p.percentual_padrao); el.querySelector('[data-campo="percentual"]').value = String(l.percentual).replace(".", ","); }
                aplicarBaseDaRegra();
                previa();
            });
        });
    }
    // Regra da carteira para a base do corretor: com parceiro de 50%, sobre o que sobra; senão, sobre a comissão toda.
    // Roda quando os parceiros mudam (a pessoa ainda pode trocar depois).
    function aplicarBaseDaRegra() {
        const com50 = linhas.some(l => l.tipo === "parceiro" && Number(l.percentual) === 50);
        linhas.forEach(l => { if (l.tipo === "corretor") l.base_tipo = com50 ? "restante" : "total"; });
        $("divLinhas").querySelectorAll('[data-campo="base"]').forEach(sel => { sel.value = com50 ? "restante" : "total"; });
    }
    function previa() {
        clearTimeout(previaTimer);
        previaTimer = setTimeout(async () => {
            const seq = ++previaSeq;
            const d = dadosAtuais();
            const faltando = d.envolvidos.find(e => !e.nome || e.percentual == null);
            if (faltando || d.comissao_total == null) {
                $("divResumo").innerHTML = `<p class="muted-text">${d.comissao_total == null ? "Informe a comissão total." : "Complete quem é e o % de cada envolvido para ver os valores."}</p>`;
                $("divLinhas").querySelectorAll("[data-valor]").forEach(el => { el.textContent = "—"; });
                $("divSalvar").disabled = true;
                return;
            }
            const { data, error } = await ctx.sb.rpc("crm_salvar_divisao", { p_negociacao: neg.id, p_dados: d, p_gravar: false });
            if (seq !== previaSeq) return;
            if (error) { $("divResumo").innerHTML = `<p class="div-erro">${h(erro(error))}</p>`; $("divSalvar").disabled = true; return; }
            $("divSalvar").disabled = false;
            (data.envolvidos || []).forEach((e, i) => {
                const el = $("divLinhas").querySelector(`.div-linha[data-i="${i}"] [data-valor]`);
                if (el) el.innerHTML = `<strong>${h(dinheiro(e.valor))}</strong>${e.tipo === "corretor" && e.divisor > 1 ? `<small>÷ ${e.divisor} corretores</small>` : ""}`;
            });
            $("divResumo").innerHTML = `<div><span>Comissão total</span><strong>${h(dinheiro(data.comissao_total))}</strong></div>
                <div><span>Corretores e parceiros</span><strong>${h(dinheiro(data.distribuido))}</strong></div>
                <div class="div-imob"><span>Fica para a imobiliária</span><strong>${h(dinheiro(data.imobiliaria))}</strong></div>`;
        }, 250);
    }
    async function salvar() {
        const d = dadosAtuais();
        $("divSalvar").disabled = true;
        const { data, error } = await ctx.sb.rpc("crm_salvar_divisao", { p_negociacao: neg.id, p_dados: d, p_gravar: true });
        $("divSalvar").disabled = false;
        if (error) { msg(erro(error)); return; }
        neg.comissao_total = Number(data.comissao_total);
        neg.comissao_imobiliaria = Number(data.imobiliaria);
        neg.divisao_em = new Date().toISOString();
        await ctx.recarregarComissoes();
        $("divDialog").close();
        if (window.SKLComissoes && boxAtual) window.SKLComissoes.desenharNaNegociacao(neg, boxAtual);
        ctx.toast(`Divisão salva: ${data.lancamentos} lançamento(s) de comissão.`);
    }
    async function remover() {
        if (!window.confirm("Tirar a divisão deste negócio? Os lançamentos pendentes dela são apagados e a comissão volta a seguir a regra da carteira.")) return;
        const { error } = await ctx.sb.rpc("crm_remover_divisao", { p_negociacao: neg.id });
        if (error) { msg(erro(error)); return; }
        neg.comissao_total = null; neg.comissao_imobiliaria = null; neg.divisao_em = null;
        await ctx.recarregarComissoes();
        $("divDialog").close();
        if (window.SKLComissoes && boxAtual) window.SKLComissoes.desenharNaNegociacao(neg, boxAtual);
        ctx.toast("Divisão retirada.");
    }

    // ------------------------------------------------------------------ parceiros
    function abrirParceiro(p, linha) {
        parceiroEditando = p; linhaDoParceiro = linha || null;
        $("divParcTitulo").textContent = p ? "Editar parceiro" : "Novo parceiro";
        $("divParcNome").value = p ? p.nome : "";
        $("divParcCreci").value = p ? p.creci || "" : "";
        $("divParcPct").value = String(p ? p.percentual_padrao : 50).replace(".", ",");
        $("divParcTel").value = p ? p.telefone || "" : "";
        $("divParcEmail").value = p ? p.email || "" : "";
        $("divParcAtivo").checked = p ? !!p.ativo : true;
        $("divParcObs").value = p ? p.observacao || "" : "";
        $("divParcMsg").hidden = true;
        $("divParceiroDialog").showModal();
        $("divParcNome").focus();
    }
    async function salvarParceiro() {
        const dados = {
            nome: $("divParcNome").value, creci: $("divParcCreci").value, percentual_padrao: numero($("divParcPct").value),
            telefone: $("divParcTel").value, email: $("divParcEmail").value, ativo: $("divParcAtivo").checked, observacao: $("divParcObs").value
        };
        const { data: id, error } = await ctx.sb.rpc("crm_salvar_parceiro", { p_carteira: ctx.carteiraId(), p_dados: dados, p_id: parceiroEditando ? parceiroEditando.id : null });
        if (error) { const el = $("divParcMsg"); el.textContent = erro(error); el.style.background = "#f7e8e6"; el.style.color = "#9a3b34"; el.hidden = false; return; }
        await carregarParceiros();
        desenharParceirosNaEquipe();
        $("divParceiroDialog").close();
        if (linhaDoParceiro) {
            const p = parceiros.find(x => x.id === id);
            linhaDoParceiro.parceiro_id = id; linhaDoParceiro.nome = p ? p.nome : dados.nome;
            linhaDoParceiro.percentual = p ? Number(p.percentual_padrao) : dados.percentual_padrao;
            desenharLinhas(); aplicarBaseDaRegra(); previa();
        }
        ctx.toast("Parceiro salvo.");
    }
    function desenharParceirosNaEquipe() {
        const pagina = $("page-corretores");
        if (!pagina) return;
        let art = $("divParceirosPainel");
        if (!podeGerir()) { if (art) art.remove(); return; }
        if (!art) {
            art = document.createElement("article");
            art.id = "divParceirosPainel";
            art.className = "panel";
            const convites = $("inviteAluguelList") && $("inviteAluguelList").closest("article");
            pagina.insertBefore(art, convites || null);
        }
        art.innerHTML = `<div class="panel-heading"><h2>Parceiros de fora</h2><button type="button" class="secondary-button" data-parc-novo>+ Novo parceiro</button></div>
            <p class="muted-text">Corretores autônomos e outras imobiliárias que dividem negócios com vocês. Não entram no app: aparecem só para escolher na divisão do negócio.</p>
            ${parceiros.length ? `<div class="table-panel"><table><thead><tr><th>Nome</th><th>CRECI</th><th>Contato</th><th>% padrão</th><th>Situação</th><th></th></tr></thead><tbody>
              ${parceiros.map(p => `<tr><td><strong>${h(p.nome)}</strong></td><td>${h(p.creci || "—")}</td><td>${h([ p.telefone, p.email ].filter(Boolean).join(" · ") || "—")}</td>
                <td>${h(pct(p.percentual_padrao))}</td><td>${p.ativo ? '<span class="status-pill disponivel">Ativo</span>' : '<span class="status-pill indisponivel">Inativo</span>'}</td>
                <td><button type="button" class="row-button" data-parc-editar="${h(p.id)}">Editar</button></td></tr>`).join("")}
              </tbody></table></div>` : `<p class="muted-text">Nenhum parceiro cadastrado.</p>`}`;
        art.querySelector("[data-parc-novo]").addEventListener("click", () => abrirParceiro(null));
        art.querySelectorAll("[data-parc-editar]").forEach(b => b.addEventListener("click", () => abrirParceiro(parceiros.find(p => p.id === b.dataset.parcEditar))));
    }

    function sair() { parceiros = []; neg = null; }

    window.SKLDivisao = { iniciar, desenharNaNegociacao, carregarParceiros, sair, parceiros: () => parceiros };
})();
