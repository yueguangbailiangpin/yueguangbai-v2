// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileDropZone } from './FileDropZone';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('FileDropZone', () => {
  it('accepts selected files and lets the user remove one preview', async () => {
    const onFilesChange = vi.fn();
    const user = userEvent.setup();
    renderPicker(onFilesChange);
    const image = new File(['image'], 'product.png', { type: 'image/png' });

    await user.upload(screen.getByLabelText('申请图片文件'), image);

    expect(onFilesChange).toHaveBeenLastCalledWith([image]);
    expect(screen.getByText('product.png')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '删除 product.png' }));
    expect(onFilesChange).toHaveBeenLastCalledWith([]);
    expect(screen.queryByText('product.png')).not.toBeInTheDocument();
  });

  it('accepts dragged and pasted images into the same multiple selection', () => {
    const onFilesChange = vi.fn();
    renderPicker(onFilesChange);
    const zone = screen.getByText('拖拽到这里，或粘贴图片').closest('[role="button"]');
    expect(zone).not.toBeNull();
    const dragged = new File(['one'], 'dragged.jpg', { type: 'image/jpeg' });
    const pasted = new File(['two'], 'pasted.webp', { type: 'image/webp' });

    fireEvent.drop(zone!, { dataTransfer: { files: [dragged] } });
    fireEvent.paste(zone!, { clipboardData: { files: [pasted], items: [] } });

    expect(onFilesChange).toHaveBeenLastCalledWith([dragged, pasted]);
    expect(screen.getByText('已选择 2 个文件')).toBeVisible();
  });

  it('rejects unsupported and oversized files before notifying the upload flow', () => {
    const onFilesChange = vi.fn();
    renderPicker(onFilesChange);
    const zone = screen.getByText('拖拽到这里，或粘贴图片').closest('[role="button"]');
    const unsupported = new File(['text'], 'notes.txt', { type: 'text/plain' });

    fireEvent.drop(zone!, { dataTransfer: { files: [unsupported] } });

    expect(onFilesChange).toHaveBeenLastCalledWith([]);
    expect(screen.getByRole('alert')).toHaveTextContent(/格式不支持/u);
  });
});

function renderPicker(onFilesChange: (files: readonly File[]) => void): void {
  render(
    <FileDropZone
      aria-label="申请图片文件"
      accept="image/jpeg,image/png,image/webp"
      multiple
      maximumFiles={3}
      maximumBytes={1024}
      buttonLabel="选择申请图片"
      emptyLabel="尚未选择图片"
      onFilesChange={onFilesChange}
    />,
  );
}
