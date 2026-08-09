import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const folders = ['dJwldHrckeFY', 'dDUYsBOrYoEk', 'davLDVdZLoPV', 'dhtkJdpmZEgh'];
const explicit = {
  dVpWHYQBqJoK: ['chenjian11063396', 'ido-mango'],
  WKWnLbekbqpc: ['HJJ930918', 'ygbceping'],
  dRXFJjgdKUrG: ['y1131042702', 'ido-mango'],
  dSfeCBsvscId: ['janp168888', 'ygbceping'],
  dvAKbRBhXYAb: ['shiguo0317', 'ygbceping'],
  WJsydMreOyrt: ['Skulls_Yu', 'ygbceping'],
  dBctMykPVZcF: ['sura40477687', 'ido-mango'],
};
const aliases = [
  'yueguangbaiai', 'yueguangbai', 'yuegungbai', 'ygbceping', 'ygbceoing',
  'ygceping', 'ygb', 'ygc', 'gyb', 'yinghua1942ai', 'yinghua1942',
  'quesheng520ai', 'queshengai', 'ido-mango', 'idomango', 'ido-mago',
  'idomamgo', 'ido-mamgo', 'ido', 'dio',
];

async function call(server, tool, args) {
  const command = server === 'tencent-docs'
    ? ['call', server, tool, '--args', JSON.stringify(args)]
    : ['call', `${server}.${tool}`, '--args', JSON.stringify(args)];
  const { stdout } = await exec('mcporter', command, { maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(stdout);
}

function csvRows(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else quoted = false;
      } else cell += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n') {
      row.push(cell.replace(/\r$/u, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else cell += character;
  }
  if (cell.length || row.length) rows.push([...row, cell.replace(/\r$/u, '')]);
  return rows;
}

const clean = (value) => String(value ?? '').replace(/\u0000/gu, '').trim();
function productIdentity(raw, marketplace) {
  const identifier = clean(raw).replace(/\s+/gu, '').toUpperCase();
  if (/^B[A-Z0-9]{9}$/u.test(identifier)) {
    return { marketplaceCode: 'JP_AMAZON', platformProductIdentifier: identifier };
  }
  if (marketplace === 'JP_RAKUTEN' && /^(R-1|S-1)$/u.test(identifier)) {
    return { marketplaceCode: 'JP_RAKUTEN', platformProductIdentifier: identifier };
  }
  return null;
}

function marketplace(site, raw) {
  return /乐天/u.test(site) || /^(R-1|S-1)$/u.test(clean(raw))
    ? 'JP_RAKUTEN' : 'JP_AMAZON';
}

function parseCurrent(csv, sheetName, sheetId) {
  const rows = csvRows(csv);
  const result = [];
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    if (!row.some((value) => clean(value))) continue;
    const first = clean(row[0]);
    const storeName = sheetName === '工作表1' ? clean(row[1]) : clean(row[2]);
    const raw = sheetName === '工作表1' ? clean(row[2]) : clean(row[3]);
    const productName = sheetName === '工作表1' ? clean(row[3]) : clean(row[4]);
    const identity = productIdentity(raw, marketplace(first, raw));
    result.push({
      sourceSheet: sheetName,
      sourceRow: index + 1,
      sourceLocator: `tencent://DZEZ6a2F2aE1MWHdi/${sheetId}/${index + 1}`,
      marketplaceCode: identity?.marketplaceCode ?? marketplace(first, raw),
      storeName,
      platformProductIdentifier: identity?.platformProductIdentifier ?? null,
      asin: identity?.marketplaceCode === 'JP_AMAZON' ? identity.platformProductIdentifier : null,
      productName,
    });
  }
  return result;
}

function sellerFromTitle(title, fileId) {
  if (explicit[fileId]) {
    return { sellerWechat: explicit[fileId][0], channelAlias: explicit[fileId][1], mappingBasis: 'CONFIRMED_FILE_MAPPING' };
  }
  const lower = title.toLocaleLowerCase('en-US');
  const alias = aliases.slice().sort((left, right) => right.length - left.length)
    .find((candidate) => lower.includes(candidate));
  if (!alias) return {};
  const before = title.slice(0, lower.lastIndexOf(alias)).replace(/[\s_-]+$/u, '');
  const token = (before.split(/[-_]/u).pop() ?? '').trim();
  if (!/^[A-Za-z][A-Za-z0-9_]{3,31}$/u.test(token)
    || /^(产品|日亚|乐天|amazon|jp|direct|store|shop)$/iu.test(token)) {
    return { channelAlias: alias };
  }
  return { sellerWechat: token, channelAlias: alias, mappingBasis: 'STRUCTURED_TITLE_SELLER_TOKEN' };
}

async function listFiles() {
  const files = [];
  for (const folderId of folders) {
    for (let start = 0; start < 250; start += 20) {
      const result = await call('tencent-docs', 'manage.folder_list', { folder_id: folderId, start });
      files.push(...result.list.filter((item) => !item.is_folder)
        .map((item) => ({ ...item, sourceFolderId: folderId })));
      if (result.finish) break;
    }
  }
  return files;
}

async function main() {
  const [worksheet1, philips] = await Promise.all([
    call('sheet-mcp', 'get_cell_data', {
      file_id: 'DZEZ6a2F2aE1MWHdi', sheet_id: 'BB08J2', start_row: 0,
      end_row: 192, start_col: 0, end_col: 25, return_csv: true,
    }),
    call('sheet-mcp', 'get_cell_data', {
      file_id: 'DZEZ6a2F2aE1MWHdi', sheet_id: '1pne3d', start_row: 0,
      end_row: 129, start_col: 0, end_col: 25, return_csv: true,
    }),
  ]);
  const current = [
    ...parseCurrent(worksheet1.csv_data, '工作表1', 'BB08J2'),
    ...parseCurrent(philips.csv_data, '飞利浦产品', '1pne3d'),
  ];
  const currentKeys = new Set(current.filter((row) => row.platformProductIdentifier)
    .map((row) => `${row.marketplaceCode}:${row.platformProductIdentifier}`));
  const files = await listFiles();
  let cursor = 0;
  const inventory = [];
  const historical = [];
  async function worker() {
    while (true) {
      const position = cursor;
      cursor += 1;
      if (position >= files.length) return;
      const file = files[position];
      const base = {
        sourceFolderId: file.sourceFolderId,
        sourceFileId: file.id,
        sourceFileTitle: file.title,
        sourceUrl: file.url,
      };
      if (file.id === 'dBREgmxcsxqh') {
        inventory[position] = { ...base, scanStatus: 'EXCLUDED_SELF_FULFILLMENT_STORE_REVIEWS', matchedRowCount: 0 };
        continue;
      }
      if (!/\/sheet\//u.test(file.url)) {
        inventory[position] = { ...base, scanStatus: 'NOT_PRODUCT_SOURCE', matchedRowCount: 0 };
        continue;
      }
      try {
        const token = file.url.split('/').pop();
        const info = await call('sheet-mcp', 'get_sheet_info', { file_id: token });
        const sheets = info.sheets.filter((sheet) => sheet.sheet_type === 'worksheet'
          && /产品信息|工作表1|产品/u.test(sheet.sheet_name)
          && !/订单|评论|下单|返金/u.test(sheet.sheet_name));
        if (!sheets.length) {
          inventory[position] = { ...base, scanStatus: 'NO_PRODUCT_SHEET', matchedRowCount: 0 };
          continue;
        }
        let matchedRows = [];
        let productSheet = null;
        for (const sheet of sheets) {
          const data = await call('sheet-mcp', 'get_cell_data', {
            file_id: token, sheet_id: sheet.sheet_id, start_row: 0,
            end_row: Math.min((sheet.row_count ?? 1) - 1, 249), start_col: 0,
            end_col: Math.min((sheet.col_count ?? 8) - 1, 9), return_csv: true,
          });
          const rows = csvRows(data.csv_data);
          const headers = (rows[0] ?? []).map(clean);
          const identifierColumn = headers.findIndex((header) => /ASIN|产品编号|产品标识|商品编号/u.test(header));
          const siteColumn = headers.findIndex((header) => /站点|平台/u.test(header));
          const nameColumn = headers.findIndex((header) => /产品中文名|产品名称|商品名称|品名/u.test(header));
          if (identifierColumn < 0) continue;
          productSheet = { sheetId: sheet.sheet_id, sheetName: sheet.sheet_name };
          for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
            const row = rows[rowIndex] ?? [];
            if (!row.some((value) => clean(value))) continue;
            const raw = clean(row[identifierColumn]);
            const identity = productIdentity(raw, marketplace(siteColumn >= 0 ? clean(row[siteColumn]) : '', raw));
            if (!identity || !currentKeys.has(`${identity.marketplaceCode}:${identity.platformProductIdentifier}`)) continue;
            const seller = sellerFromTitle(file.title, file.id);
            const record = {
              sourceFolderId: file.sourceFolderId,
              sourceFileId: file.id,
              sourceFileTitle: file.title,
              sourceLocator: `tencent://${file.id}/${sheet.sheet_id}/${rowIndex + 1}`,
              marketplaceCode: identity.marketplaceCode,
              sellerWechat: seller.sellerWechat ?? null,
              channelAlias: seller.channelAlias ?? null,
              platformProductIdentifier: identity.platformProductIdentifier,
              asin: identity.marketplaceCode === 'JP_AMAZON' ? identity.platformProductIdentifier : null,
              productName: clean(nameColumn >= 0 ? row[nameColumn] : '') || null,
            };
            matchedRows.push(record);
          }
        }
        historical.push(...matchedRows);
        inventory[position] = {
          ...base,
          scanStatus: matchedRows.length ? 'MATCHED' : 'NO_CURRENT_MATCH',
          productSheetName: productSheet?.sheetName ?? null,
          productSheetId: productSheet?.sheetId ?? null,
          matchedRowCount: matchedRows.length,
        };
      } catch (error) {
        inventory[position] = { ...base, scanStatus: 'FETCH_ERROR', error: String(error.message ?? error), matchedRowCount: 0 };
      }
    }
  }
  await Promise.all(Array.from({ length: 8 }, () => worker()));
  historical.sort((left, right) => left.sourceLocator.localeCompare(right.sourceLocator));
  inventory.sort((left, right) => left.sourceFileId.localeCompare(right.sourceFileId));
  const output = {
    manifestVersion: '2026-08-09',
    source: {
      currentWorkbookFileId: 'DZEZ6a2F2aE1MWHdi',
      currentWorksheets: [
        { name: '工作表1', sheetId: 'BB08J2', rowBound: 193 },
        { name: '飞利浦产品', sheetId: '1pne3d', rowBound: 130 },
      ],
      historicalFolders: folders,
      readOnlySnapshot: true,
    },
    current,
    historical,
    historicalFileInventory: inventory,
  };
  if (process.argv[2] === 'stats') {
    console.log(JSON.stringify({
      currentSourceRows: current.length,
      currentRowsBySheet: current.reduce((counts, row) => {
        counts[row.sourceSheet] = (counts[row.sourceSheet] ?? 0) + 1;
        return counts;
      }, {}),
      currentMissingIdentifiers: current.filter((row) => !row.platformProductIdentifier),
      currentIdentifierRows: current.filter((row) => row.platformProductIdentifier).length,
      currentUniqueProducts: currentKeys.size,
      historicalRows: historical.length,
      historicalFiles: inventory.length,
      inventoryStatuses: inventory.reduce((counts, row) => {
        counts[row.scanStatus] = (counts[row.scanStatus] ?? 0) + 1;
        return counts;
      }, {}),
    }));
  } else if (process.argv[2] === 'current') {
    console.log(JSON.stringify({ current: output.current }, null, 2));
  } else if (process.argv[2] === 'current-part') {
    const start = Number(process.argv[3] ?? 0);
    const end = Number(process.argv[4] ?? output.current.length);
    console.log(JSON.stringify({ current: output.current.slice(start, end) }, null, 2));
  } else if (process.argv[2] === 'historical') {
    console.log(JSON.stringify({ historical: output.historical }, null, 2));
  } else if (process.argv[2] === 'inventory') {
    console.log(JSON.stringify({ historicalFileInventory: output.historicalFileInventory }, null, 2));
  } else {
    console.log(JSON.stringify(output));
  }
}

await main();
