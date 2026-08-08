import { useState, type InputHTMLAttributes } from 'react';

export function BuyerFilePicker({
  buttonLabel,
  emptyLabel,
  onChange,
  id,
  multiple,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'> & {
  buttonLabel: string;
  emptyLabel: string;
}): React.JSX.Element {
  const [fileNames, setFileNames] = useState<readonly string[]>([]);
  return <div className="buyer-file-picker">
    <input {...props} id={id} type="file" multiple={multiple} className="visually-hidden buyer-file-input"
      onChange={(event) => {
        setFileNames(Array.from(event.currentTarget.files ?? [], (file) => file.name));
        onChange?.(event);
      }} />
    <label className="buyer-file-picker-button" htmlFor={id}>{buttonLabel}</label>
    <span className="buyer-file-picker-name" aria-live="polite">
      {fileNames.length > 0 ? fileNames.join('、') : emptyLabel}
    </span>
  </div>;
}
