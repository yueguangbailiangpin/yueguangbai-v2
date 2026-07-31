export interface NormalizedWechatId {
  display: string;
  normalized: string;
}

export class WechatIdError extends Error {
  constructor() {
    super('invalid_wechat_id');
    this.name = 'WechatIdError';
  }
}

export function normalizeWechatId(raw: string): NormalizedWechatId {
  if (typeof raw !== 'string') throw new WechatIdError();

  const display = raw.normalize('NFKC').trim();
  if (display.length < 3
    || display.length > 128
    || /\s/u.test(display)
    || /[\u0000-\u001f\u007f]/u.test(display)) {
    throw new WechatIdError();
  }

  return {
    display,
    normalized: display.toLocaleLowerCase('en-US'),
  };
}
