import { createContext, useContext } from 'react'
import type { User } from './api'

export const UserContext = createContext<User | null>(null)

export function useUser(): User {
  const u = useContext(UserContext)
  if (!u) throw new Error('useUser outside of an authenticated tree')
  return u
}

export function useIsAdmin(): boolean {
  return useContext(UserContext)?.role === 'admin'
}
