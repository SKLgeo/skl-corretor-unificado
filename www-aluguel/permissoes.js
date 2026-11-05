// Permissões por TIPO de acesso (carteiras_aluguel.permissoes_papeis), escolhidas pela imobiliária em Configurações.
// O administrador tem sempre tudo. Sem nada gravado, cada tipo fica com o padrão abaixo (o mesmo de public._permissao_padrao).
// O banco decide de verdade o que cada um vê e grava (tem_permissao_carteira); esta tabela só mostra e esconde as telas.
(function () {
    "use strict";
    const PAPEIS = [ [ "corretor", "Corretor" ], [ "central_vendas", "Central" ], [ "gestor", "Gestor" ], [ "financeiro", "Financeiro" ] ];
    // chave, nome, explicação, tipos com o padrão ligado, tipos em que dá para mudar
    const TODOS = [ "corretor", "central_vendas", "gestor", "financeiro" ];
    const LISTA = [
        { grupo: "Imóveis" },
        { chave: "aprovar_cadastros", nome: "Aprovar cadastros de imóveis", texto: "Aprovar ou recusar os imóveis que os corretores cadastram (menu Cadastros).", padrao: [ "central_vendas" ], muda: TODOS },
        { chave: "editar_imoveis", nome: "Editar imóveis aprovados", texto: "Destravar e alterar um imóvel que já está no ar.", padrao: [ "central_vendas" ], muda: [ "central_vendas" ] },
        { chave: "tela_propostas", nome: "Proposta de negócios", texto: "Montar estudos de mercado com proposta de valor e gerar o PDF com a marca da imobiliária.", padrao: [ "central_vendas", "gestor" ], muda: TODOS },
        { grupo: "Equipe e clientes" },
        { chave: "ver_equipe_toda", nome: "Ver clientes e negócios de toda a equipe", texto: "Desligado, a pessoa vê só os próprios clientes, negócios e agenda.", padrao: [ "central_vendas", "gestor", "financeiro" ], muda: TODOS },
        { chave: "tela_crm", nome: "Negociações, Agenda e Clientes", texto: "As telas do dia a dia do corretor.", padrao: [ "corretor", "central_vendas", "gestor" ], muda: TODOS },
        { chave: "tela_interesses", nome: "Interesses", texto: "Pedidos de interesse registrados pelos corretores.", padrao: [ "central_vendas" ], muda: [ "central_vendas", "gestor" ] },
        { chave: "tela_equipe", nome: "Equipe (ver a lista)", texto: "Criar e alterar acessos continua só com a Central e o administrador.", padrao: [ "central_vendas" ], muda: [ "central_vendas", "gestor" ] },
        { grupo: "Números e financeiro" },
        { chave: "tela_painel", nome: "📊 Painel", texto: "O painel com VGV, metas, comissões e despesas.", padrao: [ "central_vendas", "gestor", "financeiro" ], muda: TODOS },
        { chave: "tela_indicadores", nome: "Indicadores", texto: "Funil, equipe e ranking. O corretor vê só os números dele.", padrao: TODOS, muda: TODOS },
        { chave: "ver_financeiro", nome: "Ver o Financeiro", texto: "Contratos, cobranças, contas e despesas (só olhar).", padrao: [ "central_vendas", "gestor", "financeiro" ], muda: TODOS },
        { chave: "gerir_financeiro", nome: "Lançar no Financeiro", texto: "Receber, dar baixa, criar contratos, lançar despesas e mexer nas comissões.", padrao: [ "central_vendas", "financeiro" ], muda: [ "central_vendas", "gestor", "financeiro" ] },
        { chave: "tela_comissoes", nome: "Comissões da equipe", texto: "A tela com as comissões de todos (cada corretor sempre vê as próprias).", padrao: [ "central_vendas", "financeiro" ], muda: [ "central_vendas", "gestor", "financeiro" ] },
        { grupo: "Configurações" },
        { chave: "configurar", nome: "Configurações da imobiliária", texto: "Funções, regras de comissão, funil, notas, site e portais.", padrao: [ "central_vendas" ], muda: [ "central_vendas" ] }
    ];
    const PADRAO = {};
    LISTA.forEach(p => { if (p.chave) PADRAO[p.chave] = p.padrao; });

    let ctx = null, gravadas = {};
    const $ = id => document.getElementById(id);
    const h = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    // o app chama ao entrar (antes de montar o menu)
    async function carregar(sb, carteiraId) {
        gravadas = {};
        try {
            const { data } = await sb.from("carteiras_aluguel").select("permissoes_papeis").eq("id", carteiraId).maybeSingle();
            gravadas = (data && data.permissoes_papeis) || {};
        } catch { gravadas = {}; }
    }
    function vale(chave, papel) {
        if (papel === "administrador") return true;
        const v = gravadas[chave] && gravadas[chave][papel];
        if (typeof v === "boolean") return v;
        return (PADRAO[chave] || []).includes(papel);
    }

    function painel(contexto) {
        ctx = contexto;
        const grade = document.querySelector("#page-settings .settings-grid");
        if (!grade) return;
        let p = $("permissoesPanel");
        if (!p) {
            p = document.createElement("section");
            p.id = "permissoesPanel";
            p.className = "panel form-panel perm-panel";
            const funcoes = $("funcoesCarteiraPanel");
            grade.insertBefore(p, funcoes ? funcoes.nextSibling : grade.firstChild);
        }
        const papel = ctx.papel();
        p.hidden = ![ "administrador", "central_vendas" ].includes(papel);
        if (p.hidden) return;
        const admin = papel === "administrador";
        p.innerHTML = `<span class="eyebrow">ACESSOS</span><h2>O que cada tipo de acesso pode fazer</h2>
          <p class="muted-text">Ligue ou desligue para cada tipo. Vale para todas as pessoas daquele tipo. O <b>Administrador</b> tem sempre tudo.
            ${admin ? "" : "<br><b>Só o administrador muda esta tabela.</b>"}</p>
          <div class="perm-tabela-caixa"><table class="perm-tabela">
            <thead><tr><th>Permissão</th>${PAPEIS.map(([ , n ]) => `<th>${h(n)}</th>`).join("")}<th>Administrador</th></tr></thead>
            <tbody>${LISTA.map(item => item.grupo
                ? `<tr class="perm-grupo"><td colspan="${PAPEIS.length + 2}">${h(item.grupo)}</td></tr>`
                : `<tr><td><strong>${h(item.nome)}</strong><small>${h(item.texto)}</small></td>
                    ${PAPEIS.map(([ r, n ]) => item.muda.includes(r)
                        ? `<td data-r="${h(n)}"><label class="perm-chave"><input type="checkbox" data-perm="${h(item.chave)}" data-papel="${h(r)}"${vale(item.chave, r) ? " checked" : ""}${admin ? "" : " disabled"} /><span></span></label></td>`
                        : `<td data-r="${h(n)}" class="perm-fixo" title="Este tipo de acesso não usa esta função">${vale(item.chave, r) ? "✓" : "—"}</td>`).join("")}
                    <td data-r="Administrador" class="perm-fixo">✓</td></tr>`).join("")}</tbody></table></div>
          <p class="muted-text perm-nota">Mudou? Quem já está com o sistema aberto vê a mudança ao entrar de novo ou recarregar a página.</p>`;
        p.querySelectorAll("[data-perm]").forEach(cb => cb.addEventListener("change", () => salvar(cb)));
    }

    async function salvar(cb) {
        const chave = cb.dataset.perm, papel = cb.dataset.papel, ligar = cb.checked;
        cb.disabled = true;
        const { data, error } = await ctx.sb.rpc("configurar_permissoes_papeis", { p_carteira: ctx.carteiraId(), p_permissoes: { [chave]: { [papel]: ligar } } });
        cb.disabled = false;
        if (error) { cb.checked = !ligar; ctx.toast(ctx.traduzErro(error.message || String(error))); return; }
        gravadas = data || gravadas;
        const nome = (LISTA.find(x => x.chave === chave) || {}).nome || chave;
        const tipo = (PAPEIS.find(x => x[0] === papel) || [])[1] || papel;
        ctx.toast(`${tipo}: "${nome}" ${ligar ? "ligado" : "desligado"}.`);
    }

    window.SKLPermissoes = { carregar, vale, painel, LISTA, PAPEIS };
})();
