import { useRouter } from "@tanstack/react-router";
import { useId, useRef, useState, type DragEvent, type FormEvent } from "react";

import { Button } from "#/components/actions/Button";
import { Card } from "#/components/display/Card";
import { Icon } from "#/components/display/Icon";
import { Alert } from "#/components/feedback/Alert";
import { Input } from "#/components/forms/Input";
import type { FileLink, FileView, MyClaimFile, StaffClaimFiles } from "#/server/data/files";

import { uploadFile, xhrPut, type UploadDeps } from "./client";
import {
  confirmMyUpload,
  createMyUpload,
  openMyFile,
  staffClaimFiles,
  staffOpenFile,
  type UploadsTestClaim,
  type UploadsTestPageData,
} from "./server";

// /dev/uploads (4.10, "The test page"): proves the upload foundation from a laptop (drag and drop,
// or Choose file) and a phone (Choose file, which offers the library, camera or Files). Plain on
// purpose: the real screens are 6.5's claim photo grid and 6.7's review photos, designed in Figma.

const deps: UploadDeps = {
  createUpload: (input) => createMyUpload({ data: input }),
  confirmUpload: (fileId) => confirmMyUpload({ data: { fileId } }),
  put: xhrPut,
};

const ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf";

/** A thrown server-function error carries the fixed sentence the browser may see */
const messageOf = (error: unknown) =>
  error instanceof Error && error.message ? error.message : "Something went wrong.";

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.ceil(bytes / 1024)} KB`;
}

async function open(load: () => Promise<FileLink>, onError: (message: string) => void) {
  // Opened before the await, so a phone's popup blocker sees the tap
  const tab = window.open("", "_blank");
  try {
    const link = await load();
    if (tab) tab.location.href = link.url;
    else window.location.href = link.url;
  } catch (error) {
    tab?.close();
    onError(messageOf(error));
  }
}

export function UploadsTestPage({ data }: { data: UploadsTestPageData }) {
  return (
    <main
      style={{ maxWidth: 760, margin: "0 auto", padding: "32px 16px", display: "grid", gap: 24 }}
    >
      <header style={{ display: "grid", gap: 8 }}>
        <h1>Upload test</h1>
        <p>
          Not in production. Photos are shrunk and re-encoded in this browser, without their
          location, then go straight to storage.
        </p>
      </header>
      {data.claims.length === 0 ? (
        <Alert tone="info">You have no claims to upload to.</Alert>
      ) : (
        data.claims.map((claim) => <ClaimUploads key={claim.id} claim={claim} />)
      )}
      {data.staff && <StaffFiles />}
    </main>
  );
}

interface Upload {
  key: number;
  name: string;
  progress: number;
  error: string | null;
}

function ClaimUploads({ claim }: { claim: UploadsTestClaim }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const counter = useRef(0);

  const update = (key: number, change: Partial<Upload>) =>
    setUploads((list) => list.map((u) => (u.key === key ? { ...u, ...change } : u)));

  async function send(files: FileList | File[]) {
    setError(null);
    for (const file of Array.from(files)) {
      const key = ++counter.current;
      setUploads((list) => [...list, { key, name: file.name, progress: 0, error: null }]);
      const kind = file.type === "application/pdf" ? "claim_document" : "claim_photo";
      try {
        const result = await uploadFile(file, { kind, parentId: claim.id }, deps, (progress) =>
          update(key, { progress }),
        );
        if (result.status === "rejected") update(key, { error: result.message });
        else setUploads((list) => list.filter((u) => u.key !== key));
      } catch (caught) {
        update(key, { error: messageOf(caught) });
      }
    }
    await router.invalidate();
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (claim.acceptsUploads && event.dataTransfer.files.length > 0) {
      void send(event.dataTransfer.files);
    }
  }

  return (
    <Card as="section" variant="outline" padding="md" aria-labelledby={`claim-${claim.id}`}>
      <div style={{ display: "grid", gap: 16 }}>
        <h2 id={`claim-${claim.id}`}>
          {claim.reference} <small>({claim.status})</small>
        </h2>

        {claim.acceptsUploads ? (
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            style={{
              border: "2px dashed currentColor",
              borderRadius: 12,
              padding: 24,
              textAlign: "center",
              opacity: dragging ? 1 : 0.8,
              display: "grid",
              gap: 12,
              justifyItems: "center",
            }}
          >
            <p>Drop photos or PDFs here, or</p>
            <Button variant="secondary" iconLeft="file-plus" onClick={() => input.current?.click()}>
              Choose file
            </Button>
            <input
              ref={input}
              type="file"
              accept={ACCEPT}
              multiple
              hidden
              data-testid={`file-input-${claim.reference}`}
              onChange={(event) => {
                const files = event.target.files;
                if (files && files.length > 0) void send(Array.from(files));
                event.target.value = "";
              }}
            />
          </div>
        ) : (
          <Alert tone="neutral">This claim can't take new files.</Alert>
        )}

        {error && (
          <Alert tone="danger" announce>
            {error}
          </Alert>
        )}

        {uploads.map((upload) =>
          upload.error ? (
            <Alert key={upload.key} tone="danger" announce title={upload.name}>
              {upload.error}
            </Alert>
          ) : (
            <label key={upload.key} style={{ display: "grid", gap: 4 }}>
              <span>Uploading {upload.name}</span>
              <progress max={1} value={upload.progress} aria-label={`Uploading ${upload.name}`} />
            </label>
          ),
        )}

        {claim.files.length > 0 && (
          <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 12 }}>
            {claim.files.map((file) => (
              <FileRow
                key={file.id}
                file={file}
                onOpen={() => open(() => openMyFile({ data: { fileId: file.id } }), setError)}
              />
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function FileRow({
  file,
  onOpen,
}: {
  file: FileView & Partial<Pick<MyClaimFile, "thumbUrl">>;
  onOpen: () => void;
}) {
  const isPdf = file.mime === "application/pdf";
  return (
    <li style={{ display: "flex", gap: 12, alignItems: "center" }}>
      {file.thumbUrl ? (
        <img
          src={file.thumbUrl}
          alt=""
          width={80}
          height={file.width && file.height ? Math.round((80 * file.height) / file.width) : 60}
          style={{ objectFit: "cover", borderRadius: 8 }}
        />
      ) : (
        <Icon name={isPdf ? "file-text" : "image"} size={32} />
      )}
      <span style={{ flex: 1 }}>
        {isPdf ? "PDF" : "Photo"}, {formatSize(file.sizeBytes)}: <strong>{file.status}</strong>
      </span>
      {file.status === "ready" && (
        <Button size="sm" variant="ghost" onClick={onOpen}>
          Open
        </Button>
      )}
    </li>
  );
}

/** Staff: a claim's files as staff see them, each opened through the audited read */
function StaffFiles() {
  const id = useId();
  const [reference, setReference] = useState("");
  const [result, setResult] = useState<StaffClaimFiles | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      setResult(await staffClaimFiles({ data: { reference: reference.trim().toUpperCase() } }));
    } catch (caught) {
      setResult(null);
      setError(messageOf(caught));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card as="section" variant="sunken" padding="md" aria-labelledby={id}>
      <div style={{ display: "grid", gap: 16 }}>
        <h2 id={id}>Staff view</h2>
        <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
          <Input
            label="Claim reference"
            placeholder="KRB-C-90001"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
          />
          <Button type="submit" loading={loading}>
            Show files
          </Button>
        </form>
        {error && (
          <Alert tone="danger" announce>
            {error}
          </Alert>
        )}
        {result &&
          (result.files.length === 0 ? (
            <p>{result.reference} has no files.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 12 }}>
              {result.files.map((file) => (
                <FileRow
                  key={file.id}
                  file={file}
                  onOpen={() => open(() => staffOpenFile({ data: { fileId: file.id } }), setError)}
                />
              ))}
            </ul>
          ))}
      </div>
    </Card>
  );
}
