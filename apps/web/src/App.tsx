import { useState, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router';
import { createQueryClient } from './lib/query-client.js';
import { AppRoutes } from './routes.js';

export function App(): ReactNode {
  // Created in state, not at module scope: a module-level client is shared
  // across every test in a file and leaks cached data between them.
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
