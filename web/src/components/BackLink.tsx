import { Link, useNavigate } from 'react-router'
import { cls, Icon } from '../ui'

/** Goes back in history when there is somewhere to go, otherwise to the given fallback. */
export default function BackLink({ to, label = 'Back', className = '' }: { to: string; label?: string; className?: string }) {
  const nav = useNavigate()
  const canGoBack = typeof window !== 'undefined' && (window.history.state?.idx ?? 0) > 0
  const inner = (
    <>
      <Icon name="back" />
      <span>{label}</span>
    </>
  )
  return canGoBack ? (
    <button onClick={() => nav(-1)} className={`${cls.ghost} -ml-2 ${className}`}>
      {inner}
    </button>
  ) : (
    <Link to={to} className={`${cls.ghost} -ml-2 ${className}`}>
      {inner}
    </Link>
  )
}
