export default function Alerts({ onBack }) {
  return (
    <div className="p-5 pb-28">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="text-[#8A8A98]">←</button>
        <h1 className="text-2xl font-bold">Alertas</h1>
      </div>
      <div className="space-y-3">
        <div className="bg-[#15151F] border border-red-500/20 rounded-2xl p-4">
          <p className="font-medium text-red-400">No cumple · Faltan guantes</p>
          <p className="text-xs text-[#8A8A98] mt-1">Luis Mora · Ensamble · hace 6 min</p>
        </div>
        <div className="bg-[#15151F] border border-white/5 rounded-2xl p-4">
          <p className="font-medium">Automatización de notificaciones</p>
          <p className="text-xs text-[#8A8A98] mt-1">Próximamente: envío por correo o WhatsApp</p>
        </div>
      </div>
    </div>
  )
}
