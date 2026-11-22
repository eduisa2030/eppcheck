// Preparado para notificaciones por correo
// Se enviarán vía Apps Script o bot

export async function sendReport(data) {
  // data: { user, results, message, timestamp }
  console.log('Notificación de reporte:', data)
  // Llamada al endpoint cuando esté listo
  try {
    await fetch('https://script.google.com/macros/s/AKfycbz3WNpFqyN9iO65f9ba9B9jqzE-wSVaW0bH9y7rWBckkS2PcCkjOOQb4rjN4fGIvb7pvQ/exec?action=notify', {
      method: 'POST',
      body: JSON.stringify({
        type: 'reporte',
        ...data
      })
    })
  } catch (e) {
    console.warn('No se pudo enviar notificación', e)
  }
}

export async function sendRoundSummary(summary) {
  console.log('Resumen de ronda:', summary)
  try {
    await fetch('https://script.google.com/macros/s/AKfycbz3WNpFqyN9iO65f9ba9B9jqzE-wSVaW0bH9y7rWBckkS2PcCkjOOQb4rjN4fGIvb7pvQ/exec?action=summary', {
      method: 'POST',
      body: JSON.stringify(summary)
    })
  } catch (e) {}
}
