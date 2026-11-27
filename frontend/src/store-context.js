import { createContext, useContext } from 'react';

// Keep context identity stable when the provider is edited during development.
export const StoreContext = createContext(null);
export function useStore() {
  return useContext(StoreContext);
}
