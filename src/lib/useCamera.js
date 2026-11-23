import { useCallback, useEffect, useRef, useState } from 'react'
import {
  flipFacing,
  loadFacingPreference,
  openCamera,
  saveFacingPreference,
  stopStream,
  videoInputs,
} from './camera'

function bindStream(video, stream) {
  if (!video) return
  video.srcObject = stream
  const play = video.play?.()
  if (play?.catch) play.catch(() => {})
}

/**
 * Una sola sesión de cámara para el video. Cambiar de lente detiene
 * los tracks actuales y vuelve a pedir getUserMedia, sin abrir otra sesión.
 */
export function useCamera(videoRef) {
  const [facing, setFacing] = useState(() => loadFacingPreference())
  const [canSwitch, setCanSwitch] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState('')
  const streamRef = useRef(null)
  const deviceIdRef = useRef(null)
  const facingRef = useRef(facing)
  const switchingRef = useRef(false)
  const aliveRef = useRef(true)

  const apply = useCallback((opened) => {
    streamRef.current = opened.stream
    deviceIdRef.current = opened.deviceId
    facingRef.current = opened.facing
    setFacing(opened.facing)
    saveFacingPreference(opened.facing)
    bindStream(videoRef.current, opened.stream)
  }, [videoRef])

  useEffect(() => {
    let cancelled = false
    let current = null
    aliveRef.current = true

    ;(async () => {
      try {
        const opened = await openCamera({ facing: loadFacingPreference() })
        if (cancelled) {
          stopStream(opened.stream)
          return
        }
        current = opened.stream
        apply(opened)
        const inputs = await videoInputs()
        if (!cancelled) setCanSwitch(inputs.length > 1)
      } catch {
        if (!cancelled) setError('No se pudo acceder a la cámara. Revisa los permisos.')
      }
    })()

    return () => {
      cancelled = true
      aliveRef.current = false
      stopStream(current)
      stopStream(streamRef.current)
      streamRef.current = null
    }
  }, [videoRef, apply])

  const switchCamera = async () => {
    if (!canSwitch || switchingRef.current) return
    switchingRef.current = true
    setSwitching(true)
    const previousFacing = facingRef.current
    const previousDeviceId = deviceIdRef.current
    stopStream(streamRef.current)
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null

    try {
      const opened = await openCamera({
        facing: flipFacing(previousFacing),
        previousDeviceId,
        switching: true,
      })
      if (!aliveRef.current) {
        stopStream(opened.stream)
        return
      }
      apply(opened)
      setError('')
    } catch (err) {
      console.warn('No se pudo cambiar de cámara', err)
      try {
        const restored = await openCamera({ facing: previousFacing })
        if (!aliveRef.current) {
          stopStream(restored.stream)
          return
        }
        apply(restored)
      } catch {
        setError('No se pudo acceder a la cámara. Revisa los permisos.')
      }
    } finally {
      switchingRef.current = false
      setSwitching(false)
    }
  }

  return {
    facing,
    mirrored: facing === 'user',
    canSwitch,
    switching,
    error,
    switchCamera,
  }
}
