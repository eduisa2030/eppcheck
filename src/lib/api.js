const BASE = 'https://script.google.com/macros/s/AKfycbz3WNpFqyN9iO65f9ba9B9jqzE-wSVaW0bH9y7rWBckkS2PcCkjOOQb4rjN4fGIvb7pvQ/exec'

export async function login(user, pass) {
  const url = `${BASE}?action=login&user=${encodeURIComponent(user)}&pass=${encodeURIComponent(pass)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error('Error de red')
  return res.json()
}

export async function saveScan(data) {
  try {
    const res = await fetch(BASE + '?action=saveScan', {
      method: 'POST',
      body: JSON.stringify(data)
    })
    return await res.json()
  } catch (e) {
    console.warn('No se pudo guardar en Sheets', e)
    return { ok: false }
  }
}

export async function getModelUrls() {
  try {
    const url = BASE + '?action=getModels'
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) })
    const data = await res.json()
    return data.models || {}
  } catch {
    return {}
  }
}
