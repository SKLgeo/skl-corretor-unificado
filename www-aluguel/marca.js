// Marca da imobiliária. No app da SKL (Unificado / SKL Imobiliária) abre SÓ a carteira de demonstração:
// nunca a carteira de um cliente (Cerrado e outras), mesmo entrando com a conta mestre.
// O gerador do link de cada cliente (Codigo_Fonte/Web_Imobiliaria/gerar.js) substitui este arquivo por:
//   window.SKL_MARCA = { nome, link, carteira_id, supabase_url?, supabase_anon_key? };
window.SKL_MARCA = window.SKL_MARCA || { carteira_id: "6f02a7db-d925-49b3-abc0-8a8785e09017" };
