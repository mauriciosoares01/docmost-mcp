export function jsonContent(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

export function cancelledResult() {
  return {
    content: [{ type: "text" as const, text: "Operação cancelada pelo usuário." }],
  };
}

// Erros aqui viram a mensagem que o modelo vê — nunca deixar vazar corpo de
// resposta bruto, headers ou stack trace; sempre uma frase legível (§5 da
// arquitetura: o Docmost decide permissão, o MCP só repassa de forma legível).
// Exceção controlada: para status inesperados (ex. 400 de validação), repassar
// só o campo `message` do corpo de erro do Docmost — é a mesma string que a UI
// do Docmost já exibe ao usuário final, então não é informação mais sensível
// do que o produto já expõe; sem isso, todo erro de payload vira uma adivinhação.
export async function parseDocmostResponse(res: Response, notFoundMessage?: string): Promise<unknown> {
  if (res.status === 403) {
    throw new Error("Sem permissão para acessar este recurso no Docmost.");
  }
  if (res.status === 404) {
    throw new Error(notFoundMessage ?? "Recurso não encontrado no Docmost.");
  }
  if (!res.ok) {
    throw new Error(`Docmost retornou status ${res.status}: ${await extractErrorMessage(res)}`);
  }
  return res.json();
}

async function extractErrorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string | string[] };
    if (Array.isArray(body.message)) return body.message.join("; ");
    if (typeof body.message === "string") return body.message;
  } catch {
    // corpo não é JSON ou não tem `message` — segue com mensagem genérica abaixo.
  }
  return "sem detalhe adicional retornado pela API.";
}
