function str(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s || undefined;
}

/** Mensagem amigável para HTTP 403 da API v3 (pós-OAuth ou em chamadas). */
export function formatTinyApiForbiddenMessage(apiMessage?: string): string {
  const detail = apiMessage?.trim();
  const base =
    "Acesso negado pela API Olist (HTTP 403). O login OAuth foi aceito, mas o usuário ou o aplicativo não tem permissão para acessar os dados.";
  const hints =
    "Conecte com um usuário administrador do Tiny ERP e confira em Configurações → Aplicativos se as permissões do app incluem Dados da empresa, Pedidos, Produtos e Notas.";
  if (detail) return `${base} Detalhe: ${detail}. ${hints}`;
  return `${base} ${hints}`;
}

export function formatTinyApiValidationMessage(
  status: number,
  body?: Record<string, unknown>,
): string {
  if (status === 403) {
    return formatTinyApiForbiddenMessage(str(body?.mensagem));
  }
  const apiMsg = str(body?.mensagem);
  if (apiMsg) return `Validação API v3 falhou (HTTP ${status}): ${apiMsg}`;
  return `Validação API v3 falhou (HTTP ${status})`;
}

export function formatOAuthErrorMessage(err: {
  error?: string;
  error_description?: string;
}): string {
  const code = err.error?.toLowerCase() ?? "";
  const desc = err.error_description?.trim();

  if (code === "invalid_grant") {
    return "Refresh ou código OAuth expirado (válido por ~24h). Conecte novamente em Integrações → Tiny.";
  }
  if (code.includes("redirect") || desc?.toLowerCase().includes("redirect")) {
    return "Redirect URI não confere com o painel Olist. Verifique http/https, porta e path.";
  }
  if (desc) return desc;
  if (code) return `Erro OAuth: ${code}`;
  return "Erro ao autenticar com Olist ERP";
}

export function formatOAuthCallbackQueryError(error: string): string {
  const code = error.trim().toLowerCase();
  if (code === "access_denied") {
    return "Autorização cancelada ou negada no Olist. Use um usuário administrador e aceite as permissões do aplicativo.";
  }
  if (code === "login_required") {
    return "Login necessário no Olist. Tente conectar novamente.";
  }
  return `Erro OAuth no callback: ${error}`;
}
