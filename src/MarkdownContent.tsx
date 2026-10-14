import { useEffect, useState } from "react";
import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ATTACHMENT_PATTERN, CLOUD_IMAGE_PATTERN, loadImage } from "./images";

function NoteImage({ src = "", alt = "" }: { src?: string; alt?: string }) {
  const [localImage, setLocalImage] = useState<{
    source: string;
    url: string;
  } | null>(null);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const local = ATTACHMENT_PATTERN.test(src) || CLOUD_IMAGE_PATTERN.test(src);

  useEffect(() => {
    if (!local) return;
    let active = true;
    let objectUrl: string | undefined;
    loadImage(src)
      .then((blob) => {
        if (!active) return;
        if (!blob) {
          setFailedSource(src);
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setLocalImage({ source: src, url: objectUrl });
      })
      .catch(() => {
        if (active) setFailedSource(src);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [local, src]);

  if (!src || failedSource === src)
    return (
      <span className="image-message">
        Image unavailable{alt ? `: ${alt}` : ""}
      </span>
    );
  const resolved = local
    ? localImage?.source === src
      ? localImage.url
      : undefined
    : src;
  if (!resolved) return <span className="image-message">Loading image…</span>;
  return (
    <img
      src={resolved}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailedSource(src)}
    />
  );
}

export default function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="markdown-content">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={(url, key, node) => {
          // Only our image renderer may resolve local attachment IDs.
          if (key === "src" && node.tagName === "img") {
            return ATTACHMENT_PATTERN.test(url) ||
              CLOUD_IMAGE_PATTERN.test(url) ||
              /^https?:\/\//i.test(url)
              ? url
              : "";
          }
          return defaultUrlTransform(url);
        }}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          img: ({ src, alt }) => (
            <NoteImage src={typeof src === "string" ? src : ""} alt={alt} />
          ),
        }}
      >
        {content || "*This thought is still taking shape.*"}
      </Markdown>
    </div>
  );
}
