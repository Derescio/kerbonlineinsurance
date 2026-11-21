import { Icon } from "#/components/display/Icon";

import {
  documentFilename,
  documentHref,
  documentTitles,
  type PolicyDocumentKind,
} from "./documents";
import { longDay } from "./overview-model";

/**
 * A policy's documents (6.2, decision 5; Figma 183:3507's Documents card): each one's name,
 * "PDF · {bought}" and a download. A plain link, since the route answers with a file, not a page.
 */
export function DocumentList({
  reference,
  kinds,
  boughtOn,
}: {
  reference: string;
  kinds: PolicyDocumentKind[];
  boughtOn: string;
}) {
  return (
    <ul className="docs__list">
      {kinds.map((kind) => (
        <li key={kind} className="docs__row">
          <Icon name="file-text" size={20} className="docs__icon" />
          <div className="docs__main">
            <p className="docs__name">{documentTitles[kind]}</p>
            <p className="docs__meta">PDF · {longDay(boughtOn)}</p>
          </div>
          <a
            href={documentHref(reference, kind)}
            download={documentFilename(reference, kind)}
            className="docs__download"
            aria-label={`Download ${documentTitles[kind]}, ${reference}`}
          >
            <Icon name="download" size={16} />
          </a>
        </li>
      ))}
    </ul>
  );
}
