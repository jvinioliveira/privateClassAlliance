const DEFAULT_FRIENDLY_ERROR = 'Não foi possível concluir a ação. Tente novamente.';

export const getFriendlyErrorMessage = (error: unknown, fallback = DEFAULT_FRIENDLY_ERROR) => {
  const raw = error instanceof Error ? error.message : '';
  const normalized = raw.toLowerCase();

  if (!normalized) return fallback;
  if (normalized.includes('network') || normalized.includes('fetch')) {
    return 'Falha de conexão. Verifique sua internet e tente novamente.';
  }
  if (normalized.includes('unauthorized') || normalized.includes('invalid login credentials')) {
    return 'Dados de acesso inválidos. Confira e tente novamente.';
  }
  if (normalized.includes('session') || normalized.includes('jwt') || normalized.includes('token')) {
    return 'Sua sessão expirou. Faça login novamente.';
  }
  if (normalized.includes('permission') || normalized.includes('access denied') || normalized.includes('forbidden')) {
    return 'Você não tem permissão para esta ação.';
  }
  if (normalized.includes('duplicate') || normalized.includes('already exists') || normalized.includes('23505')) {
    return 'Já existe um registro com estes dados.';
  }

  return fallback;
};

