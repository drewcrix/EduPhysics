import katex from 'katex';
import { useMemo } from 'react';

/** KaTeX maths. `display` for block equations. Invalid TeX renders as red source, never throws. */
export function Tex({ children, display = false }: { children: string; display?: boolean }) {
  const html = useMemo(
    () => katex.renderToString(children, { displayMode: display, throwOnError: false, strict: 'ignore' }),
    [children, display],
  );
  return display
    ? <div className="my-3 overflow-x-auto overflow-y-hidden py-1 text-slate-100" dangerouslySetInnerHTML={{ __html: html }} />
    : <span dangerouslySetInnerHTML={{ __html: html }} />;
}
