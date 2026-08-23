import { useMemo, useState } from "react";
import styles from "./MailSO.module.css";

/**
 * Renders the body of a message someone else wrote.
 *
 * Email HTML is hostile input, so it never touches the SOWeb DOM: it goes into
 * a sandboxed iframe with no script permission and a CSP that blocks every
 * outbound request. Remote images stay blocked until the reader asks for them,
 * since loading one tells the sender the mail was opened.
 */
export function MessageBody({ text, html }: { text: string; html: string }) {
  const [showImages, setShowImages] = useState(false);
  const [preferHtml, setPreferHtml] = useState(true);

  const hasHtml = html.trim().length > 0;
  const hasText = text.trim().length > 0;
  const useHtml = hasHtml && preferHtml;

  // Detect remote images so the banner only appears when there's something to unblock.
  const hasRemoteImages = useMemo(
    () => /<img[^>]+src\s*=\s*["']?https?:/i.test(html),
    [html],
  );

  const srcDoc = useMemo(() => {
    if (!useHtml) return "";
    const imgSrc = showImages ? "https: http: data: cid:" : "data:";
    return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${imgSrc}; style-src 'unsafe-inline'; font-src data:;">
<base target="_blank" rel="noopener noreferrer">
<style>
  html,body{margin:0;padding:12px;font:14px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;word-wrap:break-word;}
  img{max-width:100%;height:auto;}
  table{max-width:100%;}
  a{color:#2f6fed;}
</style></head><body>${html}</body></html>`;
  }, [useHtml, html, showImages]);

  if (!hasHtml && !hasText) {
    return <div className={styles.emptyBody}>Este mensaje no tiene contenido para mostrar.</div>;
  }

  return (
    <div className={styles.body}>
      <div className={styles.bodyBar}>
        {hasHtml && hasText && (
          <button className={styles.bodyToggle} onClick={() => setPreferHtml((v) => !v)}>
            {preferHtml ? "Ver como texto" : "Ver con formato"}
          </button>
        )}
        {useHtml && hasRemoteImages && !showImages && (
          <span className={styles.blockedImages}>
            Se bloquearon las imágenes remotas para proteger tu privacidad.
            <button className={styles.bodyToggle} onClick={() => setShowImages(true)}>
              Mostrar imágenes
            </button>
          </span>
        )}
      </div>

      {useHtml ? (
        <iframe
          className={styles.htmlFrame}
          // No allow-scripts: nothing in the message can run. Popups are allowed
          // only so a link in the mail can still open in a real tab.
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          srcDoc={srcDoc}
          title="Contenido del mensaje"
        />
      ) : (
        <pre className={styles.plainText}>{hasText ? text : stripTags(html)}</pre>
      )}
    </div>
  );
}

/** Crude fallback for a message that only has an HTML part. */
function stripTags(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}
