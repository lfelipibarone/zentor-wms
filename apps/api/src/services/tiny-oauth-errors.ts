export function formatOAuthErrorMessage(err: {
  error?: string;
  error_description?: string;
}): string {
  const code = err.error?.toLowerCase() ?? "";
  const desc = err.error_description?.trim();

  if (code === "invalid_grant") {
    return "Refresh ou código OAuth expirado. Conecte novamente em Integrações → Tiny.";
  }
  if (code.includes("redirect") || desc?.toLowerCase().includes("redirect")) {
    return "Redirect URI não confere com o painel Olist. Verifique http/https, porta e path.";
  }
  if (desc) return desc;
  if (code) return `Erro OAuth: ${code}`;
  return "Erro ao autenticar com Olist ERP";
}
