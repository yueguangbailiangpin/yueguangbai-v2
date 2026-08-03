import { http, HttpResponse, type HttpHandler, type JsonBodyType } from 'msw';

export const MSW_ORIGIN = 'http://localhost';

export function apiUrl(path: `/api/${string}`): string {
  return `${MSW_ORIGIN}${path}`;
}

export function jsonHandler(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: `/api/${string}`,
  payload: JsonBodyType,
  status = 200,
  headers?: Record<string, string>,
): HttpHandler {
  const resolver = () => HttpResponse.json(payload, {
    status,
    ...(headers === undefined ? {} : { headers }),
  });
  const url = apiUrl(path);
  if (method === 'GET') return http.get(url, resolver);
  if (method === 'POST') return http.post(url, resolver);
  if (method === 'PUT') return http.put(url, resolver);
  if (method === 'PATCH') return http.patch(url, resolver);
  return http.delete(url, resolver);
}

export const handlers: readonly HttpHandler[] = Object.freeze([]);
