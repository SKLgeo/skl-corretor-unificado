(() => {
    "use strict";
    const lots = window.SKL_DEMO_LOTES;
    const statusConfig = window.SKL_STATUS_CONFIG || {
        source_url: "",
        statuses: {}
    };
    const $ = id => document.getElementById(id);
    const elements = {
        quadra: $("quadraSelect"),
        lote: $("loteSelect"),
        form: $("lotSearchForm"),
        searchCard: $("searchCard"),
        searchToggle: $("searchToggleButton"),
        lotCard: $("lotCard"),
        lotTitle: $("lotTitle"),
        lotArea: $("lotArea"),
        lotPerimeter: $("lotPerimeter"),
        lotFrontage: $("lotFrontage"),
        lotAccess: $("lotAccess"),
        lotCoordinates: $("lotCoordinates"),
        distanceRow: $("distanceRow"),
        lotDistance: $("lotDistance"),
        googleMaps: $("googleMapsButton"),
        waze: $("wazeButton"),
        statusBadge: $("statusBadge"),
        commercialInfo: $("commercialInfo"),
        favorite: $("favoriteButton"),
        memorial: $("memorialButton"),
        details: $("detailsButton"),
        technicalReview: $("technicalReviewButton"),
        shareCard: $("shareCardButton"),
        savedDialog: $("savedDialog"),
        favoritesList: $("favoritesList"),
        historyList: $("historyList"),
        detailsDialog: $("detailsDialog"),
        detailsTitle: $("detailsTitle"),
        dimensionsList: $("dimensionsList"),
        reviewSection: $("reviewSection"),
        reviewList: $("reviewList"),
        commercialDialog: $("commercialDialog"),
        adminLotTitle: $("adminLotTitle"),
        adminStatus: $("adminStatusSelect"),
        adminValue: $("adminValueInput"),
        adminNote: $("adminNoteInput"),
        saveLocalStatus: $("saveLocalStatusButton"),
        syncStatus: $("syncStatusButton"),
        syncStatusText: $("syncStatusText"),
        install: $("installButton"),
        installDialog: $("installDialog"),
        installInstructions: $("installInstructions"),
        toast: $("toast"),
        offline: $("offlineBanner"),
        gpsChip: $("gpsChip"),
        connectionBadge: $("connectionBadge"),
        mapa3dButton: $("mapa3dButton"),
        mapa3dOverlay: $("mapa3dOverlay"),
        mapa3dCloseButton: $("mapa3dCloseButton"),
        mapa3dContainer: $("mapa3dContainer"),
        mapa3dLoading: $("mapa3dLoading"),
        paymentInfoButton: $("paymentInfoButton"),
        paymentInfoOverlay: $("paymentInfoOverlay"),
        paymentInfoCloseButton: $("paymentInfoCloseButton"),
        paymentInfoContent: $("paymentInfoContent"),
        paymentInfoLoading: $("paymentInfoLoading")
    };
    let mapa3dInstance = null;
    let mapa3dDados = null;
    let formasPagamentoDados = null;
    const SERIE_TIPO_LABEL = { ato: "Ato", sinal: "Sinal", parcelas: "Parcelas", balao: "Balão", financiamento: "Financiamento", chaves: "Chaves", outro: "Outro" };
    const BANKING_TIPO_LABEL = { pix: "PIX", boleto: "Boleto", deposito: "Depósito/TED", outro: "Outro" };
    function formatMoneyBR(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return null;
        return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    }
    async function abrirFormasPagamento() {
        elements.paymentInfoOverlay.hidden = false;
        elements.paymentInfoLoading.hidden = false;
        elements.paymentInfoContent.innerHTML = "";
        if (!formasPagamentoDados) formasPagamentoDados = await window.SKLOnline.carregarFormasPagamento();
        elements.paymentInfoLoading.hidden = true;
        if (!formasPagamentoDados) {
            elements.paymentInfoOverlay.hidden = true;
            showToast("Formas de pagamento não disponíveis para este empreendimento.");
            return;
        }
        renderFormasPagamento(formasPagamentoDados);
    }
    function fecharFormasPagamento() {
        elements.paymentInfoOverlay.hidden = true;
    }
    function renderFormasPagamento(dados) {
        const parts = [];
        if (dados.planos.length) {
            parts.push('<h3 class="payment-section-title">Planos de pagamento</h3>');
            dados.planos.forEach(plano => {
                const series = (plano.planos_pagamento_series || []).map(serie => {
                    const label = SERIE_TIPO_LABEL[serie.tipo] || serie.tipo;
                    const detalhes = [];
                    if (serie.quantidade_parcelas) detalhes.push(`${serie.quantidade_parcelas}x`);
                    const valor = formatMoneyBR(serie.valor_total);
                    if (valor) detalhes.push(valor);
                    if (serie.indexador) detalhes.push(escapeHtml(serie.indexador));
                    if (serie.portador_cobranca) detalhes.push(escapeHtml(serie.portador_cobranca));
                    return `<li><strong>${escapeHtml(label)}</strong>${detalhes.length ? " · " + detalhes.join(" · ") : ""}${serie.observacao ? `<br><span class="payment-info-note">${escapeHtml(serie.observacao)}</span>` : ""}</li>`;
                }).join("");
                parts.push(`<article class="payment-plan-card"><h4>${escapeHtml(plano.nome)}</h4>${plano.descricao ? `<p>${escapeHtml(plano.descricao)}</p>` : ""}${series ? `<ul class="payment-series-list">${series}</ul>` : ""}</article>`);
            });
        }
        if (dados.bancos.length) {
            parts.push('<h3 class="payment-section-title">Dados bancários</h3>');
            dados.bancos.forEach(banco => {
                const label = BANKING_TIPO_LABEL[banco.tipo] || banco.tipo;
                const linhas = [];
                if (banco.tipo === "pix" && banco.chave_pix) linhas.push(`<strong>Chave PIX:</strong> ${escapeHtml(banco.chave_pix)}`);
                if (banco.banco_nome) linhas.push(`<strong>Banco:</strong> ${escapeHtml(banco.banco_nome)}`);
                if (banco.agencia) linhas.push(`<strong>Agência:</strong> ${escapeHtml(banco.agencia)}`);
                if (banco.conta) linhas.push(`<strong>Conta:</strong> ${escapeHtml(banco.conta)}`);
                if (banco.titular) linhas.push(`<strong>Titular:</strong> ${escapeHtml(banco.titular)}`);
                if (banco.documento_titular) linhas.push(`<strong>Documento:</strong> ${escapeHtml(banco.documento_titular)}`);
                if (banco.instrucoes) linhas.push(`<span class="payment-info-note">${escapeHtml(banco.instrucoes)}</span>`);
                parts.push(`<article class="banking-info-card"><span class="banking-info-badge">${escapeHtml(label)}</span><p>${linhas.join("<br>")}</p></article>`);
            });
        }
        elements.paymentInfoContent.innerHTML = parts.join("") || '<p class="payment-info-empty">Nenhuma informação cadastrada.</p>';
    }
    async function abrirMapa3D() {
        elements.mapa3dOverlay.hidden = false;
        elements.mapa3dLoading.hidden = false;
        if (!mapa3dDados) mapa3dDados = await window.SKLOnline.carregarMapa3D();
        if (!mapa3dDados) {
            elements.mapa3dOverlay.hidden = true;
            showToast("Planta 3D não disponível para este empreendimento.");
            return;
        }
        mapa3dInstance = window.SKLMapa3D.init(elements.mapa3dContainer, {
            imagemUrl: mapa3dDados.imagem_url,
            larguraPx: mapa3dDados.largura_px,
            alturaPx: mapa3dDados.altura_px,
            pontos: mapa3dDados.pontos,
            statusPorId: mapa3dDados.statusPorId,
            onSelecionar(loteId) {
                const info = mapa3dDados.quadraLotePorId.get(loteId);
                if (!info) return;
                fecharMapa3D();
                selectLot(info.quadra, info.lote, true);
            }
        });
        elements.mapa3dLoading.hidden = true;
    }
    function fecharMapa3D() {
        elements.mapa3dOverlay.hidden = true;
        if (mapa3dInstance) {
            mapa3dInstance.destruir();
            mapa3dInstance = null;
        }
    }
    if (!lots || !Array.isArray(lots.features)) {
        document.body.innerHTML = '<main class="fatal-error">Não foi possível carregar a base de lotes.</main>';
        return;
    }
    if (!window.L) {
        document.body.innerHTML = '<main class="fatal-error">O mapa não carregou. Verifique sua conexão e tente novamente.</main>';
        return;
    }
    const STORAGE = {
        favorites: "sklu_demo_favorites_v2",
        history: "sklu_demo_history_v2",
        localStatus: "sklu_demo_local_status_v2",
        remoteStatus: "sklu_demo_remote_status_v2"
    };
    const STATUS = {
        nao_informado: {
            label: "Situação não informada",
            color: "#0f6174",
            fill: "#0f6174"
        },
        disponivel: {
            label: "Disponível",
            color: "#287a4a",
            fill: "#35a861"
        },
        reservado: {
            label: "Reservado",
            color: "#95600d",
            fill: "#e0a521"
        },
        vendido: {
            label: "Vendido",
            color: "#8d3d35",
            fill: "#c65349"
        },
        bloqueado: {
            label: "Bloqueado",
            color: "#315d89",
            fill: "#4d83bd"
        }
    };
    const featuresByKey = new Map;
    const layersByKey = new Map;
    const quadras = new Map;
    let selectedFeature = null;
    let selectedLayer = null;
    let selectedKey = null;
    let accessMarker = null;
    let userPosition = null;
    let userMarker = null;
    let accuracyCircle = null;
    let activeBasemap = "satellite";
    let basemapAntesDoOffline = null;
    let falhasDeImagem = [];
    let gpsWatchId = null;
    let gpsSeguindo = false;
    let gpsPrimeiraPosicao = true;
    let guiaAteLote = null;
    let deferredInstallPrompt = null;
    let toastTimer = null;
    let favorites = new Set(readStoredArray(STORAGE.favorites));
    let recentHistory = readStoredArray(STORAGE.history).slice(0, 12);
    let localStatuses = {};
    let remoteState = readStoredObject(STORAGE.remoteStatus);
    let remoteStatuses = remoteState.records || statusConfig.statuses || {};
    let remoteUpdatedAt = remoteState.updatedAt || statusConfig.updated_at || null;
    const isNativeAndroid = new URLSearchParams(location.search).get("native") === "android" || Boolean(window.NativeBridge);
    const map = L.map("map", {
        zoomControl: false,
        minZoom: 14,
        maxZoom: 21,
        preferCanvas: true
    });
    const satelliteLayer = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
        minZoom: 0,
        maxZoom: 21,
        maxNativeZoom: 19,
        attribution: "Imagem © Esri e colaboradores"
    });
    const streetLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        minZoom: 0,
        maxZoom: 21,
        maxNativeZoom: 19,
        attribution: "© OpenStreetMap"
    });
    const BASEMAPS = {
        satellite: { camada: satelliteLayer, rotulo: "Imagem de satélite" },
        street: { camada: streetLayer, rotulo: "Mapa de ruas" },
        planta: { camada: null, rotulo: "Planta dos lotes (funciona sem internet)" }
    };
    satelliteLayer.addTo(map);
    // Sem internet (ou internet "presa" no campo) as imagens não carregam e o fundo fica cinza:
    // muitas falhas seguidas trocam sozinho para a planta (lotes sobre fundo claro).
    [ satelliteLayer, streetLayer ].forEach(camada => camada.on("tileerror", () => {
        const agora = Date.now();
        falhasDeImagem = falhasDeImagem.filter(t => agora - t < 1e4);
        falhasDeImagem.push(agora);
        if (falhasDeImagem.length >= 8 && activeBasemap !== "planta") {
            falhasDeImagem = [];
            basemapAntesDoOffline = basemapAntesDoOffline || activeBasemap;
            setBasemap("planta");
            showToast("Imagem do mapa indisponível sem internet — mostrando a planta dos lotes.");
        }
    }));
    const lotLayer = L.geoJSON(lots, {
        style: feature => styleForFeature(feature, false),
        onEachFeature(feature, layer) {
            const {quadra: quadra, lote: lote} = feature.properties;
            const key = lotKey(quadra, lote);
            featuresByKey.set(key, feature);
            layersByKey.set(key, layer);
            if (!quadras.has(quadra)) quadras.set(quadra, []);
            quadras.get(quadra).push(lote);
            updateLayerTooltip(feature, layer);
            layer.on("click", () => selectLot(quadra, lote, true));
        }
    }).addTo(map);
    const labelsLayer = L.layerGroup();
    lots.features.forEach(feature => {
        const {quadra: quadra, lote: lote, center: center} = feature.properties;
        labelsLayer.addLayer(L.marker([ center[1], center[0] ], {
            interactive: false,
            keyboard: false,
            icon: L.divIcon({
                className: "lot-label-wrap",
                html: `<span class="lot-label" title="Quadra ${quadra}, Lote ${lote}">${lote}</span>`,
                iconSize: [ 1, 1 ],
                iconAnchor: [ 0, 0 ]
            })
        }));
    });
    // Nome das quadras (só no modo planta, para o corretor se orientar sem a imagem de fundo).
    const quadraLabelsLayer = L.layerGroup();
    (() => {
        const somas = new Map;
        lots.features.forEach(feature => {
            const {quadra: quadra, center: center} = feature.properties;
            if (!center) return;
            const s = somas.get(quadra) || { lat: 0, lng: 0, n: 0 };
            s.lat += center[1];
            s.lng += center[0];
            s.n += 1;
            somas.set(quadra, s);
        });
        somas.forEach((s, quadra) => {
            quadraLabelsLayer.addLayer(L.marker([ s.lat / s.n, s.lng / s.n ], {
                interactive: false,
                keyboard: false,
                icon: L.divIcon({
                    className: "lot-label-wrap",
                    html: `<span class="quadra-label">Q${escapeHtml(quadra)}</span>`,
                    iconSize: [ 1, 1 ],
                    iconAnchor: [ 0, 0 ]
                })
            }));
        });
    })();
    const fullBounds = lotLayer.getBounds();
    map.fitBounds(fullBounds, {
        paddingTopLeft: [ 20, 235 ],
        paddingBottomRight: [ 20, 60 ]
    });
    map.on("zoomend", updateLabelsVisibility);
    updateLabelsVisibility();
    populateQuadras();
    restoreLotFromUrl();
    updateOnlineState();
    updateSyncStatusText();
    elements.quadra.addEventListener("change", () => populateLots(Number(elements.quadra.value)));
    elements.form.addEventListener("submit", event => {
        event.preventDefault();
        const quadra = Number(elements.quadra.value);
        const lote = Number(elements.lote.value);
        if (!quadra || !lote) {
            showToast("Selecione a quadra e o lote.");
            return;
        }
        selectLot(quadra, lote, true);
        toggleSearchCard(false);
    });
    elements.searchToggle.addEventListener("click", () => toggleSearchCard(true));
    $("closeSearchButton").addEventListener("click", () => toggleSearchCard(false));
    $("showAllButton").addEventListener("click", () => {
        showAllLots();
        toggleSearchCard(false);
    });
    $("closeLotCard").addEventListener("click", clearSelection);
    $("basemapButton").addEventListener("click", toggleBasemap);
    $("locateButton").addEventListener("click", locateUser);
    elements.gpsChip?.addEventListener("click", () => {
        const quadra = Number(elements.gpsChip.dataset.quadra);
        const lote = Number(elements.gpsChip.dataset.lote);
        if (quadra && lote) selectLot(quadra, lote, false);
    });
    $("zoomInButton").addEventListener("click", () => map.zoomIn());
    $("zoomOutButton").addEventListener("click", () => map.zoomOut());
    $("savedButton").addEventListener("click", openSavedDialog);
    $("commercialButton").addEventListener("click", openCommercialDialog);
    elements.mapa3dButton.addEventListener("click", abrirMapa3D);
    elements.mapa3dCloseButton.addEventListener("click", fecharMapa3D);
    elements.paymentInfoButton.addEventListener("click", abrirFormasPagamento);
    elements.paymentInfoCloseButton.addEventListener("click", fecharFormasPagamento);
    $("clearHistoryButton").addEventListener("click", clearRecentHistory);
    elements.syncStatus.addEventListener("click", () => syncRemoteStatuses(true));
    elements.saveLocalStatus.addEventListener("click", saveLocalCommercialRecord);
    elements.favorite.addEventListener("click", toggleFavorite);
    elements.memorial.addEventListener("click", openSelectedMemorial);
    elements.details.addEventListener("click", openDetailsDialog);
    elements.technicalReview.addEventListener("click", openDetailsDialog);
    elements.shareCard.addEventListener("click", shareCommercialCard);
    document.querySelectorAll(".dialog-close").forEach(button => {
        button.addEventListener("click", () => button.closest("dialog")?.close());
    });
    window.addEventListener("online", () => {
        updateOnlineState();
        if (window.SKLOnline) syncRemoteStatuses(false);
    });
    window.addEventListener("offline", updateOnlineState);
    function lotKey(quadra, lote) {
        return `Q${Number(quadra)}-L${Number(lote)}`;
    }
    function readStoredArray(key) {
        try {
            const value = JSON.parse(localStorage.getItem(key) || "[]");
            return Array.isArray(value) ? value : [];
        } catch {
            return [];
        }
    }
    function readStoredObject(key) {
        try {
            const value = JSON.parse(localStorage.getItem(key) || "{}");
            return value && typeof value === "object" && !Array.isArray(value) ? value : {};
        } catch {
            return {};
        }
    }
    function normalizeStatus(value) {
        const normalized = String(value || "nao_informado").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[\s-]+/g, "_");
        return STATUS[normalized] ? normalized : "nao_informado";
    }
    function commercialRecordFor(key) {
        const remote = remoteStatuses[key] || {};
        return {
            status: normalizeStatus(remote.status),
            valor: remote.valor ?? "",
            observacao: remote.observacao ?? "",
            atualizado_em: remote.atualizado_em ?? remote.updated_at ?? "",
            source: Object.keys(remote).length ? "central" : "cache"
        };
    }
    function styleForFeature(feature, selected) {
        if (selected) {
            return {
                color: "#ffe09f",
                weight: 4,
                opacity: 1,
                fillColor: "#d7ae72",
                fillOpacity: .5
            };
        }
        const {quadra: quadra, lote: lote} = feature.properties;
        const state = STATUS[commercialRecordFor(lotKey(quadra, lote)).status];
        return {
            color: activeBasemap === "planta" ? "#35524f" : "#f7f4ec",
            weight: 1.2,
            opacity: .92,
            fillColor: state.fill,
            fillOpacity: state === STATUS.nao_informado ? .12 : .24
        };
    }
    function updateLayerTooltip(feature, layer) {
        const {quadra: quadra, lote: lote} = feature.properties;
        const record = commercialRecordFor(lotKey(quadra, lote));
        layer.bindTooltip(`Quadra ${quadra} · Lote ${lote}<br><strong>${STATUS[record.status].label}</strong>`, {
            sticky: true,
            direction: "top"
        });
    }
    function applyCommercialStyles() {
        lots.features.forEach(feature => {
            const key = lotKey(feature.properties.quadra, feature.properties.lote);
            const layer = layersByKey.get(key);
            if (!layer) return;
            layer.setStyle(styleForFeature(feature, key === selectedKey));
            updateLayerTooltip(feature, layer);
        });
        if (selectedFeature) updateLotCard(selectedFeature);
    }
    function populateQuadras() {
        [ ...quadras.keys() ].sort((a, b) => a - b).forEach(quadra => {
            elements.quadra.add(new Option(`Quadra ${quadra}`, String(quadra)));
        });
    }
    function toggleSearchCard(open) {
        elements.searchCard.hidden = !open;
        elements.searchToggle.hidden = open;
    }
    function populateLots(quadra, selectedLote = null) {
        elements.lote.replaceChildren(new Option("Selecione", ""));
        const available = quadras.get(quadra) || [];
        [ ...available ].sort((a, b) => a - b).forEach(lote => {
            elements.lote.add(new Option(`Lote ${lote}`, String(lote)));
        });
        elements.lote.disabled = available.length === 0;
        if (selectedLote && available.includes(selectedLote)) elements.lote.value = String(selectedLote);
    }
    function selectLot(quadra, lote, moveMap = false) {
        const key = lotKey(quadra, lote);
        const feature = featuresByKey.get(key);
        const layer = layersByKey.get(key);
        if (!feature || !layer) {
            showToast("Lote não encontrado na base.");
            return;
        }
        if (selectedLayer && selectedFeature) selectedLayer.setStyle(styleForFeature(selectedFeature, false));
        selectedFeature = feature;
        selectedLayer = layer;
        selectedKey = key;
        layer.setStyle(styleForFeature(feature, true));
        layer.bringToFront();
        elements.quadra.value = String(quadra);
        populateLots(quadra, lote);
        recordHistory(key);
        updateLotCard(feature);
        window.SKLReserva?.atualizar?.();
        updateAdminPanel();
        updateLotUrl(quadra, lote);
        if (moveMap) {
            map.fitBounds(layer.getBounds(), {
                paddingTopLeft: [ 35, window.innerWidth <= 700 ? 245 : 260 ],
                paddingBottomRight: [ 35, window.innerWidth <= 700 ? 390 : 80 ],
                maxZoom: 20,
                animate: true
            });
        }
    }
    function updateLotCard(feature) {
        const props = feature.properties;
        const {quadra: quadra, lote: lote, area_m2: area, center: center, access: access} = props;
        const record = commercialRecordFor(lotKey(quadra, lote));
        const destination = access ? {
            latitude: access.latitude,
            longitude: access.longitude
        } : {
            latitude: center[1],
            longitude: center[0]
        };
        elements.lotTitle.textContent = `Quadra ${quadra} · Lote ${lote}`;
        elements.lotArea.textContent = `${formatNumber(area)} m²`;
        elements.lotPerimeter.textContent = props.perimeter_m ? `${formatNumber(props.perimeter_m)} m` : "—";
        elements.lotFrontage.textContent = props.frontage_m ? `${formatNumber(props.frontage_m)} m` : "Não indicada";
        elements.lotCoordinates.textContent = `${destination.latitude.toFixed(6)}, ${destination.longitude.toFixed(6)}`;
        if (access) {
            const review = access.confidence === "pendente_revisao" ? " · estimado, revisar" : "";
            elements.lotAccess.textContent = `${access.label}${review}`;
        } else {
            elements.lotAccess.textContent = "Centro do lote · memorial sem via nomeada";
        }
        const routeUrl = `https://www.google.com/maps/dir/?api=1&destination=${destination.latitude},${destination.longitude}&travelmode=driving`;
        elements.googleMaps.href = routeUrl;
        elements.waze.href = `https://www.waze.com/ul?ll=${destination.latitude},${destination.longitude}&navigate=yes`;
        elements.statusBadge.className = `status-badge status-${record.status}`;
        elements.statusBadge.textContent = STATUS[record.status].label;
        const commercialParts = [];
        if (record.valor) commercialParts.push(`<strong>Valor:</strong> ${escapeHtml(record.valor)}`);
        if (record.observacao) commercialParts.push(`<strong>Observação:</strong> ${escapeHtml(record.observacao)}`);
        elements.commercialInfo.innerHTML = commercialParts.join("<br>");
        elements.commercialInfo.hidden = commercialParts.length === 0;
        elements.favorite.classList.toggle("active", favorites.has(selectedKey));
        elements.favorite.textContent = favorites.has(selectedKey) ? "★" : "☆";
        elements.favorite.setAttribute("aria-label", favorites.has(selectedKey) ? "Remover dos favoritos" : "Adicionar aos favoritos");
        const reviewNotes = props.technical_review || [];
        elements.technicalReview.hidden = reviewNotes.length === 0;
        if (accessMarker) map.removeLayer(accessMarker);
        accessMarker = null;
        if (access) {
            accessMarker = L.marker([ access.latitude, access.longitude ], {
                title: "Ponto de navegação pela testada",
                icon: L.divIcon({
                    className: "",
                    html: '<div class="access-marker"></div>',
                    iconSize: [ 20, 20 ],
                    iconAnchor: [ 10, 20 ]
                })
            }).addTo(map).bindPopup(`Destino pela testada: ${escapeHtml(access.label)}`);
        }
        elements.lotCard.hidden = false;
        elements.connectionBadge.hidden = true;
        updateDistance();
    }
    function clearSelection() {
        if (selectedLayer && selectedFeature) selectedLayer.setStyle(styleForFeature(selectedFeature, false));
        selectedFeature = null;
        selectedLayer = null;
        selectedKey = null;
        if (accessMarker) map.removeLayer(accessMarker);
        accessMarker = null;
        elements.lotCard.hidden = true;
        elements.connectionBadge.hidden = false;
        const url = new URL(location.href);
        url.searchParams.delete("quadra");
        url.searchParams.delete("lote");
        history.replaceState({}, "", url);
        updateAdminPanel();
        updateDistance();
    }
    function showAllLots() {
        clearSelection();
        elements.quadra.value = "";
        populateLots(0);
        map.fitBounds(fullBounds, {
            paddingTopLeft: [ 20, 235 ],
            paddingBottomRight: [ 20, 60 ],
            animate: true
        });
    }
    function setBasemap(nome) {
        if (!BASEMAPS[nome]) return;
        Object.values(BASEMAPS).forEach(({camada: camada}) => {
            if (camada && map.hasLayer(camada)) map.removeLayer(camada);
        });
        activeBasemap = nome;
        if (BASEMAPS[nome].camada) BASEMAPS[nome].camada.addTo(map);
        map.getContainer().classList.toggle("mapa-planta", nome === "planta");
        if (nome === "planta") quadraLabelsLayer.addTo(map); else map.removeLayer(quadraLabelsLayer);
        elements.connectionBadge.textContent = BASEMAPS[nome].rotulo;
        applyCommercialStyles();
        lotLayer.bringToFront();
        updateLabelsVisibility();
    }
    function toggleBasemap() {
        const ordem = [ "satellite", "street", "planta" ];
        const proximo = ordem[(ordem.indexOf(activeBasemap) + 1) % ordem.length];
        basemapAntesDoOffline = null;
        setBasemap(proximo);
        showToast(`Fundo do mapa: ${BASEMAPS[proximo].rotulo}.`);
    }
    function updateLabelsVisibility() {
        if (map.getZoom() >= (activeBasemap === "planta" ? 17 : 18)) {
            if (!map.hasLayer(labelsLayer)) labelsLayer.addTo(map);
        } else if (map.hasLayer(labelsLayer)) {
            map.removeLayer(labelsLayer);
        }
    }
    // ---- GPS em campo: acompanha o corretor (funciona sem internet — é o GPS do aparelho) ----
    // 1º toque: liga e segue a posição · arrastar o mapa: para de seguir (GPS continua)
    // toque com GPS ligado e sem seguir: volta a seguir · toque seguindo: desliga.
    function locateUser() {
        if (!navigator.geolocation) {
            showToast("Este aparelho não disponibiliza localização.");
            return;
        }
        if (gpsWatchId !== null) {
            if (!gpsSeguindo && userPosition) {
                gpsSeguindo = true;
                map.panTo([ userPosition.latitude, userPosition.longitude ]);
                atualizarBotaoGps();
                return;
            }
            pararGps();
            showToast("Localização desligada.");
            return;
        }
        gpsSeguindo = true;
        gpsPrimeiraPosicao = true;
        showToast(navigator.onLine ? "Obtendo sua localização…" : "Obtendo sua localização pelo GPS… sem internet a primeira posição pode levar até 1 minuto em céu aberto.");
        gpsWatchId = navigator.geolocation.watchPosition(receberPosicao, erro => {
            const messages = {
                1: "Permita o acesso à localização nas configurações.",
                2: "Não foi possível determinar sua localização agora.",
                3: "O GPS ainda não encontrou sua posição. Fique em local aberto e aguarde."
            };
            showToast(messages[erro.code] || "Falha ao obter sua localização.");
            if (erro.code === 1) pararGps();
        }, {
            enableHighAccuracy: true,
            timeout: 6e4,
            maximumAge: 5e3
        });
        atualizarBotaoGps();
    }
    function receberPosicao({coords: coords}) {
        userPosition = {
            latitude: coords.latitude,
            longitude: coords.longitude,
            accuracy: coords.accuracy
        };
        const latlng = [ coords.latitude, coords.longitude ];
        if (!userMarker) {
            userMarker = L.marker(latlng, {
                title: "Sua localização",
                interactive: false,
                keyboard: false,
                icon: L.divIcon({
                    className: "",
                    html: '<div class="user-location-marker"></div>',
                    iconSize: [ 18, 18 ],
                    iconAnchor: [ 9, 9 ]
                })
            }).addTo(map);
            accuracyCircle = L.circle(latlng, {
                radius: Math.min(coords.accuracy, 150),
                color: "#2589ff",
                weight: 1,
                fillColor: "#2589ff",
                fillOpacity: .12,
                interactive: false
            }).addTo(map);
        } else {
            userMarker.setLatLng(latlng);
            accuracyCircle.setLatLng(latlng).setRadius(Math.min(coords.accuracy, 150));
        }
        if (gpsPrimeiraPosicao) {
            gpsPrimeiraPosicao = false;
            map.setView(latlng, Math.max(map.getZoom(), 18), {
                animate: true
            });
            showToast(`Localização encontrada${coords.accuracy ? ` · precisão aproximada: ${Math.round(coords.accuracy)} m` : ""}.`);
        } else if (gpsSeguindo && !map.getBounds().pad(-.25).contains(latlng)) {
            map.panTo(latlng, {
                animate: true
            });
        }
        atualizarOndeEstou();
        updateDistance();
    }
    function pararGps() {
        if (gpsWatchId !== null) navigator.geolocation.clearWatch(gpsWatchId);
        gpsWatchId = null;
        gpsSeguindo = false;
        userPosition = null;
        if (userMarker) map.removeLayer(userMarker);
        if (accuracyCircle) map.removeLayer(accuracyCircle);
        userMarker = null;
        accuracyCircle = null;
        if (elements.gpsChip) elements.gpsChip.hidden = true;
        atualizarBotaoGps();
        updateDistance();
    }
    function atualizarBotaoGps() {
        const botao = $("locateButton");
        if (!botao) return;
        botao.classList.toggle("gps-ligado", gpsWatchId !== null);
        botao.classList.toggle("gps-seguindo", gpsWatchId !== null && gpsSeguindo);
        botao.title = gpsWatchId === null ? "Minha localização" : gpsSeguindo ? "Desligar localização" : "Voltar para minha posição";
    }
    map.on("dragstart", () => {
        if (gpsSeguindo) {
            gpsSeguindo = false;
            atualizarBotaoGps();
        }
    });
    function pontoNoAnel(lng, lat, anel) {
        let dentro = false;
        for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
            const [xi, yi] = anel[i], [xj, yj] = anel[j];
            if (yi > lat !== yj > lat && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) dentro = !dentro;
        }
        return dentro;
    }
    function pontoNoLote(lng, lat, geometry) {
        if (!geometry) return false;
        const poligonos = geometry.type === "Polygon" ? [ geometry.coordinates ] : geometry.type === "MultiPolygon" ? geometry.coordinates : [];
        return poligonos.some(aneis => pontoNoAnel(lng, lat, aneis[0]) && !aneis.slice(1).some(buraco => pontoNoAnel(lng, lat, buraco)));
    }
    function atualizarOndeEstou() {
        const chip = elements.gpsChip;
        if (!chip || !userPosition) return;
        const {latitude: lat, longitude: lng, accuracy: precisao} = userPosition;
        const dentro = lots.features.find(feature => pontoNoLote(lng, lat, feature.geometry));
        let texto, alvo = dentro;
        if (dentro) {
            texto = `Você está na Quadra ${dentro.properties.quadra} · Lote ${dentro.properties.lote}`;
        } else {
            let melhor = null, menor = Infinity;
            lots.features.forEach(feature => {
                const c = feature.properties.center;
                if (!c) return;
                const d = distanceMeters(lat, lng, c[1], c[0]);
                if (d < menor) {
                    menor = d;
                    melhor = feature;
                }
            });
            alvo = melhor;
            texto = !melhor ? "Sua posição" : menor > 2e3 ? `Você está a ${formatarDistancia(menor)} do empreendimento` : `Mais perto: Quadra ${melhor.properties.quadra} · Lote ${melhor.properties.lote} (${formatarDistancia(menor)})`;
        }
        if (precisao > 25) texto += ` · precisão baixa (±${Math.round(precisao)} m)`;
        chip.textContent = "📍 " + texto;
        chip.dataset.quadra = alvo ? alvo.properties.quadra : "";
        chip.dataset.lote = alvo ? alvo.properties.lote : "";
        chip.hidden = false;
    }
    function formatarDistancia(metros) {
        return metros < 1e3 ? `${Math.round(metros)} m` : `${(metros / 1e3).toLocaleString("pt-BR", {
            maximumFractionDigits: 2
        })} km`;
    }
    function rumo(lat1, lon1, lat2, lon2) {
        const toRad = v => v * Math.PI / 180;
        const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
        const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
        const graus = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
        return [ "norte", "nordeste", "leste", "sudeste", "sul", "sudoeste", "oeste", "noroeste" ][Math.round(graus / 45) % 8];
    }
    function updateDistance() {
        if (!selectedFeature || !userPosition) {
            elements.distanceRow.hidden = true;
            if (guiaAteLote) map.removeLayer(guiaAteLote);
            guiaAteLote = null;
            return;
        }
        const props = selectedFeature.properties;
        const destination = props.access ? [ props.access.latitude, props.access.longitude ] : [ props.center[1], props.center[0] ];
        const distance = distanceMeters(userPosition.latitude, userPosition.longitude, destination[0], destination[1]);
        const chegou = distance < 15 || pontoNoLote(userPosition.longitude, userPosition.latitude, selectedFeature.geometry);
        elements.lotDistance.textContent = chegou ? "Você chegou ao lote" : `${formatarDistancia(distance)} · siga para ${rumo(userPosition.latitude, userPosition.longitude, destination[0], destination[1])}`;
        elements.distanceRow.hidden = false;
        const pontos = [ [ userPosition.latitude, userPosition.longitude ], destination ];
        if (chegou) {
            if (guiaAteLote) map.removeLayer(guiaAteLote);
            guiaAteLote = null;
        } else if (guiaAteLote) {
            guiaAteLote.setLatLngs(pontos);
        } else {
            guiaAteLote = L.polyline(pontos, {
                color: "#2589ff",
                weight: 3,
                opacity: .9,
                dashArray: "6 8",
                interactive: false
            }).addTo(map);
        }
    }
    function distanceMeters(lat1, lon1, lat2, lon2) {
        const toRad = value => value * Math.PI / 180;
        const radius = 6371008.8;
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
        return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
    function formatNumber(value) {
        return Number(value).toLocaleString("pt-BR", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }
    function updateLotUrl(quadra, lote) {
        const url = new URL(location.href);
        url.searchParams.set("quadra", quadra);
        url.searchParams.set("lote", lote);
        history.replaceState({}, "", url);
    }
    function restoreLotFromUrl() {
        const params = new URLSearchParams(location.search);
        const quadra = Number(params.get("quadra"));
        const lote = Number(params.get("lote"));
        if (quadra && lote && featuresByKey.has(lotKey(quadra, lote))) selectLot(quadra, lote, true);
    }
    function toggleFavorite() {
        if (!selectedKey) return;
        if (favorites.has(selectedKey)) {
            favorites.delete(selectedKey);
            showToast("Lote removido dos favoritos.");
        } else {
            favorites.add(selectedKey);
            showToast("Lote adicionado aos favoritos.");
        }
        localStorage.setItem(STORAGE.favorites, JSON.stringify([ ...favorites ]));
        updateLotCard(selectedFeature);
    }
    function recordHistory(key) {
        recentHistory = [ key, ...recentHistory.filter(item => item !== key) ].slice(0, 12);
        localStorage.setItem(STORAGE.history, JSON.stringify(recentHistory));
    }
    function clearRecentHistory() {
        recentHistory = [];
        localStorage.setItem(STORAGE.history, "[]");
        renderSavedLists();
    }
    function openSavedDialog() {
        renderSavedLists();
        if (!elements.savedDialog.open) elements.savedDialog.showModal();
    }
    function renderSavedLists() {
        renderLotList(elements.favoritesList, [ ...favorites ], "Nenhum lote favorito ainda.");
        renderLotList(elements.historyList, recentHistory, "Nenhum lote consultado recentemente.");
    }
    function renderLotList(container, keys, emptyText) {
        container.replaceChildren();
        const valid = keys.filter(key => featuresByKey.has(key));
        if (!valid.length) {
            const empty = document.createElement("div");
            empty.className = "lot-list-empty";
            empty.textContent = emptyText;
            container.append(empty);
            return;
        }
        valid.forEach(key => {
            const feature = featuresByKey.get(key);
            const {quadra: quadra, lote: lote, area_m2: area_m2} = feature.properties;
            const record = commercialRecordFor(key);
            const button = document.createElement("button");
            button.className = "lot-list-button";
            button.type = "button";
            button.innerHTML = `<span><strong>Quadra ${quadra} · Lote ${lote}</strong><br><small>${formatNumber(area_m2)} m²</small></span><small>${STATUS[record.status].label}</small>`;
            button.addEventListener("click", () => {
                button.closest("dialog")?.close();
                selectLot(quadra, lote, true);
            });
            container.append(button);
        });
    }
    function openDetailsDialog() {
        if (!selectedFeature) {
            showToast("Selecione um lote primeiro.");
            return;
        }
        const props = selectedFeature.properties;
        elements.detailsTitle.textContent = `Quadra ${props.quadra} · Lote ${props.lote}`;
        elements.dimensionsList.replaceChildren();
        (props.dimensions || []).forEach(segment => {
            const row = document.createElement("div");
            row.className = "dimension-row";
            row.innerHTML = `<span>Vértices ${escapeHtml(segment.from)}–${escapeHtml(segment.to)}</span><span>${escapeHtml(segment.label)}</span><strong>${formatNumber(segment.length_m)} m</strong>`;
            elements.dimensionsList.append(row);
        });
        const notes = props.technical_review || [];
        elements.reviewList.replaceChildren();
        notes.forEach(note => {
            const item = document.createElement("li");
            item.textContent = note;
            elements.reviewList.append(item);
        });
        elements.reviewSection.hidden = notes.length === 0;
        if (!elements.detailsDialog.open) elements.detailsDialog.showModal();
    }
    function openSelectedMemorial() {
        if (!selectedFeature) return;
        const props = selectedFeature.properties;
        const title = `Memorial_Q${String(props.quadra).padStart(2, "0")}_L${String(props.lote).padStart(2, "0")}.pdf`;
        window.SKLOnline.openMemorial(props.quadra, props.lote, title);
    }
    function openCommercialDialog() {
        updateAdminPanel();
        updateSyncStatusText();
        if (!elements.commercialDialog.open) elements.commercialDialog.showModal();
    }
    function updateAdminPanel() {
        const enabled = Boolean(selectedFeature);
        [ elements.adminStatus, elements.adminValue, elements.adminNote, elements.saveLocalStatus ].forEach(element => {
            element.disabled = !enabled;
        });
        if (!enabled) {
            elements.adminLotTitle.textContent = "Selecione um lote no mapa";
            elements.adminStatus.value = "nao_informado";
            elements.adminValue.value = "";
            elements.adminNote.value = "";
            return;
        }
        const props = selectedFeature.properties;
        const record = commercialRecordFor(selectedKey);
        elements.adminLotTitle.textContent = `Quadra ${props.quadra} · Lote ${props.lote}`;
        elements.adminStatus.value = record.status;
        elements.adminValue.value = record.valor;
        elements.adminNote.value = record.observacao;
    }
    function saveLocalCommercialRecord() {
        showToast("A situação oficial somente pode ser alterada pela Central de Vendas.");
    }
    async function syncRemoteStatuses(showFeedback) {
        if (!window.SKLOnline) return;
        return window.SKLOnline.sync(showFeedback);
    }
    function parseStatusPayload(text) {
        const trimmed = text.trim();
        if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) return recordsFromRows(parsed);
            if (parsed.statuses && typeof parsed.statuses === "object") {
                const records = {};
                Object.entries(parsed.statuses).forEach(([key, value]) => {
                    if (featuresByKey.has(key)) records[key] = normalizeRecord(value);
                });
                return records;
            }
        }
        const rows = parseDelimitedText(trimmed);
        if (rows.length < 2) return {};
        const headers = rows[0].map(normalizeHeader);
        return recordsFromRows(rows.slice(1).map(row => Object.fromEntries(headers.map((header, index) => [ header, row[index] || "" ]))));
    }
    function recordsFromRows(rows) {
        const records = {};
        rows.forEach(row => {
            const quadra = Number(row.quadra ?? row.Quadra);
            const lote = Number(row.lote ?? row.Lote);
            const key = lotKey(quadra, lote);
            if (!quadra || !lote || !featuresByKey.has(key)) return;
            records[key] = normalizeRecord(row);
        });
        return records;
    }
    function normalizeRecord(record) {
        return {
            status: normalizeStatus(record.status ?? record.situacao),
            valor: String(record.valor ?? "").trim(),
            observacao: String(record.observacao ?? record.obs ?? "").trim(),
            atualizado_em: String(record.atualizado_em ?? record.atualizacao ?? "").trim()
        };
    }
    function normalizeHeader(value) {
        return String(value || "").replace(/^\ufeff/, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[\s-]+/g, "_");
    }
    function parseDelimitedText(text) {
        const firstLine = text.split(/\r?\n/, 1)[0];
        const delimiter = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ";" : ",";
        const rows = [];
        let row = [];
        let value = "";
        let quoted = false;
        for (let index = 0; index < text.length; index += 1) {
            const char = text[index];
            if (char === '"') {
                if (quoted && text[index + 1] === '"') {
                    value += '"';
                    index += 1;
                } else {
                    quoted = !quoted;
                }
            } else if (char === delimiter && !quoted) {
                row.push(value);
                value = "";
            } else if ((char === "\n" || char === "\r") && !quoted) {
                if (char === "\r" && text[index + 1] === "\n") index += 1;
                row.push(value);
                if (row.some(cell => cell.trim())) rows.push(row);
                row = [];
                value = "";
            } else {
                value += char;
            }
        }
        row.push(value);
        if (row.some(cell => cell.trim())) rows.push(row);
        return rows;
    }
    function updateSyncStatusText() {
        const count = Object.keys(remoteStatuses).length;
        const date = remoteUpdatedAt ? new Date(remoteUpdatedAt).toLocaleString("pt-BR") : "ainda não sincronizada";
        elements.syncStatusText.textContent = `${count} lotes em cache · última atualização: ${date}.`;
    }
    async function shareCommercialCard() {
        if (!selectedFeature) return;
        showToast("Preparando ficha comercial…");
        try {
            const canvas = await buildCommercialCard(selectedFeature);
            const props = selectedFeature.properties;
            const filename = `SKL_Q${String(props.quadra).padStart(2, "0")}_L${String(props.lote).padStart(2, "0")}.png`;
            const destination = props.access ? [ props.access.latitude, props.access.longitude ] : [ props.center[1], props.center[0] ];
            const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${destination[0]},${destination[1]}`;
            const text = `SKL Soluções Digitais · Quadra ${props.quadra}, Lote ${props.lote} · ${formatNumber(props.area_m2)} m²\nNavegação: ${mapsUrl}\nLocalização para orientação comercial e navegação; não substitui demarcação física ou levantamento técnico.`;
            if (window.NativeBridge?.shareCard) {
                window.NativeBridge.shareCard(canvas.toDataURL("image/png"), filename, text);
                return;
            }
            const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png", .95));
            const file = new File([ blob ], filename, {
                type: "image/png"
            });
            if (navigator.share && navigator.canShare?.({
                files: [ file ]
            })) {
                await navigator.share({
                    title: filename,
                    text: text,
                    files: [ file ]
                });
                return;
            }
            const link = document.createElement("a");
            link.download = filename;
            link.href = URL.createObjectURL(blob);
            link.click();
            setTimeout(() => URL.revokeObjectURL(link.href), 1e3);
            showToast("Ficha comercial gerada.");
        } catch (error) {
            showToast("Não foi possível gerar a ficha comercial.");
        }
    }
    async function buildCommercialCard(feature) {
        const props = feature.properties;
        const record = commercialRecordFor(lotKey(props.quadra, props.lote));
        const state = STATUS[record.status];
        const canvas = document.createElement("canvas");
        canvas.width = 1080;
        canvas.height = 1350;
        const context = canvas.getContext("2d");
        const gradient = context.createLinearGradient(0, 0, 1080, 1350);
        gradient.addColorStop(0, "#f7f4ec");
        gradient.addColorStop(1, "#e8dfcf");
        context.fillStyle = gradient;
        context.fillRect(0, 0, 1080, 1350);
        context.fillStyle = "#052f3c";
        context.fillRect(0, 0, 1080, 260);
        try {
            const logo = await loadImage("assets/logo-symbol.png");
            context.drawImage(logo, 70, 58, 132, 132);
        } catch {}
        context.fillStyle = "#ffffff";
        context.font = "700 31px sans-serif";
        context.fillText("LOTEAMENTO JARDIM", 235, 92);
        context.font = "500 76px Georgia, serif";
        context.fillText("SKL", 230, 160);
        context.font = "700 25px sans-serif";
        context.letterSpacing = "6px";
        context.fillText("BEACH RESORT", 235, 205);
        context.fillStyle = "#063f50";
        context.font = "800 28px sans-serif";
        context.fillText("FICHA COMERCIAL", 70, 325);
        context.font = "700 54px sans-serif";
        context.fillText(`QUADRA ${props.quadra} · LOTE ${props.lote}`, 70, 390);
        drawRoundedRect(context, 70, 425, 300, 62, 31, state.fill);
        context.fillStyle = "#ffffff";
        context.font = "800 24px sans-serif";
        context.fillText(state.label.toUpperCase(), 94, 465);
        drawLotShape(context, feature.geometry.coordinates[0], 80, 530, 920, 380);
        const cards = [ [ "ÁREA", `${formatNumber(props.area_m2)} m²` ], [ "PERÍMETRO", props.perimeter_m ? `${formatNumber(props.perimeter_m)} m` : "—" ], [ "TESTADA VIÁRIA", props.frontage_m ? `${formatNumber(props.frontage_m)} m` : "Não indicada" ] ];
        cards.forEach(([label, value], index) => {
            const x = 70 + index * 320;
            drawRoundedRect(context, x, 950, 290, 118, 18, "#ffffff");
            context.fillStyle = "#66777c";
            context.font = "700 18px sans-serif";
            context.fillText(label, x + 22, 986);
            context.fillStyle = "#052f3c";
            context.font = "800 30px sans-serif";
            context.fillText(value, x + 22, 1034);
        });
        context.fillStyle = "#063f50";
        context.font = "800 21px sans-serif";
        context.fillText("PONTO DE NAVEGAÇÃO", 70, 1126);
        context.fillStyle = "#19323a";
        context.font = "600 24px sans-serif";
        const accessText = props.access ? props.access.label : "Centro do lote — memorial sem via pública nomeada";
        wrapText(context, accessText, 70, 1162, 940, 31, 2);
        if (record.valor) {
            context.fillStyle = "#9a7042";
            context.font = "800 25px sans-serif";
            context.fillText(`VALOR: ${record.valor}`, 70, 1238);
        }
        context.fillStyle = "#6f6f68";
        context.font = "500 16px sans-serif";
        wrapText(context, "Localização para orientação comercial e navegação. Não substitui demarcação física ou levantamento técnico dos limites.", 70, 1285, 940, 22, 2);
        return canvas;
    }
    function drawLotShape(context, coordinates, x, y, width, height) {
        const longitudes = coordinates.map(point => point[0]);
        const latitudes = coordinates.map(point => point[1]);
        const minX = Math.min(...longitudes);
        const maxX = Math.max(...longitudes);
        const minY = Math.min(...latitudes);
        const maxY = Math.max(...latitudes);
        const rangeX = Math.max(maxX - minX, 1e-9);
        const rangeY = Math.max(maxY - minY, 1e-9);
        const scale = Math.min((width - 80) / rangeX, (height - 60) / rangeY);
        const shapeWidth = rangeX * scale;
        const shapeHeight = rangeY * scale;
        const offsetX = x + (width - shapeWidth) / 2;
        const offsetY = y + (height - shapeHeight) / 2;
        drawRoundedRect(context, x, y, width, height, 24, "#ffffff");
        context.beginPath();
        coordinates.forEach((point, index) => {
            const px = offsetX + (point[0] - minX) * scale;
            const py = offsetY + (maxY - point[1]) * scale;
            if (index === 0) context.moveTo(px, py); else context.lineTo(px, py);
        });
        context.closePath();
        context.fillStyle = "rgba(15,97,116,.22)";
        context.fill();
        context.strokeStyle = "#063f50";
        context.lineWidth = 9;
        context.lineJoin = "round";
        context.stroke();
    }
    function drawRoundedRect(context, x, y, width, height, radius, color) {
        context.beginPath();
        context.roundRect(x, y, width, height, radius);
        context.fillStyle = color;
        context.fill();
    }
    function wrapText(context, text, x, y, maxWidth, lineHeight, maxLines) {
        const words = String(text).split(/\s+/);
        let line = "";
        let lineNumber = 0;
        for (let index = 0; index < words.length; index += 1) {
            const test = line ? `${line} ${words[index]}` : words[index];
            if (context.measureText(test).width > maxWidth && line) {
                context.fillText(line, x, y + lineNumber * lineHeight);
                line = words[index];
                lineNumber += 1;
                if (lineNumber >= maxLines - 1) break;
            } else {
                line = test;
            }
        }
        if (lineNumber < maxLines) context.fillText(line, x, y + lineNumber * lineHeight);
    }
    function loadImage(src) {
        return new Promise((resolve, reject) => {
            const image = new Image;
            image.onload = () => resolve(image);
            image.onerror = reject;
            image.src = src;
        });
    }
    function updateOnlineState() {
        const semInternet = !navigator.onLine;
        if (semInternet) {
            const quando = remoteUpdatedAt ? new Date(remoteUpdatedAt).toLocaleString("pt-BR", {
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit"
            }) : null;
            elements.offline.textContent = `Sem internet · mapa, lotes e GPS funcionando${quando ? ` · situação dos lotes de ${quando}` : ""} · reservas só com internet`;
            if (activeBasemap !== "planta") {
                basemapAntesDoOffline = activeBasemap;
                setBasemap("planta");
            }
        } else if (basemapAntesDoOffline) {
            const voltar = basemapAntesDoOffline;
            basemapAntesDoOffline = null;
            setBasemap(voltar);
        }
        elements.offline.hidden = !semInternet;
    }
    function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, character => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#039;"
        }[character]));
    }
    function showToast(message) {
        clearTimeout(toastTimer);
        elements.toast.textContent = message;
        elements.toast.hidden = false;
        toastTimer = setTimeout(() => {
            elements.toast.hidden = true;
        }, 3800);
    }
    function installRemoteLot(lot) {
        if (!lot || !lot.key || !featuresByKey.has(lot.key)) return false;
        remoteStatuses[lot.key] = {
            ...lot,
            status: normalizeStatus(lot.status),
            valor: String(lot.valor ?? ""),
            observacao: String(lot.observacao ?? ""),
            atualizado_em: lot.updated_at || lot.atualizado_em || ""
        };
        return true;
    }
    window.SKLApp = {
        setRemoteLots(serverLots, serverTime) {
            const next = {};
            (Array.isArray(serverLots) ? serverLots : []).forEach(lot => {
                if (!lot || !lot.key || !featuresByKey.has(lot.key)) return;
                next[lot.key] = {
                    ...lot,
                    status: normalizeStatus(lot.status),
                    valor: String(lot.valor ?? ""),
                    observacao: String(lot.observacao ?? ""),
                    atualizado_em: lot.updated_at || lot.atualizado_em || ""
                };
            });
            remoteStatuses = next;
            remoteUpdatedAt = serverTime || (new Date).toISOString();
            localStorage.setItem(STORAGE.remoteStatus, JSON.stringify({
                records: remoteStatuses,
                updatedAt: remoteUpdatedAt
            }));
            applyCommercialStyles();
            updateSyncStatusText();
            return Object.keys(remoteStatuses).length;
        },
        setRemoteLot(lot, serverTime) {
            if (!installRemoteLot(lot)) return false;
            remoteUpdatedAt = serverTime || lot.updated_at || (new Date).toISOString();
            localStorage.setItem(STORAGE.remoteStatus, JSON.stringify({
                records: remoteStatuses,
                updatedAt: remoteUpdatedAt
            }));
            applyCommercialStyles();
            updateSyncStatusText();
            return true;
        },
        getSelectedLot() {
            if (!selectedFeature || !selectedKey) return null;
            return {
                lot_key: selectedKey,
                quadra: selectedFeature.properties.quadra,
                lote: selectedFeature.properties.lote,
                area_m2: selectedFeature.properties.area_m2,
                record: {
                    ...commercialRecordFor(selectedKey),
                    ...remoteStatuses[selectedKey] || {}
                }
            };
        },
        refreshStatusText: updateSyncStatusText,
        showToast: showToast,
        showMapa3DButton() {
            elements.mapa3dButton.hidden = false;
        },
        updateMapa3DStatus(loteId, status) {
            if (mapa3dInstance) mapa3dInstance.atualizarStatus(loteId, normalizeStatus(status));
        },
        resetMapa3D() {
            fecharMapa3D();
            mapa3dDados = null;
            elements.mapa3dButton.hidden = true;
        },
        showPaymentInfoButton() {
            elements.paymentInfoButton.hidden = false;
        },
        resetFormasPagamento() {
            fecharFormasPagamento();
            formasPagamentoDados = null;
            elements.paymentInfoButton.hidden = true;
        }
    };
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (!isStandalone && !isNativeAndroid) elements.install.hidden = false;
    window.addEventListener("beforeinstallprompt", event => {
        event.preventDefault();
        deferredInstallPrompt = event;
        elements.install.hidden = false;
    });
    elements.install.addEventListener("click", async () => {
        if (deferredInstallPrompt) {
            deferredInstallPrompt.prompt();
            await deferredInstallPrompt.userChoice;
            deferredInstallPrompt = null;
            return;
        }
        elements.installInstructions.innerHTML = isIOS ? "No Safari, toque em <strong>Compartilhar</strong> e depois em <strong>Adicionar à Tela de Início</strong>." : "Abra o menu do navegador e escolha <strong>Instalar aplicativo</strong> ou <strong>Adicionar à tela inicial</strong>.";
        elements.installDialog.showModal();
    });
    window.addEventListener("appinstalled", () => {
        elements.install.hidden = true;
        showToast("Aplicativo instalado.");
    });
    if ("serviceWorker" in navigator && location.protocol.startsWith("http") && !isNativeAndroid) {
        window.addEventListener("load", () => navigator.serviceWorker.register("../sw.js").catch(() => {}));
    }
})();