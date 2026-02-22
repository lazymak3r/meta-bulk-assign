import {
  QueryClient,
  QueryClientProvider,
  QueryCache,
  MutationCache,
} from "react-query";

/**
 * Sets up the QueryClientProvider from react-query.
 * @desc See: https://react-query.tanstack.com/reference/QueryClientProvider#_top
 */
export function QueryProvider({ children }) {
  const client = new QueryClient({
    queryCache: new QueryCache(),
    mutationCache: new MutationCache(),
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000, // 5 minutes — don't refetch on page navigation
        cacheTime: 10 * 60 * 1000, // 10 minutes — keep in memory
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
