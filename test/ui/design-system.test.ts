// Testes de T-140 (fase4-design-system-shell-acesso): os tokens de tema do
// protótipo Stitch (cores, espaçamentos, tipografia) viram classes Tailwind
// que resolvem para os valores do `tailwind.config` do `code.html`
// (AC-345), e as fontes/ícones do protótipo são carregados em qualquer
// página (AC-346). O teste compila o `globals.css` de verdade com o motor
// do Tailwind (não regex em CSS) para provar que a classe existe e resolve.
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { compile } from 'tailwindcss';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, '../..');
const GLOBALS_CSS_PATH = path.join(ROOT, 'src/app/globals.css');
const LAYOUT_PATH = path.join(ROOT, 'src/app/layout.tsx');

// Pacotes importados por `@import "<pacote>"` em globals.css cujo ponto de
// entrada de CSS não é o `main`/`exports "."` padrão do Node — resolvidos
// manualmente porque o `compile()` do Tailwind não embute um resolvedor de
// módulos (ele delega isso a quem o chama, normalmente um bundler).
const IMPORTS_CONHECIDOS: Record<string, [pacote: string, relativo: string]> = {
  tailwindcss: ['tailwindcss', 'index.css'],
  'tw-animate-css': ['tw-animate-css', 'dist/tw-animate.css'],
  'shadcn/tailwind.css': ['shadcn', 'dist/tailwind.css'],
};

function acharRaizDoPacote(pacote: string, base: string): string {
  let dir = base;
  for (let i = 0; i < 10; i++) {
    const candidato = path.join(dir, 'node_modules', pacote);
    if (existsSync(path.join(candidato, 'package.json'))) return candidato;
    const pai = path.dirname(dir);
    if (pai === dir) break;
    dir = pai;
  }
  throw new Error(`pacote não encontrado: ${pacote}`);
}

async function carregarFolhaDeEstilo(id: string, base: string) {
  let resolvido: string;
  if (id.startsWith('.') || id.startsWith('/')) {
    resolvido = path.resolve(base, id);
  } else if (IMPORTS_CONHECIDOS[id]) {
    const [pacote, relativo] = IMPORTS_CONHECIDOS[id];
    resolvido = path.join(acharRaizDoPacote(pacote, base), relativo);
  } else {
    resolvido = require.resolve(id, { paths: [base] });
  }
  return {
    base: path.dirname(resolvido),
    content: readFileSync(resolvido, 'utf8'),
    path: resolvido,
  };
}

async function construirCss(candidatos: string[]): Promise<string> {
  const css = readFileSync(GLOBALS_CSS_PATH, 'utf8');
  const { build } = await compile(css, {
    base: path.dirname(GLOBALS_CSS_PATH),
    loadStylesheet: carregarFolhaDeEstilo,
  });
  return build(candidatos);
}

function regraDe(css: string, seletor: string): string {
  // Extrai o corpo de uma regra simples de uma camada (sem aninhamento) pelo
  // seletor exato, ex.: ".bg-primary { background-color: ...; }".
  const escapado = seletor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escapado}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`regra não encontrada no CSS compilado: ${seletor}`);
  return match[1];
}

describe('T-140: tokens de tema do protótipo (AC-345)', () => {
  test('bg-primary resolve para a cor primária do protótipo (#0954c9) @spec:AC-345', async () => {
    const css = await construirCss(['bg-primary']);
    expect(css).toMatch(/\.bg-primary\s*\{\s*background-color:\s*var\(--primary\)/);
    expect(css).toMatch(/--primary:\s*#0954c9;/i);
  });

  test('bg-sidebar-surface resolve para a cor do menu do protótipo (#1E293B) @spec:AC-345', async () => {
    const css = await construirCss(['bg-sidebar-surface']);
    expect(regraDe(css, '.bg-sidebar-surface')).toContain('var(--color-sidebar-surface)');
    expect(css).toMatch(/--color-sidebar-surface:\s*#1e293b;/i);
  });

  test('text-text-secondary resolve para a cor de texto secundário do protótipo @spec:AC-345', async () => {
    const css = await construirCss(['text-text-secondary']);
    expect(regraDe(css, '.text-text-secondary')).toContain('var(--color-text-secondary)');
    expect(css).toMatch(/--color-text-secondary:\s*#64748b;/i);
  });

  test('bg-danger-surface resolve para a cor de erro do protótipo @spec:AC-345', async () => {
    const css = await construirCss(['bg-danger-surface']);
    expect(regraDe(css, '.bg-danger-surface')).toContain('var(--color-danger-surface)');
    expect(css).toMatch(/--color-danger-surface:\s*#fee2e2;/i);
  });

  test('font-headline-lg resolve para a família de título (Plus Jakarta Sans) do protótipo @spec:AC-345', async () => {
    const css = await construirCss(['font-headline-lg']);
    expect(regraDe(css, '.font-headline-lg')).toContain('var(--font-headline-lg)');
    expect(css).toMatch(/--font-headline-lg:\s*var\(--font-plus-jakarta-sans\)/i);
  });

  test('p-margin resolve para o espaçamento do protótipo (1.75rem) @spec:AC-345', async () => {
    const css = await construirCss(['p-margin']);
    expect(regraDe(css, '.p-margin')).toContain('var(--spacing-margin)');
    expect(css).toMatch(/--spacing-margin:\s*1\.75rem;/i);
  });

  test('canvas de fundo do protótipo (#F4F6FA) existe como token utilizável @spec:AC-345', async () => {
    const css = await construirCss(['bg-background-canvas']);
    expect(regraDe(css, '.bg-background-canvas')).toContain('var(--color-background-canvas)');
    expect(css).toMatch(/--color-background-canvas:\s*#f4f6fa;/i);
  });

  test('escala de texto do protótipo (headline-lg: 24px/32px) resolve corretamente @spec:AC-345', async () => {
    const css = await construirCss(['text-headline-lg']);
    const regra = regraDe(css, '.text-headline-lg');
    expect(regra).toContain('var(--text-headline-lg)');
    expect(css).toMatch(/--text-headline-lg:\s*24px;/);
    expect(css).toMatch(/--text-headline-lg--line-height:\s*32px;/);
  });
});

describe('T-140: fontes e ícones do protótipo (AC-346)', () => {
  const layoutSrc = readFileSync(LAYOUT_PATH, 'utf8');

  test('Plus Jakarta Sans e Inter são carregadas por next/font/local (arquivos no repositório) @spec:AC-346', () => {
    expect(layoutSrc).toMatch(/from\s+["']next\/font\/local["']/);
    expect(layoutSrc).toMatch(/plus-jakarta-sans-latin-wght-normal\.woff2/);
    expect(layoutSrc).toMatch(/inter-latin-wght-normal\.woff2/);
    // As fontes precisam estar disponíveis em toda página: aplicadas no
    // elemento raiz do layout (via variável CSS), não só numa rota isolada.
    expect(layoutSrc).toMatch(/--font-plus-jakarta-sans/);
    expect(layoutSrc).toMatch(/--font-inter/);
  });

  test('os ícones Material Symbols Outlined (com FILL) são carregados em toda página @spec:AC-346', () => {
    expect(layoutSrc).toMatch(/fonts\.googleapis\.com\/css2\?family=Material\+Symbols\+Outlined/);
    expect(layoutSrc).toMatch(/FILL/);
  });

  test('a classe .material-symbols-outlined usada pelo protótipo existe no CSS global @spec:AC-346', async () => {
    const css = await construirCss([]);
    expect(regraDe(css, '.material-symbols-outlined')).toContain('font-family: "Material Symbols Outlined"');
  });

  test('as variáveis de fonte carregadas em layout.tsx alimentam os tokens de fontFamily do tema @spec:AC-346', async () => {
    const css = await construirCss(['font-headline-lg', 'font-body-md']);
    expect(css).toMatch(/--font-headline-lg:\s*var\(--font-plus-jakarta-sans\)/i);
    expect(css).toMatch(/--font-body-md:\s*var\(--font-inter\)/i);
  });
});
