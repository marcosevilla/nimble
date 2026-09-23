/**
 * DataProvider React context + module-level accessor for non-React code (Zustand stores).
 *
 * React components / hooks: use `useDataProvider()` hook
 * Zustand stores / plain modules: use `getDataProvider()` (initialized at app startup)
 */

import { createContext, useContext, useEffect } from 'react'
import type { DataProvider } from './data-provider'
import { connectProviderEvents } from './provider-events'

// ── React Context ──

const DataProviderContext = createContext<DataProvider | null>(null)

export function DataProviderRoot({
  provider,
  children,
}: {
  provider: DataProvider
  children: React.ReactNode
}) {
  // Every window root shares one event bridge (data + focus invalidations).
  useEffect(() => connectProviderEvents(), [])
  return (
    <DataProviderContext.Provider value={provider}>
      {children}
    </DataProviderContext.Provider>
  )
}

export function useDataProvider(): DataProvider {
  const ctx = useContext(DataProviderContext)
  if (!ctx) {
    throw new Error('useDataProvider must be used within <DataProviderRoot>')
  }
  return ctx
}

// ── Module-level accessor (for Zustand stores) ──

let _provider: DataProvider | null = null

/**
 * Called once at app startup, before any store actions run.
 * Sets the module-level DataProvider so stores can access it
 * without React context.
 */
export function setDataProvider(dp: DataProvider): void {
  _provider = dp
}

/**
 * Returns the DataProvider for use in Zustand stores and other
 * non-React code. Throws if called before setDataProvider().
 */
export function getDataProvider(): DataProvider {
  if (!_provider) {
    throw new Error('getDataProvider() called before setDataProvider() — ensure provider is initialized at app startup')
  }
  return _provider
}
