// Parte cada modelo de Teachable Machine (models-src/<id>/) en:
//   - el extractor MobileNet truncado (igual en todos los modelos) -> public/models/base-<hash>/
//   - la cabeza densa de cada modelo -> public/models/<id>/head.json + head.bin
// y escribe src/lib/modelManifest.json para la app.
// Los pesos se copian byte a byte; no se recalcula ni se cuantiza nada.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const srcDir = path.join(root, 'models-src')
const outDir = path.join(root, 'public', 'models')
const items = JSON.parse(fs.readFileSync(path.join(srcDir, 'models.json'), 'utf8'))

const DTYPE_BYTES = { float32: 4, int32: 4, bool: 1 }
const size = w => w.shape.reduce((a, b) => a * b, 1) * (DTYPE_BYTES[w.dtype] || 4)
const md5 = buf => createHash('md5').update(buf).digest('hex')

// Los nombres de los contenedores cambian entre exportaciones (sequential_1/5, model1/2...).
function normalizeTopology(node) {
  return JSON.stringify(node)
    .replace(/"sequential_\d+"/g, '"S"')
    .replace(/"model\d*"/g, '"M"')
    .replace(/"global_average_pooling2d_GlobalAveragePooling2D\d*"/g, '"G"')
}

function readModel(tmId) {
  const dir = path.join(srcDir, tmId)
  const json = JSON.parse(fs.readFileSync(path.join(dir, 'model.json'), 'utf8'))
  const metadata = JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf8'))
  const buffers = []
  const specs = []
  for (const group of json.weightsManifest) {
    for (const p of group.paths) buffers.push(fs.readFileSync(path.join(dir, p)))
    specs.push(...group.weights)
  }
  const data = Buffer.concat(buffers)
  const layers = json.modelTopology.config.layers
  if (layers.length !== 2) throw new Error(`${tmId}: se esperaban 2 bloques (extractor y cabeza)`)
  const [baseNode, headNode] = layers
  const headLayerNames = new Set(headNode.config.layers.map(l => l.config.name))
  const base = { specs: [], parts: [] }
  const head = { specs: [], parts: [] }
  let offset = 0
  for (const spec of specs) {
    const n = size(spec)
    const bytes = data.subarray(offset, offset + n)
    offset += n
    const target = headLayerNames.has(spec.name.split('/')[0]) ? head : base
    target.specs.push(spec)
    target.parts.push(bytes)
  }
  if (offset !== data.length) throw new Error(`${tmId}: los pesos no cuadran (${offset} != ${data.length})`)
  return {
    tmId, json, metadata, baseNode, headNode,
    base: { specs: base.specs, data: Buffer.concat(base.parts) },
    head: { specs: head.specs, data: Buffer.concat(head.parts) },
  }
}

function writeModel(dir, file, json, node, specs, data) {
  fs.mkdirSync(dir, { recursive: true })
  const binName = file.replace(/\.json$/, '.bin')
  const out = {
    modelTopology: { ...json.modelTopology, class_name: node.class_name, config: node.config },
    format: json.format,
    generatedBy: json.generatedBy,
    convertedBy: 'eppcheck split-models',
    weightsManifest: [{ paths: [`./${binName}`], weights: specs }],
  }
  fs.writeFileSync(path.join(dir, file), JSON.stringify(out))
  fs.writeFileSync(path.join(dir, binName), data)
}

const models = Object.entries(items).map(([item, tmId]) => ({ item, ...readModel(tmId) }))
const bases = new Map()
const manifest = { bases: {}, items: {} }

for (const m of models) {
  const key = md5(Buffer.concat([m.base.data, Buffer.from(JSON.stringify(m.base.specs)), Buffer.from(normalizeTopology(m.baseNode))]))
  const baseId = `base-${key.slice(0, 10)}`
  if (!bases.has(baseId)) {
    bases.set(baseId, m)
    const dir = path.join(outDir, baseId)
    writeModel(dir, 'model.json', m.json, m.baseNode, m.base.specs, m.base.data)
    manifest.bases[baseId] = {
      model: `models/${baseId}/model.json`,
      weights: `models/${baseId}/model.bin`,
      bytes: m.base.data.length,
      hash: md5(m.base.data),
    }
  }
  const headHash = md5(m.head.data).slice(0, 10)
  const dir = path.join(outDir, m.tmId)
  writeModel(dir, `head-${headHash}.json`, m.json, m.headNode, m.head.specs, m.head.data)
  manifest.items[m.item] = {
    tm: m.tmId,
    base: baseId,
    model: `models/${m.tmId}/head-${headHash}.json`,
    weights: `models/${m.tmId}/head-${headHash}.bin`,
    bytes: m.head.data.length,
    hash: md5(m.head.data),
    labels: m.metadata.labels,
    imageSize: m.metadata.imageSize || 224,
    grayscale: Boolean(m.metadata.grayscale),
  }
  console.log(`${m.item} (${m.tmId}): extractor ${baseId} ${m.base.data.length} B, cabeza ${m.head.data.length} B, clases ${JSON.stringify(m.metadata.labels)}`)
}

// Borra carpetas que ya no se usan para no publicar pesos viejos.
const keep = new Set([...bases.keys(), ...models.map(m => m.tmId)])
for (const name of fs.readdirSync(outDir)) {
  if (!keep.has(name)) fs.rmSync(path.join(outDir, name), { recursive: true, force: true })
}
for (const m of models) {
  const dir = path.join(outDir, m.tmId)
  const current = path.basename(manifest.items[m.item].model)
  for (const f of fs.readdirSync(dir)) {
    if (f.replace(/\.bin$/, '.json') !== current) fs.rmSync(path.join(dir, f))
  }
}
fs.writeFileSync(path.join(root, 'src', 'lib', 'modelManifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(`extractores distintos: ${bases.size} (${[...bases.keys()].join(', ')})`)
