import { codeToHtml, createCssVariablesTheme } from "shiki";

/**
 * Code, highlighted at build time (no client script). The theme is CSS variables, so code takes the house tokens
 * in either light: ink for text, blued steel / lume for keywords, bronze / champagne for strings.
 */
const theme = createCssVariablesTheme({ name: "unison", variablePrefix: "--code-", fontStyle: true });

export async function Code({ code, lang = "ts", title }: { code: string; lang?: "ts" | "bash" | "json" | "jsonc"; title?: string }) {
  const html = await codeToHtml(code.trim(), { lang, theme });
  return (
    <figure className="overflow-hidden rounded-[var(--radius-lg)] bg-sunken">
      {title ? <figcaption className="border-b border-line px-4 py-2.5 text-xs text-ink-3">{title}</figcaption> : null}
      <div className="code overflow-x-auto p-4 font-mono text-[12.5px] leading-[1.7] [font-variant-ligatures:none] [&_pre]:!bg-transparent [&_pre]:outline-none" dangerouslySetInnerHTML={{ __html: html }} />
    </figure>
  );
}
