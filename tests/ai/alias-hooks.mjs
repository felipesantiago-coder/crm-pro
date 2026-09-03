/**
 * alias-hooks.mjs — Resolve imports do estilo Next (aliases `@/…` e
 * relative sem extensão) para o node:test com strip-types.
 * Apenas resolução — nada de transformação de código.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)); // tests/ai
const SRC = path.resolve(HERE, '..', '..', 'src');

async function tryResolve(basePath, context, nextResolve) {
  try {
    return await nextResolve(pathToFileURL(basePath).href, context);
  } catch (err) {
    // ERR_MODULE_NOT_FOUND → tenta com .ts (bundler-style extensionless)
    return await nextResolve(`${pathToFileURL(basePath).href}.ts`, context);
  }
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    return tryResolve(path.join(SRC, specifier.slice(2)), context, nextResolve);
  }
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !specifier.endsWith('.ts') && !specifier.endsWith('.mjs') && !specifier.endsWith('.json')) {
    // relativo dentro de src com extensão implícita
    if (context.parentURL && fileURLToPath(context.parentURL).startsWith(SRC)) {
      const dir = path.dirname(fileURLToPath(context.parentURL));
      return tryResolve(path.resolve(dir, specifier), context, nextResolve);
    }
  }
  return nextResolve(specifier, context);
}
