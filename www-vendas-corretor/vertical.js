(() => {
    "use strict";
    const $ = id => document.getElementById(id);
    const STATUS_LABEL = {
        disponivel: "Disponível",
        reservado: "Reservado",
        vendido: "Vendido",
        bloqueado: "Bloqueado",
        nao_informado: "Não informado"
    };
    let sbClient = null;
    let empreendimento = null;
    let torres = [];
    let unidades = [];
    let tiposPorId = new Map;
    let acabamentosPorId = new Map;
    let unidadeSelecionada = null;
    let unidadesChannel = null;
    let filtrosLigados = false;
    let galeriaFotos = [];
    let galeriaIndice = 0;
    const DESTAQUE_ICONS = {
        grill: "🔥",
        kitchen: "🍽️"
    };
    const FAVORITOS_KEY = "sklu_unit_favoritos";
    function favoritosSalvos() {
        try {
            return new Set(JSON.parse(localStorage.getItem(FAVORITOS_KEY) || "[]"));
        } catch {
            return new Set;
        }
    }
    function alternarFavorito(unidadeId) {
        const favoritos = favoritosSalvos();
        if (favoritos.has(unidadeId)) favoritos.delete(unidadeId); else favoritos.add(unidadeId);
        try {
            localStorage.setItem(FAVORITOS_KEY, JSON.stringify([ ...favoritos ]));
        } catch {}
        return favoritos.has(unidadeId);
    }
    function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, c => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#039;"
        }[c]));
    }
    function formatMoney(value) {
        if (value == null) return "R$ —";
        return Number(value).toLocaleString("pt-BR", {
            style: "currency",
            currency: "BRL",
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        });
    }
    function formatArea(value) {
        return value == null ? "— m²" : `${Number(value).toLocaleString("pt-BR", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        })} m²`;
    }
    async function carregarDados() {
        const [{data: torresData}, {data: tiposData}, {data: acabData}, {data: unidadesData}] = await Promise.all([ sbClient.from("torres").select("id, nome, ordem").eq("empreendimento_id", empreendimento.id).order("ordem"), sbClient.from("tipos_planta").select("*").eq("empreendimento_id", empreendimento.id), sbClient.from("acabamentos").select("*").eq("empreendimento_id", empreendimento.id), sbClient.from("unidades").select("*").eq("empreendimento_id", empreendimento.id) ]);
        torres = torresData || [];
        tiposPorId = new Map((tiposData || []).map(t => [ t.id, t ]));
        acabamentosPorId = new Map((acabData || []).map(a => [ a.id, a ]));
        unidades = (unidadesData || []).sort((a, b) => a.andar - b.andar || String(a.numero).localeCompare(String(b.numero)));
    }
    function andaresDisponiveis() {
        return [ ...new Set(unidades.map(u => u.andar)) ].sort((a, b) => a - b);
    }
    function tipoLabel(tipo) {
        if (!tipo) return "";
        return tipo.codigo === "COB" ? "Cobertura" : tipo.nome;
    }
    function popularFiltros() {
        const andares = andaresDisponiveis();
        const floorSelect = $("vtFloorFilter");
        const valorAndarAtual = floorSelect.value;
        floorSelect.innerHTML = '<option value="">Todos</option>' + andares.map(andar => `<option value="${andar}">${andar}º andar</option>`).join("");
        if (andares.some(a => String(a) === valorAndarAtual)) floorSelect.value = valorAndarAtual;
        const tipos = [ ...tiposPorId.values() ].sort((a, b) => tipoLabel(a).localeCompare(tipoLabel(b)));
        const tipoSelect = $("vtTipoFilter");
        const valorTipoAtual = tipoSelect.value;
        tipoSelect.innerHTML = '<option value="">Todos</option>' + tipos.map(t => `<option value="${t.id}">${escapeHtml(tipoLabel(t))}</option>`).join("");
        if (tipos.some(t => t.id === valorTipoAtual)) tipoSelect.value = valorTipoAtual;
        if (!filtrosLigados) {
            filtrosLigados = true;
            [ "vtFloorFilter", "vtStatusFilter", "vtTipoFilter" ].forEach(id => {
                $(id).addEventListener("change", renderBuildingMap);
            });
        }
    }
    function renderBuildingMap() {
        const andarFiltro = $("vtFloorFilter").value;
        const statusFiltro = $("vtStatusFilter").value;
        const tipoFiltro = $("vtTipoFilter").value;
        const filtradas = unidades.filter(u => {
            if (andarFiltro && String(u.andar) !== andarFiltro) return false;
            if (statusFiltro && u.status !== statusFiltro) return false;
            if (tipoFiltro && u.tipo_planta_id !== tipoFiltro) return false;
            return true;
        });
        const container = $("vtBuildingMap");
        if (!filtradas.length) {
            container.innerHTML = '<div class="vt-empty">Nenhuma unidade encontrada com esses filtros.</div>';
            return;
        }
        const andares = [ ...new Set(filtradas.map(u => u.andar)) ].sort((a, b) => b - a);
        container.innerHTML = andares.map(andar => {
            const doAndar = filtradas.filter(u => u.andar === andar).sort((a, b) => String(a.numero).localeCompare(String(b.numero)));
            const badges = doAndar.map(u => {
                const tipo = tiposPorId.get(u.tipo_planta_id);
                return `<button class="vt-unit-badge status-${u.status}" type="button" data-unidade="${u.id}" title="${escapeHtml(tipoLabel(tipo))}">${escapeHtml(u.numero)}</button>`;
            }).join("");
            return `<div class="vt-floor-row"><span class="vt-floor-label">${andar}º</span><div class="vt-floor-units">${badges}</div></div>`;
        }).join("");
        container.querySelectorAll("[data-unidade]").forEach(btn => {
            btn.addEventListener("click", () => openUnitDialog(btn.dataset.unidade));
        });
    }
    function nomeSemPrefixoResidencial(nome) {
        return String(nome || "").replace(/^residencial\s+/i, "").trim();
    }
    function renderGaleria() {
        if (!galeriaFotos.length) return;
        $("unitGalleryMainImage").src = galeriaFotos[galeriaIndice].src;
        $("unitGalleryMainImage").alt = galeriaFotos[galeriaIndice].legenda;
        $("unitGalleryCounter").textContent = `${galeriaIndice + 1}/${galeriaFotos.length}`;
        $("unitGalleryThumbs").querySelectorAll("img").forEach((img, i) => img.classList.toggle("active", i === galeriaIndice));
    }
    function openUnitDialog(unidadeId) {
        const u = unidades.find(item => item.id === unidadeId);
        if (!u) return;
        unidadeSelecionada = u;
        const torre = torres.find(t => t.id === u.torre_id);
        const tipo = tiposPorId.get(u.tipo_planta_id);
        const acabamento = acabamentosPorId.get(u.acabamento_id);
        const cfg = empreendimento.config || {};
        const nomeCurto = nomeSemPrefixoResidencial(empreendimento.nome);
        $("unitHeroPhoto").style.backgroundImage = `linear-gradient(180deg, rgba(7,31,50,.38) 0%, rgba(7,31,50,.12) 38%, rgba(7,31,50,.88) 100%), url("aurora/hero.jpg")`;
        $("unitHeroBullets").innerHTML = (cfg.hero_bullets || []).map(b => `<span>${escapeHtml(b)}</span>`).join("");
        $("unitEyebrow").textContent = nomeCurto.toUpperCase();
        $("unitHeroTagline").textContent = cfg.hero_tagline || "";
        $("unitHeroTagline").hidden = !cfg.hero_tagline;
        $("unitTitle").textContent = `Apto ${u.numero}`;
        $("unitTipoNome").textContent = `${empreendimento.nome}${torre ? ` · ${torre.nome}` : ""} · ${u.andar}º andar`;
        $("unitStatusBadge").className = `status-badge-lg status-${u.status}`;
        $("unitStatusBadge").textContent = STATUS_LABEL[u.status] || u.status;
        $("unitValor").textContent = formatMoney(u.valor);
        $("unitCidade").textContent = cfg.cidade || "—";
        $("unitCidadeDescricao").textContent = cfg.cidade_descricao || "";
        const favoritoAtivo = favoritosSalvos().has(u.id);
        $("unitFavoriteButton").textContent = favoritoAtivo ? "♥" : "♡";
        $("unitFavoriteButton").classList.toggle("active", favoritoAtivo);
        $("unitFavoriteButton").onclick = () => {
            const ativo = alternarFavorito(u.id);
            $("unitFavoriteButton").textContent = ativo ? "♥" : "♡";
            $("unitFavoriteButton").classList.toggle("active", ativo);
        };
        const compartilhar = async () => {
            const texto = `Apto ${u.numero} — ${empreendimento.nome}\n${formatArea(u.area_privativa_m2)} · ${u.quartos ?? "—"} quartos · ${formatMoney(u.valor)}`;
            try {
                if (navigator.share) await navigator.share({
                    title: `Apto ${u.numero}`,
                    text: texto
                }); else {
                    await navigator.clipboard.writeText(texto);
                    window.SKLApp?.showToast?.("Informações copiadas.");
                }
            } catch {}
        };
        $("unitShareButton").onclick = compartilhar;
        $("unitShareButton2").onclick = compartilhar;
        const tipoLabel = tipo ? tipo.codigo === "COB" ? "Cobertura" : tipo.nome : "";
        const destaques = (tipo?.destaques || []).slice(0, 2);
        const specs = [ {
            icone: "📐",
            titulo: formatArea(u.area_privativa_m2),
            sub: "Área privativa"
        }, {
            icone: "🛏️",
            titulo: `${u.quartos ?? "—"} quarto${u.quartos === 1 ? "" : "s"}${u.suites ? ` (${u.suites} suíte${u.suites > 1 ? "s" : ""})` : ""}`,
            sub: tipoLabel || null
        }, {
            icone: "🚿",
            titulo: `${u.banheiros ?? "—"} banheiro${u.banheiros === 1 ? "" : "s"}`,
            sub: null
        }, {
            icone: "🚗",
            titulo: `${u.vagas ?? "—"} vaga${u.vagas === 1 ? "" : "s"}`,
            sub: "de garagem"
        }, ...destaques.map(d => ({
            icone: DESTAQUE_ICONS[d.icone] || "✦",
            titulo: d.titulo,
            sub: d.subtitulo
        })) ];
        let specsHtml = specs.map(s => `<div class="unit-spec-item"><span class="unit-spec-icon">${s.icone}</span><div><strong>${escapeHtml(s.titulo)}</strong>${s.sub ? `<small>${escapeHtml(s.sub)}</small>` : ""}</div></div>`).join("");
        if (u.orientacao) {
            specsHtml += `<div class="unit-spec-item unit-spec-full"><span class="unit-spec-icon">☀️</span><div><strong>Posição solar: ${escapeHtml(u.orientacao)}</strong><small>Mais luz natural todos os dias</small></div></div>`;
        }
        $("unitSpecsCard").innerHTML = specsHtml;
        const plantFrame = $("unitPlantFrame");
        const plantSrc = u.planta_arquivo ? `aurora/${u.planta_arquivo}` : "";
        $("unitPlantImage").src = plantSrc;
        plantFrame.closest(".unit-plant-block").hidden = !plantSrc;
        const abrirPlanta = () => {
            if (!plantSrc) return;
            $("unitPlantLightboxImage").src = plantSrc;
            $("unitPlantLightbox").showModal();
        };
        $("unitPlantExpandButton").onclick = abrirPlanta;
        $("unitPlantExpandButton2").onclick = abrirPlanta;
        $("unitVagasIds").textContent = u.vagas_ids && u.vagas_ids.length ? u.vagas_ids.join(", ") : "—";
        $("unitDescricao").textContent = u.descricao_comercial || "";
        galeriaFotos = [ {
            src: "aurora/amenity_piscina.jpg",
            legenda: "Piscina"
        }, {
            src: "aurora/amenity_espaco_gourmet.jpg",
            legenda: "Espaço gourmet"
        }, {
            src: "aurora/amenity_academia.jpg",
            legenda: "Academia"
        }, {
            src: "aurora/amenity_playground.jpg",
            legenda: "Playground"
        }, {
            src: "aurora/amenity_areas_convivencia.jpg",
            legenda: "Áreas de convivência"
        } ];
        galeriaIndice = 0;
        $("unitGalleryLabel").textContent = "Áreas comuns";
        $("unitGalleryThumbs").innerHTML = galeriaFotos.map((f, i) => `<img src="${f.src}" alt="${escapeHtml(f.legenda)}" data-i="${i}" />`).join("");
        $("unitGalleryThumbs").querySelectorAll("img").forEach(img => img.addEventListener("click", () => {
            galeriaIndice = Number(img.dataset.i);
            renderGaleria();
        }));
        renderGaleria();
        const acabSection = $("unitAcabamentoSection");
        if (acabamento) {
            $("unitAcabamentoNome").textContent = `Acabamento — ${acabamento.nome}`;
            const acabSpecs = acabamento.especificacoes || {};
            $("unitAcabamentoList").innerHTML = Object.entries(acabSpecs).filter(([key]) => key !== "observacao").map(([key, value]) => `<div class="acabamento-item"><b>${escapeHtml(key.replace(/_/g, " "))}</b><span>${escapeHtml(value)}</span></div>`).join("");
            acabSection.hidden = false;
        } else {
            acabSection.hidden = true;
        }
        $("unitFooterTag").textContent = cfg.footer_tag || "";
        $("unitRequestButton").hidden = ![ "disponivel" ].includes(u.status);
        $("unitDialog").showModal();
        window.SKLReserva?.atualizar?.();
    }
    function openRealtime() {
        if (unidadesChannel) sbClient.removeChannel(unidadesChannel);
        unidadesChannel = sbClient.channel("corretor-unidades").on("postgres_changes", {
            event: "UPDATE",
            schema: "public",
            table: "unidades",
            filter: `empreendimento_id=eq.${empreendimento.id}`
        }, payload => {
            const idx = unidades.findIndex(u => u.id === payload.new.id);
            if (idx >= 0) unidades[idx] = {
                ...unidades[idx],
                ...payload.new
            };
            renderBuildingMap();
        }).subscribe();
    }
    function closeRealtime() {
        if (unidadesChannel) sbClient.removeChannel(unidadesChannel);
        unidadesChannel = null;
    }
    async function enter(sb, emp) {
        sbClient = sb;
        empreendimento = emp;
        unidadeSelecionada = null;
        $("vtEmpreendimentoNome").textContent = emp.nome;
        $("vtHero").style.backgroundImage = `linear-gradient(180deg, rgba(7,31,50,.25), rgba(7,31,50,.72)), url("aurora/hero.jpg")`;
        await carregarDados();
        $("vtMapSub").textContent = torres.length ? `${torres[0].nome} · Selecione uma unidade` : "Selecione uma unidade";
        popularFiltros();
        renderBuildingMap();
        openRealtime();
        document.getElementById("authView").hidden = true;
        document.getElementById("verticalApp").hidden = false;
    }
    function leave() {
        closeRealtime();
        document.getElementById("verticalApp").hidden = true;
    }
    window.SKLVertical = {
        enter: enter,
        leave: leave,
        getSelectedUnit: () => unidadeSelecionada,
        getEmpreendimento: () => empreendimento
    };
})();