import { getHistory } from './storage'

export function getStats() {
  const history = getHistory()
  if (!history.length) {
    return {
      total: 0,
      cumple: 0,
      noCumple: 0,
      porcentaje: 0,
      porElemento: { casco: 0, lentes: 0, chaleco: 0, guantes: 0 },
      recientes: []
    }
  }

  const total = history.length
  const cumple = history.filter(h => h.cumple).length
  const noCumple = total - cumple
  const porcentaje = Math.round((cumple / total) * 100)

  const faltas = { casco: 0, lentes: 0, chaleco: 0, guantes: 0 }
  history.forEach(h => {
    (h.missing || []).forEach(item => {
      if (faltas[item] !== undefined) faltas[item]++
    })
  })

  return {
    total,
    cumple,
    noCumple,
    porcentaje,
    porElemento: faltas,
    recientes: history.slice(0, 5)
  }
}
