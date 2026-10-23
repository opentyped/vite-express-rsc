import type {
  Metadata,
  ResolvedMetadata,
  RouteModule,
  PageProps,
} from "./types.js";

// Undefined inherits, null removes, objects merge, and arrays replace.
/** Combine inherited metadata while allowing a child to replace or remove values. */
function merge(
  parent: Record<string, unknown>,
  value: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...parent };

  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) {
      continue;
    }

    if (entry === null) {
      delete result[key];
      continue;
    }

    result[key] =
      typeof entry === "object" && !Array.isArray(entry)
        ? merge(
            (result[key] && typeof result[key] === "object"
              ? result[key]
              : {}) as Record<string, unknown>,
            entry as Record<string, unknown>,
          )
        : entry;
  }

  return result;
}

/**
 * Resolve metadata from outer layouts to the page, applying inherited title
 * templates.
 */
export async function resolveMetadata(
  modules: { module: RouteModule; props: PageProps }[],
) {
  let parent: ResolvedMetadata = {};
  let template: string | undefined;

  for (const { module, props } of modules) {
    const value: Metadata | undefined =
      typeof module.metadata === "function"
        ? await module.metadata({ ...props, parent })
        : module.metadata;

    if (!value) {
      continue;
    }

    const { title, ...rest } = value;

    parent = merge(
      parent as Record<string, unknown>,
      rest as Record<string, unknown>,
    ) as ResolvedMetadata;

    if (title === null) {
      delete parent.title;
      template = undefined;
    } else if (typeof title === "string") {
      parent.title = template ? template.replaceAll("%s", title) : title;
    } else if (title) {
      if (title.default !== undefined) {
        parent.title = template
          ? template.replaceAll("%s", title.default)
          : title.default;
      }

      if (title.template !== undefined) {
        template = title.template;
      }
    }
  }

  return parent;
}

/** Render one set of head tags that React can update during navigation. */
export function MetadataTags({ value }: { value: ResolvedMetadata }) {
  const og = value.openGraph;
  const robots =
    typeof value.robots === "object" && value.robots
      ? [
          value.robots.index === undefined
            ? undefined
            : value.robots.index
              ? "index"
              : "noindex",
          value.robots.follow === undefined
            ? undefined
            : value.robots.follow
              ? "follow"
              : "nofollow",
        ]
          .filter(Boolean)
          .join(", ")
      : value.robots;

  return (
    <>
      {value.title && <title>{value.title}</title>}
      {value.description && (
        <meta name="description" content={value.description} />
      )}
      {value.canonical && <link rel="canonical" href={value.canonical} />}
      {robots && <meta name="robots" content={robots} />}
      {og &&
        Object.entries(og)
          .filter(([key]) => key !== "images")
          .map(([key, content]) =>
            content ? (
              <meta
                key={key}
                property={`og:${key === "siteName" ? "site_name" : key}`}
                content={String(content)}
              />
            ) : null,
          )}
      {og?.images?.map((url, index) => (
        <meta key={`${index}:${url}`} property="og:image" content={url} />
      ))}
    </>
  );
}
