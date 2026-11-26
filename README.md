# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.

## Modelos (Teachable Machine)

- Los modelos exportados van en `models-src/<id>/` y `models-src/models.json` dice qué id usa cada pieza.
- `npm run build` corre `scripts/split-models.mjs`, que comprueba que los modelos comparten el mismo extractor MobileNet,
  lo publica una sola vez en `public/models/base-<hash>/` y deja solo la cabeza de cada pieza en `public/models/<id>/`.
  También genera `src/lib/modelManifest.json`.
- La app descarga y prepara el extractor una vez; en cada paso corre solo la cabeza de la pieza que toca.
- Despliegue: `npm run deploy` (Cloudflare Pages, https://eppcheck.pages.dev).
