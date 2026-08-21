import {
  useEffect,
  useId,
  useRef,
  useState,
  type DragEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ClipboardEvent,
} from 'react';

type FileDropZoneProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'className' | 'onChange' | 'value' | 'multiple'
> & {
  buttonLabel: string;
  emptyLabel: string;
  multiple?: boolean;
  maximumFiles: number;
  maximumBytes: number;
  onFilesChange: (files: readonly File[]) => void;
};

export function FileDropZone({
  buttonLabel,
  emptyLabel,
  id,
  accept,
  disabled,
  multiple = false,
  maximumFiles,
  maximumBytes,
  onFilesChange,
  required,
  ...inputProps
}: FileDropZoneProps): React.JSX.Element {
  const generatedId = useId();
  const inputId = id ?? `file-drop-zone-${generatedId}`;
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<readonly File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function replaceFiles(next: readonly File[]): void {
    const accepted = validateFiles(next, {
      accept,
      maximumFiles: multiple ? maximumFiles : 1,
      maximumBytes,
    });
    setError(accepted.error);
    setFiles(accepted.files);
    onFilesChange(accepted.files);
  }

  function addFiles(incoming: readonly File[]): void {
    const next = multiple ? deduplicateFiles([...files, ...incoming]) : incoming.slice(0, 1);
    replaceFiles(next);
  }

  function openPicker(): void {
    if (!disabled) input.current?.click();
  }

  function onDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragging(false);
    if (!disabled) addFiles(Array.from(event.dataTransfer.files));
  }

  function onPaste(event: ClipboardEvent<HTMLDivElement>): void {
    if (disabled) return;
    const pasted = clipboardFiles(event.clipboardData);
    if (pasted.length === 0) {
      setError('剪贴板里没有可用的图片或文件。');
      return;
    }
    event.preventDefault();
    addFiles(pasted);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openPicker();
  }

  function removeFile(index: number): void {
    replaceFiles(files.filter((_, fileIndex) => fileIndex !== index));
  }

  return (
    <div className="file-drop-zone">
      <input
        {...inputProps}
        ref={input}
        id={inputId}
        type="file"
        accept={accept}
        disabled={disabled}
        multiple={multiple}
        aria-required={required || undefined}
        className="visually-hidden file-drop-zone-input"
        onChange={(event) => replaceFiles(Array.from(event.currentTarget.files ?? []))}
      />
      <div
        className={`file-drop-zone-target${dragging ? ' is-dragging' : ''}`}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-controls={inputId}
        aria-disabled={disabled || undefined}
        onClick={openPicker}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onDragEnter={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDragging(false);
          }
        }}
        onDrop={onDrop}
      >
        <span className="file-drop-zone-button">{buttonLabel}</span>
        <strong>拖拽到这里，或粘贴图片</strong>
        <small>复制图片后点击此区域，按 Ctrl/⌘+V；也可以直接拖入文件。</small>
      </div>
      <p className="file-drop-zone-summary" aria-live="polite">
        {files.length > 0 ? `已选择 ${files.length} 个文件` : emptyLabel}
      </p>
      {files.length > 0 ? (
        <div className="file-drop-zone-previews">
          {files.map((file, index) => (
            <FilePreview
              key={fileKey(file)}
              file={file}
              onRemove={() => removeFile(index)}
            />
          ))}
        </div>
      ) : null}
      {error ? <p className="file-drop-zone-error" role="alert">{error}</p> : null}
    </div>
  );
}

function FilePreview({
  file,
  onRemove,
}: {
  file: File;
  onRemove: () => void;
}): React.JSX.Element {
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!file.type.startsWith('image/') || typeof URL.createObjectURL !== 'function') return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return (
    <article className="file-drop-zone-preview">
      {preview ? <img src={preview} alt="" /> : <span className="file-drop-zone-file-icon">文件</span>}
      <span>
        <strong>{file.name}</strong>
        <small>{formatFileSize(file.size)}</small>
      </span>
      <button type="button" onClick={(event) => {
        event.stopPropagation();
        onRemove();
      }} aria-label={`删除 ${file.name}`}>删除</button>
    </article>
  );
}

function validateFiles(
  files: readonly File[],
  options: {
    accept: string | undefined;
    maximumFiles: number;
    maximumBytes: number;
  },
): { files: readonly File[]; error: string | null } {
  const acceptedMimes = (options.accept ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.includes('/'));
  const valid = files.filter((file) =>
    (acceptedMimes.length === 0 || acceptedMimes.includes(file.type.toLowerCase()))
    && file.size > 0
    && file.size <= options.maximumBytes,
  );
  if (valid.length !== files.length) {
    return {
      files: valid.slice(0, options.maximumFiles),
      error: `部分文件格式不支持、内容为空或超过 ${formatFileSize(options.maximumBytes)}。`,
    };
  }
  if (valid.length > options.maximumFiles) {
    return {
      files: valid.slice(0, options.maximumFiles),
      error: `最多只能选择 ${options.maximumFiles} 个文件。`,
    };
  }
  return { files: valid, error: null };
}

function clipboardFiles(data: DataTransfer): readonly File[] {
  const direct = Array.from(data.files);
  if (direct.length > 0) return direct;
  return Array.from(data.items)
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}

function deduplicateFiles(files: readonly File[]): readonly File[] {
  return files.filter((file, index) =>
    files.findIndex((candidate) => fileKey(candidate) === fileKey(file)) === index,
  );
}

function fileKey(file: File): string {
  return `${file.name}:${file.type}:${file.size}:${file.lastModified}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KiB`;
  return `${Math.ceil(bytes / (1024 * 1024))} MiB`;
}
