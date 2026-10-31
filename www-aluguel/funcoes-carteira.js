// Configurações → "Funções da imobiliária": liga e desliga o que a imobiliária usa (carteiras_aluguel.funcoes).
// Hoje: "Manutenção e chamados" — quem só intermedeia (não administra os imóveis) desliga, e somem a aba Manutenção do Financeiro,
// os chamados dentro do contrato, o aviso de manutenção no Resumo e o "Abrir chamado" do portal do cliente.
// Função sem chave gravada = ligada. Os outros módulos perguntam com window.SKLFuncoes.ativa("manutencao").
(function () {
    "use strict";
    const FUNCOES = [
        { chave: "manutencao", nome: "Manutenção e chamados de defeito",
          texto: "Para a imobiliária que administra os imóveis: o inquilino avisa um defeito (pelo portal ou pela Central) e a imobiliária acompanha o conserto. Desligue se a imobiliária só intermedeia a locação e não cuida dos imóveis." }
    ];
    let ctx = null, funcoes = {};
    const $ = id => document.getElementById(id);
    const h = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const ativa = chave => funcoes[chave] !== false;

    async function iniciar(contexto) {
        ctx = contexto;
        funcoes = {};
        const { data } = await ctx.sb.from("carteiras_aluguel").select("funcoes").eq("id", ctx.carteiraId()).maybeSingle();
        funcoes = (data && data.funcoes) || {};
        aplicar();
        painel();
    }

    // o que some quando uma função está desligada
    function aplicar() {
        const aba = document.querySelector('[data-fin-aba="chamados"]');
        if (aba) aba.hidden = !ativa("manutencao");
    }

    function painel() {
        const grade = document.querySelector("#page-settings .settings-grid");
        if (!grade) return;
        let p = $("funcoesCarteiraPanel");
        if (!p) {
            p = document.createElement("section");
            p.id = "funcoesCarteiraPanel";
            p.className = "panel form-panel";
            grade.insertBefore(p, grade.firstChild);
        }
        const pode = [ "administrador", "central_vendas" ].includes(ctx.papel && ctx.papel());
        p.hidden = !pode;
        if (!pode) return;
        p.innerHTML = `<span class="eyebrow">IMOBILIÁRIA</span><h2>Funções da imobiliária</h2>
          <p class="muted-text">Deixe ligado só o que a imobiliária usa. Desligar esconde a função de toda a equipe e do portal do cliente; os dados já lançados ficam guardados.</p>
          ${FUNCOES.map(f => `<label class="func-linha"><input type="checkbox" data-funcao="${h(f.chave)}"${ativa(f.chave) ? " checked" : ""} />
            <span><strong>${h(f.nome)}</strong><small>${h(f.texto)}</small></span></label>`).join("")}`;
        p.querySelectorAll("[data-funcao]").forEach(cb => cb.addEventListener("change", () => salvar(cb)));
    }

    async function salvar(cb) {
        const chave = cb.dataset.funcao, ligar = cb.checked;
        cb.disabled = true;
        const { data, error } = await ctx.sb.rpc("configurar_funcoes_carteira", { p_carteira: ctx.carteiraId(), p_funcoes: { [chave]: ligar } });
        cb.disabled = false;
        if (error) { cb.checked = !ligar; ctx.toast(ctx.traduzErro(error.message || String(error))); return; }
        funcoes = data || { ...funcoes, [chave]: ligar };
        aplicar();
        const fin = window.SKLFinanceiro;
        if (fin && chave === "manutencao" && !ligar && document.querySelector('[data-fin-aba="chamados"].ativa')) fin.mostrarAba("resumo");
        else if (fin && fin.renderizar) fin.renderizar();
        ctx.toast(ligar ? "Função ligada." : "Função desligada. Os dados já lançados continuam guardados.");
    }

    window.SKLFuncoes = { iniciar, ativa };
})();
