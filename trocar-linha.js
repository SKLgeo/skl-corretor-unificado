// Botão "Trocar de linha" dentro de Vendas e de Aluguéis (volta para a escolha do início).
// Só aparece para quem tem acesso às DUAS linhas (a tela de entrada grava essa informação em
// localStorage: sklu_linhas). Não há botão "voltar" no iPhone instalado, por isso o atalho.
(() => {
  "use strict";
  let linhas = "";
  try { linhas = localStorage.getItem("sklu_linhas") || ""; } catch {}
  if (!(linhas.includes("vendas") && linhas.includes("aluguel"))) return;

  const ancoras = ["brokerSwitchButton", "vtSwitchAccountButton", "topbarSwitchCarteiraButton", "switchEmpreendimentoButton"];
  ancoras.forEach((id) => {
    const referencia = document.getElementById(id);
    if (!referencia) return;
    const botao = document.createElement("button");
    botao.type = "button";
    botao.className = referencia.className;
    botao.textContent = id === "topbarSwitchCarteiraButton" ? "⇄ Trocar de linha" : "⇄ Trocar de linha (Vendas / Aluguéis)";
    botao.addEventListener("click", () => { location.href = "../index.html"; });
    referencia.insertAdjacentElement("afterend", botao);
  });
})();
