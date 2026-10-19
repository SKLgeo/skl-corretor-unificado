// Metas trimestrais (topo da página Comissões): meta e super meta por trimestre, VGC de cada corretor, proporcional aos dias
// trabalhados e o adicional conquistado para o trimestre seguinte. Tudo calculado no banco (metas_painel); a Central vê a
// equipe toda e define metas, adicionais e a data de contratação; o corretor vê só a própria linha.
(function () {
    "use strict";
    const $ = id => document.getElementById(id);
    const h = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    let ctx = null, ligado = false, atual = null, dados = null, carregando = 0, pessoaData = null;

    const central = () => !!ctx && ctx.usuario() && [ "administrador", "central_vendas" ].includes(ctx.usuario().papel);
    const erro = e => ctx.traduzErro((e && e.message) || String(e || ""));
    const dinheiro = v => v == null || v === "" ? "—" : "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const pct = v => Number(v || 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%";
    const numero = v => { if (v === "" || v == null) return null; const n = ctx.parseValor(String(v)); return n == null ? null : n; };
    const dataBR = d => d ? new Date(String(d).slice(0, 10) + "T12:00:00").toLocaleDateString("pt-BR") : "";
    const rotulo = (a, t) => `${t}º trimestre de ${a}`;
    function hoje() { const d = new Date(); return { ano: d.getFullYear(), trimestre: Math.floor(d.getMonth() / 3) + 1 }; }
    function anterior(a, t) { return t === 1 ? { ano: a - 1, trimestre: 4 } : { ano: a, trimestre: t - 1 }; }

    async function iniciar(contexto) {
        ctx = contexto;
        if (!ligado) { montar(); ligado = true; }
        atual = atual || hoje();
        await carregar();
    }

    function montar() {
        const pagina = $("page-comissoes");
        if (!pagina) return;
        const art = document.createElement("article");
        art.id = "metasPainel";
        art.className = "panel metas-painel";
        pagina.insertBefore(art, pagina.firstChild);
        // recarrega ao abrir a página (os negócios ganhos mudam o VGC)
        new MutationObserver(() => { if (pagina.classList.contains("active-page")) carregar(); }).observe(pagina, { attributes: true, attributeFilter: [ "class" ] });

        const d = document.createElement("dialog");
        d.id = "metasDialog";
        d.className = "crm-dialog";
        d.innerHTML = `<form method="dialog" class="dialog-card">
            <button class="dialog-close" type="button" data-fechar>×</button>
            <span class="eyebrow">METAS DA EQUIPE</span>
            <h2>Metas do trimestre</h2>
            <div class="form-row">
              <label><span>Ano</span><input id="metasAno" type="number" min="2000" max="2100" /></label>
              <label><span>Trimestre</span><select id="metasTri"><option value="1">1º (jan–mar)</option><option value="2">2º (abr–jun)</option><option value="3">3º (jul–set)</option><option value="4">4º (out–dez)</option></select></label>
            </div>
            <div class="form-row">
              <label><span>Meta (VGC do corretor)</span><input id="metasMeta" inputmode="decimal" autocomplete="off" /></label>
              <label><span>Super meta</span><input id="metasSuper" inputmode="decimal" autocomplete="off" /></label>
            </div>
            <p class="muted-text">Vale para cada corretor. Quem foi contratado no meio do trimestre tem a meta proporcional aos dias trabalhados. Deixe a meta vazia para tirar a meta do trimestre.</p>
            <span class="eyebrow">ADICIONAL NO TRIMESTRE SEGUINTE</span>
            <div class="form-row">
              <label><span>Bateu a meta: + % do corretor</span><input id="metasAddMeta" inputmode="decimal" autocomplete="off" /></label>
              <label><span>Bateu a super meta: + %</span><input id="metasAddSuper" inputmode="decimal" autocomplete="off" /></label>
            </div>
            <label><span>Sem adicional em negócio com quantos corretores ou mais? (0 = sempre tem)</span><input id="metasSemAdd" type="number" min="0" max="10" /></label>
            <button id="metasSalvar" type="button" class="primary-button">Salvar</button>
            <div id="metasMsg" class="form-message" hidden></div>
          </form>`;
        document.body.appendChild(d);
        const c = document.createElement("dialog");
        c.id = "metasContratoDialog";
        c.className = "crm-dialog";
        c.innerHTML = `<form method="dialog" class="dialog-card">
            <button class="dialog-close" type="button" data-fechar>×</button>
            <span class="eyebrow">EQUIPE</span>
            <h2 id="metasContratoTitulo">Data de contratação</h2>
            <label><span>Contratado(a) em</span><input id="metasContratoData" type="date" /></label>
            <p class="muted-text">A meta do trimestre em que a pessoa entrou fica proporcional aos dias trabalhados. Sem data, a meta é cheia.</p>
            <button id="metasContratoSalvar" type="button" class="primary-button">Salvar</button>
            <div id="metasContratoMsg" class="form-message" hidden></div>
          </form>`;
        document.body.appendChild(c);
        [ d, c ].forEach(x => x.querySelectorAll("[data-fechar]").forEach(b => b.addEventListener("click", () => x.close())));
        $("metasTri").addEventListener("change", preencherValoresDoTrimestre);
        $("metasAno").addEventListener("change", preencherValoresDoTrimestre);
        $("metasSalvar").addEventListener("click", salvarMetas);
        $("metasContratoSalvar").addEventListener("click", salvarContratacao);
    }

    async function carregar() {
        if (!ctx || !ctx.carteiraId() || !$("metasPainel")) return;
        const seq = ++carregando;
        const { data, error } = await ctx.sb.rpc("metas_painel", { p_carteira: ctx.carteiraId(), p_ano: atual.ano, p_trimestre: atual.trimestre });
        if (seq !== carregando) return;
        if (error) { $("metasPainel").hidden = true; console.warn("Metas:", error); return; }
        dados = data;
        desenhar();
    }

    function opcoesTrimestre() {
        const h0 = hoje(), lista = [];
        let x = { ano: h0.ano, trimestre: h0.trimestre };
        for (let i = 0; i < 6; i++) { lista.push(x); x = anterior(x.ano, x.trimestre); }
        (dados.trimestres || []).forEach(t => { if (!lista.some(l => l.ano === t.ano && l.trimestre === t.trimestre)) lista.push({ ano: t.ano, trimestre: t.trimestre }); });
        lista.sort((a, b) => b.ano - a.ano || b.trimestre - a.trimestre);
        return lista.map(t => `<option value="${t.ano}-${t.trimestre}"${t.ano === atual.ano && t.trimestre === atual.trimestre ? " selected" : ""}>${h(rotulo(t.ano, t.trimestre))}</option>`).join("");
    }

    function barra(v, alvo) {
        if (!(alvo > 0)) return "";
        const p = Math.min(v / alvo * 100, 100);
        return `<span class="metas-barra"><i style="width:${p.toFixed(1)}%"></i></span><small>${pct(v / alvo * 100)}</small>`;
    }

    function desenhar() {
        const art = $("metasPainel");
        art.hidden = false;
        const pessoas = dados.pessoas || [];
        const temMeta = dados.meta != null;
        const souCentral = central();
        const prox = atual.trimestre === 4 ? `1º trimestre de ${atual.ano + 1}` : `${atual.trimestre + 1}º trimestre`;
        art.innerHTML = `<div class="panel-heading metas-topo">
              <div><span class="eyebrow">METAS DA EQUIPE</span><h2>${souCentral || pessoas.length !== 1 ? "Metas do trimestre" : "Minha meta do trimestre"}</h2></div>
              <div class="metas-acoes">
                <select id="metasTrimestreSel" aria-label="Trimestre">${opcoesTrimestre()}</select>
                ${souCentral ? `<button type="button" class="secondary-button" id="metasEditar">${temMeta ? "Editar metas" : "Definir metas"}</button>` : ""}
              </div>
            </div>
            ${temMeta ? `<div class="metas-alvos"><span>Meta <strong>${h(dinheiro(dados.meta))}</strong></span>${dados.super_meta != null ? `<span>Super meta <strong>${h(dinheiro(dados.super_meta))}</strong></span>` : ""}
                <span class="muted-text">Bateu a meta: +${h(pct(dados.config.adicional_meta))} no ${h(prox)} · super meta: +${h(pct(dados.config.adicional_super))}</span></div>`
              : `<p class="muted-text">Sem meta definida para o ${h(rotulo(atual.ano, atual.trimestre))}.${souCentral ? " Clique em \"Definir metas\"." : ""}</p>`}
            ${pessoas.length ? `<div class="table-panel"><table class="metas-tabela"><thead><tr>
                <th>Corretor</th><th>VGC no trimestre</th>${temMeta ? "<th>Meta</th><th>Super meta</th><th>Conquistou</th>" : ""}<th>Adicional valendo agora</th>${souCentral ? "<th>Contratado em</th>" : ""}
              </tr></thead><tbody>
              ${pessoas.map(p => `<tr>
                <td><strong>${h(p.nome || "—")}</strong>${!p.usuario_id ? `<br><small class="muted-text">sem acesso ao app</small>` : ""}</td>
                <td><strong>${h(dinheiro(p.vgc))}</strong><br><small class="muted-text">${p.negocios} negócio(s)</small></td>
                ${temMeta ? `<td>${barra(Number(p.vgc), Number(p.meta_prop))}<small class="muted-text">${h(dinheiro(p.meta_prop))}${Number(p.proporcional) < 1 ? " (proporcional)" : ""}</small></td>
                  <td>${p.super_prop != null ? barra(Number(p.vgc), Number(p.super_prop)) + `<small class="muted-text">${h(dinheiro(p.super_prop))}</small>` : "—"}</td>
                  <td>${Number(p.adicional_conquistado) > 0 ? `<span class="status-pill disponivel">+${h(pct(p.adicional_conquistado))}</span><br><small class="muted-text">no ${h(prox)}</small>` : `<span class="muted-text">—</span>`}</td>` : ""}
                <td>${Number(p.adicional_vigente) > 0 ? `<strong>+${h(pct(p.adicional_vigente))}</strong>` : `<span class="muted-text">—</span>`}</td>
                ${souCentral ? `<td>${p.usuario_id ? `<button type="button" class="row-button" data-contrato="${h(p.usuario_id)}">${p.contratado_em ? h(dataBR(p.contratado_em)) : "Informar"}</button>` : (p.contratado_em ? h(dataBR(p.contratado_em)) : "—")}</td>` : ""}
              </tr>`).join("")}
              </tbody></table></div>` : `<p class="muted-text">Nenhum corretor na equipe.</p>`}
            <p class="muted-text metas-dica">VGC do corretor = a parte dele na comissão de cada negócio ganho no trimestre (comissão ÷ número de envolvidos, parceiro incluído). Negócio sem divisão conta inteiro para o corretor do negócio.</p>`;
        $("metasTrimestreSel").addEventListener("change", () => {
            const [ a, t ] = $("metasTrimestreSel").value.split("-").map(Number);
            atual = { ano: a, trimestre: t };
            carregar();
        });
        const ed = $("metasEditar");
        if (ed) ed.addEventListener("click", abrirMetas);
        art.querySelectorAll("[data-contrato]").forEach(b => b.addEventListener("click", () => abrirContratacao(pessoas.find(p => p.usuario_id === b.dataset.contrato))));
    }

    function valorBR(v) { return v == null ? "" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    function preencherValoresDoTrimestre() {
        const a = Number($("metasAno").value), t = Number($("metasTri").value);
        const m = (dados.trimestres || []).find(x => x.ano === a && x.trimestre === t);
        $("metasMeta").value = m ? valorBR(m.meta) : "";
        $("metasSuper").value = m ? valorBR(m.super_meta) : "";
    }
    function abrirMetas() {
        $("metasAno").value = atual.ano;
        $("metasTri").value = String(atual.trimestre);
        preencherValoresDoTrimestre();
        $("metasAddMeta").value = String(dados.config.adicional_meta).replace(".", ",");
        $("metasAddSuper").value = String(dados.config.adicional_super).replace(".", ",");
        $("metasSemAdd").value = dados.config.sem_adicional_com_corretores;
        $("metasMsg").hidden = true;
        $("metasDialog").showModal();
    }
    function falha(id, e) { const el = $(id); el.textContent = erro(e); el.style.background = "#f7e8e6"; el.style.color = "#9a3b34"; el.hidden = false; }
    async function salvarMetas() {
        const cart = ctx.carteiraId(), a = Number($("metasAno").value), t = Number($("metasTri").value);
        const r1 = await ctx.sb.rpc("metas_salvar", { p_carteira: cart, p_ano: a, p_trimestre: t, p_meta: numero($("metasMeta").value), p_super: numero($("metasSuper").value) });
        if (r1.error) { falha("metasMsg", r1.error); return; }
        const r2 = await ctx.sb.rpc("metas_configurar", { p_carteira: cart, p_config: {
            adicional_meta: numero($("metasAddMeta").value), adicional_super: numero($("metasAddSuper").value), sem_adicional_com_corretores: $("metasSemAdd").value } });
        if (r2.error) { falha("metasMsg", r2.error); return; }
        $("metasDialog").close();
        atual = { ano: a, trimestre: t };
        await carregar();
        ctx.toast("Metas salvas.");
    }
    function abrirContratacao(p) {
        if (!p) return;
        pessoaData = p;
        $("metasContratoTitulo").textContent = "Data de contratação — " + (p.nome || "");
        $("metasContratoData").value = p.contratado_em ? String(p.contratado_em).slice(0, 10) : "";
        $("metasContratoMsg").hidden = true;
        $("metasContratoDialog").showModal();
    }
    async function salvarContratacao() {
        const { error } = await ctx.sb.rpc("definir_contratacao", { p_carteira: ctx.carteiraId(), p_usuario: pessoaData.usuario_id, p_data: $("metasContratoData").value || null });
        if (error) { falha("metasContratoMsg", error); return; }
        $("metasContratoDialog").close();
        await carregar();
        if (ctx.recarregarEquipe) ctx.recarregarEquipe();
        ctx.toast("Data de contratação salva.");
    }

    function sair() { dados = null; atual = null; const art = $("metasPainel"); if (art) art.innerHTML = ""; }

    window.SKLMetas = { iniciar, recarregar: carregar, sair };
})();
