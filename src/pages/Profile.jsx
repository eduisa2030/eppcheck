export default function Profile({ user, onLogout, onBack, onNavigate }) {
  return (
    <div className="p-5 pb-28">
      <div className="flex items-center gap-3 mb-8">
        <button onClick={onBack} className="text-[#8A8A98] text-xl">←</button>
        <h1 className="text-2xl font-bold">Perfil</h1>
      </div>

      <div className="flex flex-col items-center mb-8">
        <div className="w-20 h-20 rounded-full bg-gradient-to-b from-[#2A2618] to-[#1A1810] border border-[#FFC21A]/40 flex items-center justify-center text-2xl font-bold text-[#FFC21A] mb-3">
          {user.name.slice(0,2).toUpperCase()}
        </div>
        <h2 className="text-xl font-semibold">{user.name}</h2>
        <p className="text-sm text-[#8A8A98]">{user.user}</p>
        <span className="mt-2 text-xs px-3 py-1 bg-[#FFC21A]/10 text-[#FFC21A] rounded-full capitalize">{user.rol}</span>
      </div>

      <div className="space-y-3">
        <button onClick={() => onNavigate('capture')} className="w-full bg-[#15151F] border border-white/5 rounded-2xl p-4 text-left font-medium">
          Capturar muestras
        </button>
        <button onClick={() => onNavigate('settings')} className="w-full bg-[#15151F] border border-white/5 rounded-2xl p-4 text-left font-medium">
          Ajustes
        </button>
        <button onClick={() => onNavigate('alerts')} className="w-full bg-[#15151F] border border-white/5 rounded-2xl p-4 text-left font-medium">
          Alertas
        </button>
        <button
          onClick={onLogout}
          className="w-full bg-red-500/10 text-red-400 font-medium py-4 rounded-2xl border border-red-500/20 mt-4"
        >
          Cerrar sesión
        </button>
      </div>
    </div>
  )
}
