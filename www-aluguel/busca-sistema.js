// 🔎 Busca no sistema (10/11/2026, pedido da Cerrado): a pessoa escreve o que quer fazer ("pagamento corretores",
// "vendas", "agenda", "valor a partir") e aparecem as telas e abas certas, com o passo a passo curto e o botão "Ir".
// Também acha imóveis (código, nome, bairro), clientes (nome, apelido, celular) e pessoas da equipe.
// Abre pelo botão 🔎 no topo ou pelas teclas Ctrl+K ou "/" (no computador). Só mostra o que a pessoa pode usar.
(function () {
    "use strict";
    let ctx = null, montado = false;
    const $ = id => document.getElementById(id);
    const h = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const normal = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const espera = ms => new Promise(r => setTimeout(r, ms));

    // ------------------------------------------------------------------ quem pode o quê
    const modoCorretor = () => !!(window.SKLModoCorretor && window.SKLModoCorretor.ativo && window.SKLModoCorretor.ativo());
    const pode = k => !ctx || !ctx.pode || ctx.pode(k);
    const gestao = () => !!(ctx && ctx.gestao && ctx.gestao());
    const verFin = () => pode("ver_financeiro") && !document.body.classList.contains("sem-financeiro");
    const gerirFin = () => pode("gerir_financeiro");
    const funcao = k => !document.body.classList.contains("sem-" + k);
    const PAGINAS_CORRETOR = [ "hoje", "construcoes", "clientes", "negociacoes", "propostas", "conta", "agenda", "comissoes", "cadastros" ];
    function paginaDisponivel(p) {
        if (modoCorretor()) return PAGINAS_CORRETOR.includes(p);
        if (p === "hoje" || p === "conta") return false;
        const b = document.querySelector(`.nav-button[data-page="${p}"]`);
        return !!b && !b.hidden && !b.closest("[hidden]");
    }

    // ------------------------------------------------------------------ ações de navegação
    async function irPagina(p) { ctx.showPage(p); window.scrollTo(0, 0); await espera(120); }
    async function irFin(aba, depois) {
        await irPagina("financeiro");
        if (window.SKLFinanceiro && window.SKLFinanceiro.mostrarAba) window.SKLFinanceiro.mostrarAba(aba);
        await espera(250);
        if (depois) depois();
    }
    async function irConfig(aba, painelId) {
        await irPagina("settings");
        await espera(200);
        const b = document.querySelector(`[data-cfg-aba="${aba}"]`);
        if (b) b.click();
        await espera(150);
        const p = painelId && $(painelId);
        if (p && !p.hidden) p.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    const clicar = id => () => { const b = $(id); if (b && !b.hidden) b.click(); };
    function abrirPainel(filtro) {
        if (!window.SKLPainel) return;
        window.SKLPainel.abrir();
        if (filtro) setTimeout(() => { const b = document.querySelector(`[data-pg-filtro="${filtro}"], [data-filtro="${filtro}"]`); if (b) b.click(); }, 400);
    }

    // ------------------------------------------------------------------ o índice (o "banco de dados" da busca)
    // titulo, onde (caminho no menu), palavras (sinônimos e como as pessoas falam), passos, ir (ação), ver (quem vê), pop (tutorial em PDF)
    const T = [
        // ---- Imóveis
        { titulo: "Buscar imóveis", onde: "Imóveis", palavras: "procurar imovel casa apartamento terreno lote sala barracao filtro bairro valor quartos codigo disponivel venda aluguel urbano rural todos",
          passos: [ "Abra Imóveis.", "Escolha Aluguel, Venda ou Todos e Urbanos, Rurais ou Todos.", "Use a busca por nome, código ou endereço, os bairros e a faixa de valor." ],
          ir: () => irPagina("construcoes") },
        { titulo: "Cadastrar um imóvel novo", onde: "Imóveis → Novo imóvel", palavras: "novo imovel cadastrar imovel incluir adicionar anuncio captacao captar casa",
          passos: [ "Toque em Novo imóvel.", "Digite o CEP: a rua, o bairro, a cidade e a UF se preenchem sozinhos.", "Preencha valor, características e fotos e toque em Salvar." ],
          ir: async () => { await irPagina("construcoes"); clicar("newConstrucaoButton")(); }, ver: () => !!$("newConstrucaoButton") && !$("newConstrucaoButton").hidden },
        { titulo: "Preencher o endereço pelo CEP", onde: "Imóvel ou cliente → Endereço → CEP", palavras: "cep endereco rua bairro cidade uf preencher automatico correios logradouro",
          passos: [ "No cadastro do imóvel (ou do cliente, em Endereço), digite os 8 números do CEP.", "Rua, bairro, cidade e UF aparecem sozinhos; complete o número.", "Se o campo já tinha outro valor, ele é mantido: toque em “Usar o endereço do CEP” para trocar." ],
          ir: async () => { await irPagina("construcoes"); clicar("newConstrucaoButton")(); } },
        { titulo: "Marcar a localização do imóvel (link do Google Maps)", onde: "Imóvel → Coordenada e mapa", palavras: "localizacao mapa coordenada latitude longitude google maps link ponto marcador gps endereco no mapa",
          passos: [ "Abra o imóvel e a seção Coordenada e mapa.", "Cole o link do Google Maps (o do botão Compartilhar serve) ou digite a latitude e a longitude.", "Confira o ponto no mapa; dá para arrastar o marcador." ], pop: "Como marcar a localização do imóvel" },
        { titulo: "Valor “a partir de”", onde: "Imóvel → Valor de venda / aluguel", palavras: "valor a partir de preco variavel empreendimento unidades varia minimo",
          passos: [ "No cadastro do imóvel, preencha o valor mais baixo.", "Marque “Valor a partir de”.", "O app, a página do imóvel e a mensagem ao cliente mostram “a partir de R$ …”." ] },
        { titulo: "Enviar imóvel ao cliente (WhatsApp)", onde: "Imóvel → Enviar ao cliente", palavras: "enviar imovel cliente whatsapp mandar compartilhar link fotos mensagem contato agenda telefone",
          passos: [ "Abra o imóvel e toque em Enviar ao cliente.", "Digite o celular, busque na agenda ou num cliente cadastrado, ou deixe em branco para escolher no WhatsApp.", "No celular, “Enviar com as fotos” manda as fotos junto com o texto." ] },
        { titulo: "Baixar as fotos do imóvel", onde: "Imóvel → Baixar todas as fotos", palavras: "baixar foto download salvar imagem galeria fotos do imovel",
          passos: [ "Abra o imóvel.", "Toque em “Baixar todas as fotos” (ou abra uma foto e toque em Baixar)." ], pop: "POP-GI-24" },
        { titulo: "Aprovar cadastros de imóveis dos corretores", onde: "Cadastros", palavras: "aprovar cadastro imovel corretor pendente recusar revisar aprovacao",
          passos: [ "Abra Cadastros.", "Abra o imóvel aguardando aprovação, confira e toque em Aprovar ou Recusar (com o motivo)." ],
          ir: () => irPagina("cadastros"), ver: () => pode("aprovar_cadastros") },
        { titulo: "Meus cadastros de imóveis", onde: "Conta → Meus cadastros", palavras: "meus cadastros rascunho enviar para aprovacao recusado corrigir",
          passos: [ "Abra Meus cadastros.", "Complete o rascunho e toque em Enviar; se foi recusado, veja o motivo e corrija." ],
          ir: () => irPagina("cadastros") },
        { titulo: "Chaves do imóvel", onde: "Imóvel → Chaves", palavras: "chave retirar devolver entregar chaves com quem esta",
          passos: [ "Abra o imóvel e vá até Chaves.", "Retire, entregue a um colega (ele aceita no app) ou devolva." ] },
        { titulo: "Ver imóveis no mapa", onde: "Imóveis → Ver no mapa", palavras: "mapa imoveis no mapa ver mapa pontos localizacao bolinhas",
          passos: [ "Abra Imóveis e toque em Ver no mapa." ], ir: async () => { await irPagina("construcoes"); clicar("toggleConstrucaoViewButton")(); } },

        // ---- Clientes e negócios
        { titulo: "Cadastrar cliente ou proprietário", onde: "Clientes → Novo cliente", palavras: "novo cliente cadastrar cliente comprador inquilino proprietario lead pessoa contato",
          passos: [ "Abra Clientes e toque em Novo cliente.", "Nome e celular; marque comprador, inquilino ou proprietário.", "Endereço (opcional): digite o CEP." ],
          ir: async () => { await irPagina("clientes"); if (window.SKLCRM) window.SKLCRM.abrirCliente(null); }, pop: "POP-GI-21" },
        { titulo: "Deixar um cliente visível para toda a equipe", onde: "Cliente → Toda a equipe pode ver", palavras: "cliente equipe compartilhar ver todos corretores visivel",
          passos: [ "Abra o cliente.", "Marque “Toda a equipe pode ver este cliente” e salve." ], ir: () => irPagina("clientes"), pop: "POP-GI-22" },
        { titulo: "Negócios (funil de venda, locação e captação)", onde: "Negócios", palavras: "negocio negociacao funil kanban quadro etapa venda locacao captacao lead proposta precificacao fechado perdido",
          passos: [ "Abra Negócios.", "Escolha Todos, Venda, Locação ou Captação.", "Arraste o cartão para mudar a etapa; toque para abrir." ], ir: () => irPagina("negociacoes") },
        { titulo: "Nova negociação", onde: "Negócios → + Negociação", palavras: "nova negociacao abrir negocio criar oportunidade atendimento",
          passos: [ "Abra o cliente e toque em + Negociação, ou use o botão em Negócios.", "Escolha o funil, o imóvel de interesse e a próxima ação." ], ir: () => irPagina("negociacoes") },
        { titulo: "Proposta de negócios (estudo de valor e exclusividade)", onde: "Propostas", palavras: "proposta estudo de mercado avaliacao precificacao valor imovel exclusividade amostras pdf",
          passos: [ "Abra Propostas e toque em Nova proposta.", "Escolha o imóvel avaliado e as amostras.", "Ajuste os valores e gere o PDF." ],
          ir: () => irPagina("propostas"), ver: () => funcao("propostas") && pode("tela_propostas") },
        { titulo: "Interesses registrados", onde: "Interesses", palavras: "interesse interessados pedido cliente quer alugar comprar",
          passos: [ "Abra Interesses e atualize a situação de cada pedido." ], ir: () => irPagina("interesses") },

        // ---- Agenda
        { titulo: "Agenda (compromissos e visitas)", onde: "Agenda", palavras: "agenda compromisso visita lembrete horario tarefa proxima acao calendario hoje",
          passos: [ "Abra Agenda.", "Toque em + Novo compromisso ou registre o retorno de uma visita." ], ir: () => irPagina("agenda") },
        { titulo: "Agenda no celular (Google Agenda / iPhone)", onde: "Agenda → Agenda no celular", palavras: "agenda celular google agenda calendario iphone assinar sincronizar",
          passos: [ "Abra Agenda e toque em Agenda no celular.", "Gere o link e escolha Google ou iPhone." ], ir: () => irPagina("agenda"), ver: () => funcao("agenda_celular"), pop: "POP-GI-02" },
        { titulo: "Avisos no celular (notificações)", onde: "🔔 → Ativar avisos neste aparelho", palavras: "aviso notificacao alerta som celular push sino",
          passos: [ "Toque no sino 🔔 no topo.", "Toque em “Ativar avisos neste aparelho” e permita.", "Escolha com quanta antecedência quer ser avisado." ] },

        // ---- Painel e indicadores
        { titulo: "Painel de vendas e locações (VGV, negócios fechados)", onde: "📊 Painel", palavras: "painel vendas vgv vgc dashboard resultado trimestre mes ano negocios fechados graficos metas faturamento",
          passos: [ "Toque em 📊 Painel.", "Escolha o ano, o trimestre ou o mês no topo.", "Use Vendas ou Locação no menu do painel." ], ir: () => abrirPainel(), ver: () => pode("tela_painel") && !!window.SKLPainel },
        { titulo: "Mercado: faixa de valor e bairro que mais saem", onde: "📊 Painel → Mercado", palavras: "mercado faixa de valor bairro procurado fechados captacao direcionar tipos cidades",
          passos: [ "Abra o Painel e toque em Mercado.", "Escolha Fechados ou Procurados e Locação ou Venda." ], ir: () => abrirPainel("mercado"), ver: () => pode("tela_painel") && !!window.SKLPainel, pop: "POP-GI-20" },
        { titulo: "Indicadores (relatório e PDF)", onde: "Indicadores", palavras: "indicadores relatorio conversao funil corretor ranking imprimir pdf csv",
          passos: [ "Abra Indicadores.", "Escolha o período e o corretor.", "Toque em Imprimir / PDF." ], ir: () => irPagina("indicadores") },

        // ---- Financeiro
        { titulo: "Contratos (locação e compra e venda)", onde: "Financeiro → Contratos", palavras: "contrato novo contrato locacao aluguel compra e venda venda lancar contrato inquilino comprador",
          passos: [ "Abra Financeiro → Contratos e toque em + Novo contrato.", "Escolha Locação ou Compra e venda, o imóvel e as partes.", "Preencha a comissão e salve." ],
          ir: () => irFin("contratos"), ver: verFin },
        { titulo: "Pagamento dos corretores (repasse da comissão)", onde: "Financeiro → Contratos → Comissão → ✓ Paguei", palavras: "pagamento corretores pagar corretor repasse comissao corretor recebeu paguei marcar paga parceiro",
          passos: [ "Abra o contrato em Financeiro → Contratos.", "Na faixa Comissão, em “Repasses lançados”, toque em ✓ Paguei na linha do corretor.", "Também dá em Comissões → Marcar paga." ],
          ir: () => irFin("contratos"), ver: gerirFin, pop: "POP-GI-23" },
        { titulo: "Comissões (a pagar, previstas e pagas)", onde: "Comissões", palavras: "comissoes comissao corretor a pagar pagas previstas aprovar marcar paga minhas comissoes",
          passos: [ "Abra Comissões.", "Filtre por corretor e situação.", "Aprove ou marque como paga." ], ir: () => irPagina("comissoes") },
        { titulo: "Comissões a receber (da imobiliária)", onde: "Financeiro → Comissões a receber", palavras: "comissao a receber imobiliaria recebi recebimento parcela honorarios",
          passos: [ "Abra Financeiro → Comissões a receber.", "Toque em ✓ Recebi quando o dinheiro entrar." ], ir: () => irFin("receber"), ver: verFin },
        { titulo: "Cobranças de aluguel", onde: "Financeiro → Cobranças", palavras: "cobranca boleto aluguel receber inquilino atraso multa juros recibo",
          passos: [ "Abra Financeiro → Cobranças.", "Toque em Receber para dar baixa (multa e juros são calculados)." ], ir: () => irFin("cobrancas"), ver: () => verFin() && funcao("administracao") },
        { titulo: "Repasses ao proprietário", onde: "Financeiro → Repasses", palavras: "repasse proprietario demonstrativo repassado taxa de administracao",
          passos: [ "Abra Financeiro → Repasses e marque como repassado." ], ir: () => irFin("repasses"), ver: () => verFin() && funcao("repasses") },
        { titulo: "Despesas e receitas da imobiliária", onde: "Financeiro → Despesas e receitas", palavras: "despesa receita conta pagar plano de contas gasto fornecedor",
          passos: [ "Abra Financeiro → Despesas e receitas.", "Lance a despesa ou a receita e marque o pagamento." ], ir: () => irFin("despesas"), ver: verFin },
        { titulo: "Resultado (VGV, VGC, VLC)", onde: "Financeiro → Resultado", palavras: "resultado lucro vgv vgc vlc margem faturamento",
          passos: [ "Abra Financeiro → Resultado e escolha o período." ], ir: () => irFin("resultado"), ver: verFin },
        { titulo: "Contabilidade (relatório para o contador)", onde: "Financeiro → Contabilidade", palavras: "contabilidade contador relatorio caixa csv receitas despesas",
          passos: [ "Abra Financeiro → Contabilidade, escolha o período e baixe o CSV ou o PDF." ], ir: () => irFin("contabil"), ver: () => gerirFin() && funcao("contabil"), pop: "POP-GI-03" },
        { titulo: "Baixa pelo extrato do banco", onde: "Financeiro → Extrato do banco", palavras: "extrato banco ofx csv conciliacao baixa automatica pix",
          passos: [ "Abra Financeiro → Extrato do banco.", "Envie o arquivo OFX ou CSV do banco e confirme as baixas." ], ir: () => irFin("extrato"), ver: () => gerirFin() && funcao("extrato") },
        { titulo: "DIMOB (Receita Federal)", onde: "Financeiro → Fiscal · DIMOB", palavras: "dimob receita federal fiscal declaracao imposto",
          passos: [ "Abra Financeiro → Fiscal · DIMOB.", "Resolva as pendências e gere o arquivo para o contador." ], ir: () => irFin("fiscal"), ver: gerirFin },

        // ---- Equipe e configurações
        { titulo: "Equipe: criar acesso de corretor", onde: "Equipe → Criar acesso", palavras: "equipe corretor novo corretor criar acesso usuario login senha cadastrar corretor convite",
          passos: [ "Abra Equipe e toque em Criar acesso.", "Nome, e-mail, celular, tipo de acesso e senha inicial." ], ir: () => irPagina("corretores"), ver: () => pode("tela_equipe") },
        { titulo: "Regras de comissão", onde: "Configurações → Comissões", palavras: "regra de comissao percentual corretor captador modelo simulador",
          passos: [ "Abra Configurações → Comissões.", "Escolha um modelo pronto ou monte a regra e teste no simulador." ], ir: () => irConfig("comissoes", "comRegrasPanel"), ver: () => pode("configurar") },
        { titulo: "O que cada tipo de acesso pode fazer (permissões)", onde: "Configurações → Imobiliária e acessos", palavras: "permissao acesso perfil corretor gestor central financeiro liberar bloquear",
          passos: [ "Abra Configurações → Imobiliária e acessos.", "Marque o que cada tipo de acesso pode fazer." ], ir: () => irConfig("imobiliaria", "permissoesPanel"), ver: () => pode("configurar") },
        { titulo: "Funções da imobiliária (ligar e desligar)", onde: "Configurações → Imobiliária e acessos → Funções", palavras: "funcoes ligar desligar administracao aprovacao proprietario portal manutencao travar tela",
          passos: [ "Abra Configurações → Imobiliária e acessos → Funções da imobiliária.", "Ligue ou desligue cada função." ], ir: () => irConfig("imobiliaria", "funcoesCarteiraPanel"), ver: () => pode("configurar") },
        { titulo: "Site e portais (ZAP, OLX, Canal Pro)", onde: "Configurações → Site, portal e PIX", palavras: "site portal zap olx viva real canal pro vitrine wordpress leads integracao publicar no site",
          passos: [ "Abra Configurações → Site, portal e PIX.", "Copie o link da vitrine ou a chave dos contatos." ], ir: () => irConfig("site", "integracoesPanel"), ver: () => pode("configurar"), pop: "POP-GI-04" },
        { titulo: "Modelos de contrato e documentos", onde: "Configurações → Documentos", palavras: "modelo de contrato documento pdf vistoria clausula",
          passos: [ "Abra Configurações → Documentos e edite o modelo." ], ir: () => irConfig("documentos", "docModelosPanel"), ver: () => pode("configurar") },
        { titulo: "Roleta de leads", onde: "Configurações → CRM", palavras: "roleta leads distribuir corretor automatico vez",
          passos: [ "Abra Configurações → CRM → Roleta e marque quem participa." ], ir: () => irConfig("crm", "crmRoletaPanel"), ver: () => pode("configurar") },

        // ---- Minha conta
        { titulo: "Trocar minha senha", onde: "Configurações → Minha conta", palavras: "senha trocar senha alterar senha esqueci",
          passos: [ "Abra Configurações → Minha conta e preencha a senha nova." ], ir: () => modoCorretor() ? irPagina("conta") : irConfig("conta", "passwordForm") },
        { titulo: "Minha foto e meu apelido", onde: "Conta", palavras: "foto perfil apelido meu nome assinatura",
          passos: [ "Abra a sua conta e toque na foto ou em Meu apelido." ], ir: () => modoCorretor() ? irPagina("conta") : irConfig("conta") },
        { titulo: "Menu no topo no celular", onde: "Configurações → Minha conta → Menu da tela", palavras: "menu topo celular gaveta tela",
          passos: [ "Abra Configurações → Minha conta → Menu da tela e escolha." ], ir: () => irConfig("conta", "aparenciaPanel"), pop: "POP-GI-17" }
    ];

    // ------------------------------------------------------------------ busca
    const indice = T.map(t => ({ t, texto: normal(`${t.titulo} ${t.onde} ${t.palavras}`), palavras: normal(`${t.titulo} ${t.onde} ${t.palavras}`).split(/[^a-z0-9]+/).filter(Boolean) }));
    const VAZIAS = new Set([ "de", "da", "do", "das", "dos", "a", "o", "e", "em", "no", "na", "para", "pra", "um", "uma", "como", "onde", "quero", "fazer", "ver" ]);
    function pontuar(item, termos, frase) {
        let total = 0, achados = 0;
        termos.forEach(q => {
            let melhor = 0;
            item.palavras.forEach(p => { if (p === q) melhor = Math.max(melhor, 3); else if (p.startsWith(q) || (q.length >= 5 && q.startsWith(p.slice(0, Math.max(4, p.length - 2))))) melhor = Math.max(melhor, 2); else if (q.length >= 4 && p.includes(q)) melhor = Math.max(melhor, 1); });
            if (melhor) achados++;
            total += melhor;
        });
        if (!achados || achados < Math.ceil(termos.length / 2)) return 0;
        if (frase.length > 4 && item.texto.includes(frase)) total += 4;
        if (normal(item.t.titulo).includes(frase)) total += 3;
        return total + achados;
    }
    function visivel(t) {
        if (t.ver && !t.ver()) return false;
        return true;
    }
    function buscarTarefas(q) {
        const frase = normal(q).trim();
        const termos = frase.split(/[^a-z0-9]+/).filter(x => x && !VAZIAS.has(x));
        if (!termos.length) return [];
        return indice.map(i => ({ t: i.t, s: pontuar(i, termos, frase) })).filter(x => x.s > 0 && visivel(x.t))
            .sort((a, b) => b.s - a.s).slice(0, 8).map(x => x.t);
    }
    function buscarDados(q) {
        const n = normal(q).trim(), dig = q.replace(/\D/g, "");
        if (n.length < 2) return [];
        const out = [];
        (ctx.imoveis ? ctx.imoveis() : []).forEach(c => {
            const txt = normal([ c.codigo, c.nome, c.bairro, c.edificio, c.logradouro ].filter(Boolean).join(" "));
            if ((c.codigo && (c.codigo === q.trim() || c.codigo.replace(/^0+/, "") === q.trim())) || (n.length >= 3 && txt.includes(n)))
                out.push({ tipo: "imovel", c, s: c.codigo && c.codigo.replace(/^0+/, "") === q.trim().replace(/^0+/, "") ? 9 : 3 });
        });
        const I = window.SKLCRM && window.SKLCRM.interno;
        if (I && n.length >= 3) [ ...I.clientes.values() ].forEach(c => {
            const txt = normal(`${c.nome} ${c.apelido || ""}`);
            if (txt.includes(n) || (dig.length >= 6 && String(c.telefone || "").replace(/\D/g, "").includes(dig))) out.push({ tipo: "cliente", c, s: 2 });
        });
        if (n.length >= 3 && paginaDisponivel("corretores")) (ctx.equipe ? ctx.equipe() : []).forEach(u => {
            if (normal(`${u.display_name || ""} ${u.apelido || ""}`).includes(n)) out.push({ tipo: "pessoa", c: u, s: 1 });
        });
        return out.sort((a, b) => b.s - a.s).slice(0, 8);
    }

    // ------------------------------------------------------------------ tela
    function montar() {
        if (montado) return;
        montado = true;
        document.body.insertAdjacentHTML("beforeend", `<dialog id="buscaSistemaDialog" class="busca-sistema"><div class="busca-sistema-card">
          <div class="busca-sistema-topo"><input id="buscaSistemaInput" type="search" placeholder="O que você quer fazer? Ex.: pagamento corretores, vendas, agenda, código do imóvel…" autocomplete="off" aria-label="Buscar no sistema" />
            <button type="button" id="buscaSistemaFechar" class="busca-sistema-x" aria-label="Fechar">×</button></div>
          <div id="buscaSistemaLista" class="busca-sistema-lista"></div>
        </div></dialog>`);
        const area = document.querySelector(".topbar .connection-area");
        if (area && !$("buscaSistemaBotao")) {
            area.insertAdjacentHTML("afterbegin", `<button id="buscaSistemaBotao" type="button" class="secondary-button busca-sistema-botao" title="Buscar no sistema (Ctrl+K)">🔎 Buscar</button>`);
            $("buscaSistemaBotao").addEventListener("click", abrir);
        }
        $("buscaSistemaFechar").addEventListener("click", () => $("buscaSistemaDialog").close());
        $("buscaSistemaDialog").addEventListener("click", e => { if (e.target === $("buscaSistemaDialog")) $("buscaSistemaDialog").close(); });
        let t = null;
        $("buscaSistemaInput").addEventListener("input", () => { clearTimeout(t); t = setTimeout(desenhar, 120); });
        $("buscaSistemaInput").addEventListener("keydown", e => {
            if (e.key === "Enter") { const b = $("buscaSistemaLista").querySelector("[data-ir]"); if (b) { e.preventDefault(); b.click(); } }
        });
        document.addEventListener("keydown", e => {
            const digitando = /INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || "") || (document.activeElement && document.activeElement.isContentEditable);
            if ((e.key === "k" || e.key === "K") && (e.ctrlKey || e.metaKey)) { e.preventDefault(); abrir(); }
            else if (e.key === "/" && !digitando && !document.querySelector("dialog[open]")) { e.preventDefault(); abrir(); }
        });
    }
    const SUGESTOES = [ "pagamento corretores", "vendas", "novo contrato", "agenda", "cadastrar imóvel", "comissões", "enviar imóvel ao cliente", "localização" ];
    function abrir() {
        montar();
        const d = $("buscaSistemaDialog");
        if (!d.open) d.showModal();
        $("buscaSistemaInput").value = "";
        desenhar();
        if (!(window.matchMedia && matchMedia("(pointer: coarse)").matches)) $("buscaSistemaInput").focus();
    }
    function desenhar() {
        const q = $("buscaSistemaInput").value;
        const lista = $("buscaSistemaLista");
        const acoes = [];
        if (!q.trim()) {
            lista.innerHTML = `<p class="busca-sistema-dica">Escreva o que quer fazer, do seu jeito. Também acha imóveis (código, nome, bairro), clientes e pessoas da equipe.</p>
              <div class="busca-sistema-sug">${SUGESTOES.map(s => `<button type="button" data-sug="${h(s)}">${h(s)}</button>`).join("")}</div>`;
            lista.querySelectorAll("[data-sug]").forEach(b => b.addEventListener("click", () => { $("buscaSistemaInput").value = b.dataset.sug; desenhar(); }));
            return;
        }
        const tarefas = buscarTarefas(q), dados = buscarDados(q);
        let html = "";
        if (dados.length) {
            html += `<span class="busca-sistema-grupo">Encontrados</span>` + dados.map((d, i) => {
                acoes.push(() => abrirDado(d));
                const sub = d.tipo === "imovel" ? [ "Imóvel", d.c.codigo ? "cód. " + d.c.codigo : "", d.c.bairro ].filter(Boolean).join(" · ")
                    : d.tipo === "cliente" ? [ "Cliente", d.c.telefone ].filter(Boolean).join(" · ") : "Equipe";
                const nome = d.tipo === "pessoa" ? d.c.display_name : d.c.nome;
                return `<button type="button" class="busca-sistema-dado" data-ir="${acoes.length - 1}"><strong>${d.tipo === "imovel" ? "🏠" : d.tipo === "cliente" ? "👤" : "🧑‍💼"} ${h(nome)}</strong><small>${h(sub)}</small></button>`;
            }).join("");
        }
        if (tarefas.length) {
            html += `<span class="busca-sistema-grupo">Onde fazer</span>` + tarefas.map((t, i) => {
                const temIr = !!t.ir;
                if (temIr) acoes.push(async () => { $("buscaSistemaDialog").close(); try { await t.ir(); } catch (e) { /* tela indisponível */ } });
                return `<div class="busca-sistema-item"><div class="busca-sistema-cab"><div><strong>${h(t.titulo)}</strong><small>📍 ${h(t.onde)}</small></div>
                    ${temIr ? `<button type="button" class="primary-button fin-mini" data-ir="${acoes.length - 1}">Ir ›</button>` : ""}</div>
                  <details${i === 0 ? " open" : ""}><summary>Como fazer</summary><ol>${t.passos.map(p => `<li>${h(p)}</li>`).join("")}</ol>
                    ${t.pop ? `<p class="busca-sistema-pop">Passo a passo completo com imagens: ${h(t.pop)} (pasta Uso do sistema).</p>` : ""}</details></div>`;
            }).join("");
        }
        if (!html) html = `<p class="busca-sistema-dica">Nada encontrado para “${h(q)}”. Tente outras palavras, por exemplo: contrato, comissão, agenda, imóvel, cliente.</p>`;
        lista.innerHTML = html;
        lista.querySelectorAll("[data-ir]").forEach(b => b.addEventListener("click", () => { const f = acoes[Number(b.dataset.ir)]; if (f) f(); }));
    }
    async function abrirDado(d) {
        $("buscaSistemaDialog").close();
        if (d.tipo === "imovel") { if (paginaDisponivel("construcoes")) await irPagina("construcoes"); if (ctx.abrirImovel) ctx.abrirImovel(d.c.id); }
        else if (d.tipo === "cliente") { await irPagina("clientes"); if (window.SKLCRM) window.SKLCRM.abrirCliente(d.c.id); }
        else await irPagina("corretores");
    }

    function iniciar(c) {
        ctx = c;
        montar();
    }
    window.SKLBusca = { iniciar, abrir, buscarTarefas: q => buscarTarefas(q).map(t => t.titulo) };
})();
