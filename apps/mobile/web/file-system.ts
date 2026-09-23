/**
 * `expo-file-system` for the installable web app, which it has no web build
 * for. Covers what `src/` asks of it outside `lib/documents.ts` (which has its
 * own web stand-in): open a picked file by uri, size it, read it as base64,
 * upload it with progress, and write a small text file to upload.
 *
 * In a browser a picked or captured file is a `blob:` or `data:` URL. `size` is
 * a synchronous getter on the real `File`, so blob sizes are recorded as the
 * URLs are minted (the pickers mint them), and data URLs are measured from
 * their base64 length. `web/entry.ts` loads this first so no URL is missed.
 */

type UploadOptions = {
  fieldName?: string;
  headers?: Record<string, string>;
  httpMethod?: "PATCH" | "POST" | "PUT";
  mimeType?: string;
  onProgress?: (progress: { bytesSent: number; totalBytes: number }) => void;
  parameters?: Record<string, string>;
  uploadType?: number;
};

type UploadResult = { body: string; headers: Record<string, string>; status: number };

export const UploadType = { BINARY_CONTENT: 0, MULTIPART: 1 } as const;

export const Paths = { cache: "cache", document: "document" };

const blobSizes = new Map<string, number>();
const blobNames = new Map<string, string>();
const mintObjectUrl = URL.createObjectURL.bind(URL);

URL.createObjectURL = (object: Blob | MediaSource) => {
  const url = mintObjectUrl(object);

  if (object instanceof Blob) {
    blobSizes.set(url, object.size);

    if ("name" in object && typeof object.name === "string") {
      blobNames.set(url, object.name);
    }
  }

  return url;
};

function sizeOf(uri: string) {
  if (!uri.startsWith("data:")) {
    return blobSizes.get(uri) ?? 0;
  }

  const comma = uri.indexOf(",");
  const body = uri.slice(comma + 1);

  if (!uri.slice(0, comma).endsWith(";base64")) {
    return new Blob([decodeURIComponent(body)]).size;
  }

  return Math.floor((body.length * 3) / 4) - (body.endsWith("==") ? 2 : body.endsWith("=") ? 1 : 0);
}

export class File {
  uri: string;
  private written: Blob | null = null;

  constructor(...parts: (string | { uri: string })[]) {
    this.uri = parts.map((part) => (typeof part === "string" ? part : part.uri)).join("/");
  }

  get exists() {
    return this.written !== null || /^(blob|data):/.test(this.uri);
  }

  get size() {
    return this.written?.size ?? sizeOf(this.uri);
  }

  create() {}

  delete() {
    this.written = null;
  }

  write(content: string) {
    const name = this.uri.split("/").pop();

    this.written = new Blob([content], { type: "text/plain" });
    this.uri = URL.createObjectURL(this.written);

    if (name) {
      blobNames.set(this.uri, name);
    }
  }

  /** A picked file keeps its own name; a photo or a written file is named for its type. */
  private fileName(blob: Blob) {
    const named = blobNames.get(this.uri);

    if (named || !/^(blob|data):/.test(this.uri)) {
      return named ?? this.uri.split("/").pop() ?? "upload";
    }

    return `upload.${(blob.type.split("/")[1] ?? "bin").replace("jpeg", "jpg").replace("plain", "txt")}`;
  }

  private async read() {
    return this.written ?? (await fetch(this.uri)).blob();
  }

  async base64() {
    const blob = await this.read();

    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  /** Answers `null` when no response came back, which callers read as "check your connection". */
  async upload(url: string, options: UploadOptions = {}): Promise<UploadResult | null> {
    const read = await this.read();
    const blob = options.mimeType ? new Blob([read], { type: options.mimeType }) : read;
    let body: Blob | FormData = blob;

    if (options.uploadType === UploadType.MULTIPART) {
      const form = new FormData();

      for (const [key, value] of Object.entries(options.parameters ?? {})) {
        form.append(key, value);
      }

      form.append(options.fieldName ?? "file", blob, this.fileName(blob));
      body = form;
    }

    return new Promise((resolve) => {
      const request = new XMLHttpRequest();

      request.open(options.httpMethod ?? "POST", url);

      for (const [key, value] of Object.entries(options.headers ?? {})) {
        request.setRequestHeader(key, value);
      }

      request.upload.onprogress = (event) =>
        options.onProgress?.({ bytesSent: event.loaded, totalBytes: event.total });
      request.onload = () => resolve({ body: request.responseText, headers: {}, status: request.status });
      request.onerror = () => resolve(null);
      request.send(body);
    });
  }
}
