export default function CameraSwitchButton({ onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label="Cambiar cámara"
      className="absolute bottom-3 left-3 z-10 flex items-center gap-1.5 bg-black/50 backdrop-blur px-2.5 py-1.5 rounded-full text-[11px] text-white disabled:opacity-40"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" />
        <path d="M21 3v5h-5" />
        <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" />
        <path d="M3 21v-5h5" />
      </svg>
      Cambiar cámara
    </button>
  )
}
