import { useRef, useState } from 'react'
import { useCamera } from '../lib/useCamera'
import CameraSwitchButton from '../components/CameraSwitchButton'

export default function Capture({ onBack }) {
  const videoRef = useRef(null)
  const { mirrored, canSwitch, switching, error, switchCamera } = useCamera(videoRef)
  const [label, setLabel] = useState('completo')
  const [missing, setMissing] = useState([])
  const [saved, setSaved] = useState(false)
  const [preview, setPreview] = useState(null)

  const takePhoto = () => {
    const video = videoRef.current
    if (!video) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (mirrored) {
      ctx.translate(canvas.width, 0)
      ctx.scale(-1, 1)
    }
    ctx.drawImage(video, 0, 0)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
    setPreview(dataUrl)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    // Aquí después se sube a Drive
    console.log('Muestra capturada:', { label, missing, timestamp: new Date().toISOString() })
  }

  const toggleMissing = (item) => {
    setMissing(prev => prev.includes(item) ? prev.filter(i => i !== item) : [...prev, item])
  }

  return (
    <div className="min-h-screen bg-black pb-28">
      <div className="absolute top-0 left-0 right-0 p-4 flex items-center justify-between z-10">
        <button onClick={onBack} className="w-10 h-10 rounded-full bg-black/50 backdrop-blur flex items-center justify-center text-white">←</button>
        <span className="text-sm font-medium">Capturar muestra</span>
        <div className="w-10" />
      </div>

      <div className="relative">
        <video ref={videoRef} autoPlay playsInline muted className={`w-full h-[55vh] object-cover ${mirrored ? '-scale-x-100' : ''}`} />
        {canSwitch && <CameraSwitchButton onClick={switchCamera} disabled={switching} />}
        {error && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center p-6 text-center text-sm text-white">
            {error}
          </div>
        )}
      </div>

      <div className="p-5 space-y-4">
        <div>
          <p className="text-xs text-[#8A8A98] mb-2 tracking-wide">ETIQUETA</p>
          <div className="grid grid-cols-2 gap-2">
            {['completo', 'incompleto'].map(l => (
              <button
                key={l}
                onClick={() => setLabel(l)}
                className={`py-3 rounded-xl capitalize text-sm font-medium ${label === l ? 'bg-[#FFC21A] text-black' : 'bg-[#15151F] border border-white/10'}`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>

        {label === 'incompleto' && (
          <div>
            <p className="text-xs text-[#8A8A98] mb-2 tracking-wide">¿QUÉ FALTA?</p>
            <div className="flex flex-wrap gap-2">
              {['casco', 'lentes', 'chaleco', 'guantes'].map(item => (
                <button
                  key={item}
                  onClick={() => toggleMissing(item)}
                  className={`px-3 py-1.5 rounded-full text-xs capitalize ${missing.includes(item) ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-[#15151F] border border-white/10'}`}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={takePhoto}
          className="w-full bg-gradient-to-b from-[#FFD65A] to-[#FFC21A] text-black font-semibold py-4 rounded-2xl"
        >
          {saved ? '¡Muestra guardada!' : 'Tomar foto'}
        </button>

        {preview && (
          <div className="mt-2">
            <p className="text-xs text-[#8A8A98] mb-1">Última captura</p>
            <img src={preview} alt="preview" className="w-full rounded-2xl border border-white/10" />
          </div>
        )}
      </div>
    </div>
  )
}
