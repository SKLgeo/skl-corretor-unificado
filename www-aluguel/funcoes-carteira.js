// Configurações → "Funções da imobiliária": liga e desliga o que a imobiliária usa (carteiras_aluguel.funcoes).
// Cada função desligada some para toda a equipe (classe "sem-<chave>" no body + regras no fim de extras.css); os dados ficam guardados.
// Função sem chave gravada = ligada (menos "Travar a tela em pé", que começa desligada).
// Os outros módulos perguntam com window.SKLFuncoes.ativa("<chave>").
(function () {
    "use strict";
    const FUNCOES = [
        { chave: "travar_tela", nome: "Travar a tela em pé (celular e tablet)",
          texto: "No celular e no tablet o sistema fica sempre na vertical: se a pessoa deitar o aparelho, aparece um aviso para virar de volta. No computador nada muda." },
        { chave: "travar_tela_deitada", nome: "Travar a tela deitada (celular e tablet)",
          texto: "No celular e no tablet o sistema fica sempre na horizontal: se a pessoa colocar o aparelho em pé, aparece um aviso para virar de volta. Ligar este desliga o \"em pé\" (e vice-versa). No computador nada muda." },
        { chave: "propostas", nome: "Proposta de negócios (estudo de mercado)",
          texto: "Menu \"Proposta de negócios\": compara o imóvel com outros parecidos, calcula o valor do m² e gera o PDF com a proposta de valor e a marca da imobiliária." },
        { chave: "repasses", nome: "Repasses aos proprietários",
          texto: "A aba Repasses do Financeiro e o valor \"A repassar\" no Resumo. Ligue se a imobiliária recebe o aluguel e repassa ao proprietário." },
        { chave: "manutencao", nome: "Manutenção e chamados de defeito",
          texto: "Para a imobiliária que administra os imóveis: o inquilino avisa um defeito (pelo portal ou pela Central) e a imobiliária acompanha o conserto. Desligue se a imobiliária só intermedeia a locação e não cuida dos imóveis." },
        { chave: "portal", nome: "Portal do cliente (com PIX)",
          texto: "Link pessoal para o inquilino e o proprietário verem contrato, cobranças com PIX, recibos, repasses e documentos, e abrirem chamado. Aparece na ficha do cliente." },
        { chave: "extrato", nome: "Baixa pelo extrato do banco",
          texto: "Aba \"Extrato do banco\" no Financeiro: lê o arquivo OFX ou CSV do banco e dá baixa nas cobranças pagas." },
        { chave: "contabil", nome: "Contabilidade",
          texto: "Aba \"Contabilidade\" no Financeiro: receitas e despesas do período em planilha e PDF para o contador." },
        { chave: "agenda_celular", nome: "Agenda no celular",
          texto: "Botão \"Agenda no celular\": os compromissos aparecem no Google Agenda ou no calendário do iPhone." },
        { chave: "portais", nome: "Contatos do ZAP, Viva Real e OLX",
          texto: "Quadro em Configurações → Site e portais para os contatos dos portais entrarem sozinhos no CRM." }
    ];
    const PADRAO_DESLIGADO = [ "travar_tela", "travar_tela_deitada" ];
    // as duas travas não valem juntas: ligar uma desliga a outra
    const OPOSTA = { travar_tela: "travar_tela_deitada", travar_tela_deitada: "travar_tela" };
    let ctx = null, funcoes = {};
    const $ = id => document.getElementById(id);
    const h = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const ativa = chave => typeof funcoes[chave] === "boolean" ? funcoes[chave] : !PADRAO_DESLIGADO.includes(chave);

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
        FUNCOES.forEach(f => document.body.classList.toggle("sem-" + f.chave, !ativa(f.chave)));
        if (window.SKLCelular && window.SKLCelular.travarTela) window.SKLCelular.travarTela(ativa("travar_tela") ? "retrato" : ativa("travar_tela_deitada") ? "paisagem" : null);
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
        const pode = [ "administrador", "central_vendas" ].includes(ctx.papel && ctx.papel()) && (!ctx.pode || ctx.pode("configurar"));
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
        const pedido = { [chave]: ligar };
        if (ligar && OPOSTA[chave] && ativa(OPOSTA[chave])) pedido[OPOSTA[chave]] = false;
        const { data, error } = await ctx.sb.rpc("configurar_funcoes_carteira", { p_carteira: ctx.carteiraId(), p_funcoes: pedido });
        cb.disabled = false;
        if (error) { cb.checked = !ligar; ctx.toast(ctx.traduzErro(error.message || String(error))); return; }
        funcoes = data || { ...funcoes, ...pedido };
        aplicar();
        if (Object.keys(pedido).length > 1) painel();
        const fin = window.SKLFinanceiro;
        const abaAtiva = document.querySelector(".fin-aba.ativa");
        if (fin && !ligar && abaAtiva && (abaAtiva.hidden || getComputedStyle(abaAtiva).display === "none")) fin.mostrarAba("resumo");
        else if (fin && fin.renderizar) fin.renderizar();
        ctx.toast(ligar ? "Função ligada." : "Função desligada. Os dados já lançados continuam guardados.");
    }

    window.SKLFuncoes = { iniciar, ativa };
})();
