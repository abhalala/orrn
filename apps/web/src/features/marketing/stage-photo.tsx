import { srcSet, type Photo } from "./media";

/** A cropped photograph with its caption, on the ground colour sampled from it while it loads. */
export function StagePhoto({
  photo,
  alt,
  caption,
  sizes,
  className,
  priority = false,
}: {
  photo: Photo;
  alt: string;
  caption: string;
  sizes: string;
  className?: string;
  priority?: boolean;
}) {
  return (
    <figure className={`marketing-photo ${className ?? ""}`} style={{ backgroundColor: photo.ground }}>
      <img
        src={photo.lg}
        srcSet={srcSet(photo)}
        sizes={sizes}
        width={photo.width}
        height={photo.height}
        alt={alt}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        decoding="async"
        style={{ objectPosition: photo.focus, objectFit: photo.fit ?? "cover" }}
      />
      <figcaption>{caption}</figcaption>
    </figure>
  );
}
