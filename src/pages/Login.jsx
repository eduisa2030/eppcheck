import { useEffect, useState } from 'react'
import { login } from '../lib/api'
import { subscribeModelProgress } from '../lib/modelCache'
import { version } from '../../package.json'

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [modelProgress, setModelProgress] = useState({ ready: false, loaded: 0, total: 0 })

  useEffect(() => subscribeModelProgress(setModelProgress), [])

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const result = await login(username.trim(), password)
      if (result.ok) {
        onLogin({ name: result.name, user: result.user, rol: result.rol })
      } else {
        setError(result.error || 'Credenciales incorrectas')
      }
    } catch (err) {
      setError('Error de conexión')
      console.error(err)
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-[#0B0B12]">
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <div className="w-16 h-16 mx-auto mb-4 bg-[#FFC21A] rounded-2xl flex items-center justify-center text-2xl font-bold text-black">EPP</div>
          <h1 className="text-3xl font-bold tracking-tight">EPPCheck</h1>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs text-[#8A8A98] mb-1.5 tracking-wide">USUARIO</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full bg-[#15151F] border border-white/10 rounded-xl px-4 py-3.5 text-white outline-none focus:border-[#FFC21A] transition"
              placeholder="safe_id_..."
              autoCapitalize="none"
              required
            />
          </div>
          <div>
            <label className="block text-xs text-[#8A8A98] mb-1.5 tracking-wide">CONTRASEÑA</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full bg-[#15151F] border border-white/10 rounded-xl px-4 py-3.5 text-white outline-none focus:border-[#FFC21A] transition"
              placeholder="••••••••"
              required
            />
          </div>
          {error && <p className="text-red-400 text-sm text-center">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-b from-[#FFD65A] to-[#FFC21A] text-black font-semibold py-4 rounded-xl mt-2 disabled:opacity-60"
          >
            {loading ? 'Verificando...' : 'Ingresar'}
          </button>
        </form>
        <p className="text-center text-[#8A8A98] text-xs mt-8">versión {version}</p>
        {!modelProgress.ready ? (
          <p className="text-center text-[#8A8A98] text-xs mt-2">
            {modelProgress.stage === 'gpu'
              ? `Preparando modelos en el teléfono… ${modelProgress.warmed || 0}/${modelProgress.total}`
              : (modelProgress.total
                ? `Preparando modelos… ${modelProgress.loaded}/${modelProgress.total}`
                : 'Preparando modelos…')}
          </p>
        ) : (!modelProgress.handsReady && modelProgress.models?.guantes) ? (
          <p className="text-center text-[#8A8A98] text-xs mt-2">Listo para escanear. Preparando guantes…</p>
        ) : null}
      </div>
    </div>
  )
}
