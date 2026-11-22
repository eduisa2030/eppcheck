import { useState, useEffect } from 'react'

export default function Settings({ onBack }) {
  const [sound, setSound] = useState(true)
  const [vibration, setVibration] = useState(true)

  useEffect(() => {
    const s = localStorage.getItem('epp_sound')
    const v = localStorage.getItem('epp_vibration')
    if (s !== null) setSound(s === 'true')
    if (v !== null) setVibration(v === 'true')
  }, [])

  const toggleSound = () => {
    const next = !sound
    setSound(next)
    localStorage.setItem('epp_sound', next)
  }
  const toggleVibration = () => {
    const next = !vibration
    setVibration(next)
    localStorage.setItem('epp_vibration', next)
  }

  return (
    <div className="p-5 pb-28">
      <div className="flex items-center gap-3 mb-8">
        <button onClick={onBack} className="text-[#8A8A98] text-xl">←</button>
        <h1 className="text-2xl font-bold">Ajustes</h1>
      </div>

      <div className="space-y-3">
        <div className="bg-[#15151F] border border-white/5 rounded-2xl p-4 flex items-center justify-between">
          <div>
            <p className="font-medium">Sonido</p>
            <p className="text-xs text-[#8A8A98]">Alerta al cambiar estado</p>
          </div>
          <button onClick={toggleSound} className={`w-12 h-7 rounded-full transition ${sound ? 'bg-[#FFC21A]' : 'bg-[#333]'} relative`}>
            <div className={`absolute top-0.5 w-6 h-6 bg-white rounded-full transition ${sound ? 'left-5' : 'left-0.5'}`} />
          </button>
        </div>

        <div className="bg-[#15151F] border border-white/5 rounded-2xl p-4 flex items-center justify-between">
          <div>
            <p className="font-medium">Vibración</p>
            <p className="text-xs text-[#8A8A98]">Feedback háptico</p>
          </div>
          <button onClick={toggleVibration} className={`w-12 h-7 rounded-full transition ${vibration ? 'bg-[#FFC21A]' : 'bg-[#333]'} relative`}>
            <div className={`absolute top-0.5 w-6 h-6 bg-white rounded-full transition ${vibration ? 'left-5' : 'left-0.5'}`} />
          </button>
        </div>
      </div>
    </div>
  )
}
