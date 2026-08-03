import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';

export function createMswQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false },
    },
  });
}

export function renderWithMsw(
  element: ReactElement,
  options: { route?: string; client?: QueryClient } = {},
): RenderResult & { client: QueryClient } {
  const client = options.client ?? createMswQueryClient();
  const rendered = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[options.route ?? '/']}>
        {element}
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...rendered, client };
}
