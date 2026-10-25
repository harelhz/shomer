/**
 * Reports the ids and classes present in the document so the background can
 * inject only the generic cosmetic filters that could match ("lowly generic"
 * filtering, see shared/filters/cosmetic.ts).
 */
const TOKEN_RE = /^[.#][a-zA-Z_-][\w-]*$/;

export function startTokenCollector(send: (tokens: string[]) => void): void {
  const seen = new Set<string>();
  let pending: string[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let flushes = 0;

  const flush = () => {
    timer = undefined;
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    flushes++;
    send(batch);
  };

  const add = (token: string) => {
    if (seen.has(token) || !TOKEN_RE.test(token)) return;
    seen.add(token);
    pending.push(token);
    // The first batches go out quickly to avoid a flash of ads; later ones are coalesced.
    timer ??= setTimeout(flush, flushes < 3 ? 10 : 200);
  };

  const collect = (el: Element) => {
    if (el.id) add(`#${el.id}`);
    const cls = el.classList;
    for (let i = 0; i < cls.length; i++) add(`.${cls[i]}`);
  };

  const scan = (node: Node) => {
    if (!(node instanceof Element)) return;
    collect(node);
    if (node.firstElementChild) node.querySelectorAll('[id],[class]').forEach(collect);
  };

  new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'attributes') {
        if (m.target instanceof Element) collect(m.target);
      } else {
        m.addedNodes.forEach(scan);
      }
    }
  }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['id', 'class'] });

  if (document.documentElement) scan(document.documentElement);
}
