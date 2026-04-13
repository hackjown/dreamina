function getBrowserApiOrigin(): string {
  if (typeof window === 'undefined') {
    return 'http://127.0.0.1:3001';
  }

  const { protocol, hostname } = window.location;
  return `${protocol}//${hostname}:3001`;
}

export function getApiBase(): string {
  if (import.meta.env.DEV) {
    return `${getBrowserApiOrigin()}/api`;
  }

  return '/api';
}

export function resolveApiUrl(path: string): string {
  if (!path.startsWith('/api')) {
    return path;
  }

  if (import.meta.env.DEV) {
    return `${getBrowserApiOrigin()}${path}`;
  }

  return path;
}
