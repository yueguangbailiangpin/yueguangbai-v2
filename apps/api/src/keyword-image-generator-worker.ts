import { initWasm, Resvg } from '@resvg/resvg-wasm';
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
import {
  createKeywordImageGeneratorService,
  type KeywordPngRenderer,
} from './keyword-image-generator-service';

const wasmReady = initWasm(resvgWasm);

const renderer: KeywordPngRenderer = {
  async render(input) {
    await wasmReady;
    const fontSize = Math.max(44, Math.min(96, Math.floor(920 / [...input.keyword].length)));
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="320" viewBox="0 0 1200 320">
        <rect width="1200" height="320" rx="32" fill="#ffffff"/>
        <rect x="2" y="2" width="1196" height="316" rx="30" fill="none" stroke="#d8dee9" stroke-width="4"/>
        <text x="600" y="176" text-anchor="middle" dominant-baseline="middle"
          font-family="Noto Sans SC, Noto Sans JP" font-size="${fontSize}" font-weight="700" fill="#172033">${escapeXml(input.keyword)}</text>
        <text x="600" y="276" text-anchor="middle" font-family="Noto Sans SC, Noto Sans JP"
          font-size="24" font-weight="400" fill="#667085">搜索关键词 ${input.position}</text>
      </svg>`;
    const image = new Resvg(svg, {
      fitTo: { mode: 'width', value: 1200 },
      font: {
        fontBuffers: [...input.fontBytes],
        defaultFontFamily: 'Noto Sans SC',
      },
    });
    return new Uint8Array(image.render().asPng());
  },
};

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export default createKeywordImageGeneratorService(renderer);
