'use client';

/**
 * Renderizador de Markdown das respostas do Nexo (prompt §14.1 e §22).
 *
 * Estratégia em duas fases, com sanitização centralizada:
 *   1. ESCAPAR todo o texto bruto (o HTML vindo da IA nunca é interpretado);
 *   2. gerar marcação nossa (títulos, listas, tabelas, code, links) sobre
 *      o texto já escapado;
 *   3. sanitizar com DOMPurify (defesa em profundidade, allowlist fechada).
 *
 * Links: apenas http/https passam (DOMPurify já bloqueia javascript:),
 * ganham target="_blank" + rel="noopener noreferrer" e indicação visual.
 */
import React, { useMemo } from 'react';
import DOMPurify from 'dompurify';
import {
  MD_PLACEHOLDER_END,
  MD_PLACEHOLDER_START,
} from './assistant.constants';
import { cn } from '@/lib/utils';

const ALLOWED_TAGS = [
  // OBRIGATÓRIO: com ALLOWED_TAGS customizado + KEEP_CONTENT:false, o DOMPurify
  // (3.4.x) só preserva nós de texto se '#text' estiver na allowlist
  // (sanitize adiciona '#text' automaticamente APENAS quando KEEP_CONTENT=true).
  // Sem isso, TODAS as respostas do assistente ficam vazias — o texto é removido
  // e apenas as tags sobrevivem (visível: bolha em branco; copiável: o botão
  // copia message.content, não o HTML renderizado).
  '#text',
  'h3',
  'h4',
  'p',
  'ul',
  'ol',
  'li',
  'strong',
  'em',
  'code',
  'pre',
  'a',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'br',
  'blockquote',
] as const;

const ALLOWED_ATTR = ['href', 'target', 'rel', 'class'] as const;

/** Registrado uma única vez por aba (prompt §22 — sanitização centralizada). */
let linkHookInstalled = false;
function installLinkHook(): void {
  if (linkHookInstalled || typeof window === 'undefined') return;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
      node.classList.add('nexo-external-link');
    }
  });
  linkHookInstalled = true;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Transformações inline sobre texto JÁ escapado. */
function renderInline(escaped: string): string {
  // 1. Protege spans de código com placeholders antes das demais regras.
  //    O conteúdo já está escapado — as entidades permanecem (renderizam
  //    como texto literal dentro de <code>; NUNCA re-introduzir HTML).
  const codeSpans: string[] = [];
  let withPlaceholders = escaped.replace(
    /`([^`]+)`/g,
    (_, code: string) => {
      codeSpans.push(`<code>${code}</code>`);
      return `${MD_PLACEHOLDER_START}${codeSpans.length - 1}${MD_PLACEHOLDER_END}`;
    },
  );

  // 2. Links [texto](https://…) — apenas http/https.
  withPlaceholders = withPlaceholders.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2">$1</a>',
  );

  // 3. Negrito e itálico.
  withPlaceholders = withPlaceholders
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');

  // 4. Restaura os spans de código.
  withPlaceholders = withPlaceholders.replace(
    new RegExp(
      `${MD_PLACEHOLDER_START}(\\d+)${MD_PLACEHOLDER_END}`,
      'g',
    ),
    (_, index: string) => codeSpans[Number(index)] ?? '',
  );

  return withPlaceholders;
}

function renderBlocks(text: string): string {
  const lines = escapeHtml(text).split(/\r?\n/);
  const out: string[] = [];

  let paragraph: string[] = [];
  let listType: 'ul' | 'ol' | null = null;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      out.push(`<p>${paragraph.map(renderInline).join('<br/>')}</p>`);
      paragraph = [];
    }
  };
  const flushList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Bloco de código cercado (``` … ```)
    if (/^```/.test(trimmed)) {
      flushParagraph();
      flushList();
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i += 1;
      }
      out.push(`<pre><code>${codeLines.join('\n')}</code></pre>`);
      continue;
    }

    // Tabelas: linha atual e a próxima são separadores/colunas (| a | b |)
    if (
      /^\|.+\|/.test(trimmed) &&
      i + 1 < lines.length &&
      /^\|[\s:|-]+\|?$/.test(lines[i + 1].trim())
    ) {
      flushParagraph();
      flushList();
      const parseRow = (row: string): string[] =>
        row
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((cell) => cell.trim());
      const headers = parseRow(trimmed);
      i += 2; // pula separador
      const bodyRows: string[] = [];
      while (i < lines.length && /^\|.+\|/.test(lines[i].trim())) {
        bodyRows.push(lines[i].trim());
        i += 1;
      }
      i -= 1;
      out.push(
        `<table><thead><tr>${headers
          .map((h) => `<th>${renderInline(h)}</th>`)
          .join('')}</tr></thead><tbody>${bodyRows
          .map((row) => {
            const cells = parseRow(row);
            return `<tr>${cells
              .map((c) => `<td>${renderInline(c)}</td>`)
              .join('')}</tr>`;
          })
          .join('')}</tbody></table>`,
      );
      continue;
    }

    if (trimmed === '') {
      flushParagraph();
      flushList();
      continue;
    }

    // Títulos (# a ####) — escala de chat usa h3/h4
    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const tag = heading[1].length <= 3 ? 'h3' : 'h4';
      out.push(`<${tag}>${renderInline(heading[2])}</${tag}>`);
      continue;
    }

    // Citação
    const quote = trimmed.match(/^&gt;\s?(.*)$/);
    if (quote) {
      flushParagraph();
      flushList();
      out.push(`<blockquote>${renderInline(quote[1])}</blockquote>`);
      continue;
    }

    // Listas
    const ulItem = trimmed.match(/^[-*•]\s+(.+)$/);
    const olItem = trimmed.match(/^(\d+)[.)]\s+(.+)$/);
    if (ulItem || olItem) {
      flushParagraph();
      const wanted: 'ul' | 'ol' = ulItem ? 'ul' : 'ol';
      if (listType !== wanted) {
        flushList();
        out.push(`<${wanted}>`);
        listType = wanted;
      }
      const content = ulItem ? ulItem[1] : (olItem as RegExpMatchArray)[2];
      out.push(`<li>${renderInline(content)}</li>`);
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return out.join('');
}

export function NexoMarkdown({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const html = useMemo(() => {
    // SSR: sem DOM não há sanitização — renderiza texto puro e seguro.
    if (typeof window === 'undefined') return null;
    installLinkHook();
    return DOMPurify.sanitize(renderBlocks(text), {
      ALLOWED_TAGS: [...ALLOWED_TAGS],
      ALLOWED_ATTR: [...ALLOWED_ATTR],
      KEEP_CONTENT: false,
    });
  }, [text]);

  if (html === null) {
    return (
      <span className={cn('nexo-markdown whitespace-pre-wrap', className)}>
        {text}
      </span>
    );
  }

  return (
    <span
      className={cn('nexo-markdown', className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
