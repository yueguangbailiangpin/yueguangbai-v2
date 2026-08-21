import { createHash } from 'node:crypto';

export const HISTORICAL_SELLER_FOLDER_CHANNELS = Object.freeze({
  dJwldHrckeFY: 'ido-mango',
  dDUYsBOrYoEk: 'ygbceping',
  davLDVdZLoPV: 'yinghua1942',
  dhtkJdpmZEgh: 'yueguangbaiai',
} as const);

export interface HistoricalSellerFile {
  sourceFolderId: string;
  sourceFileId: string;
  sourceFileTitle: string;
  sourceUrl: string;
}

export interface HistoricalSellerCustomer {
  normalizedWechat: string;
  displayWechat: string;
  organizationId: string;
  sellerCode: string;
  channelCode: string;
  sources: readonly HistoricalSellerFile[];
}

export interface HistoricalSellerDirectoryPlan {
  customers: readonly HistoricalSellerCustomer[];
  unresolvedFiles: readonly HistoricalSellerFile[];
  sourceFileCount: number;
  resolvedFileCount: number;
}

/**
 * Frozen, human-reviewed extraction from the four read-only Tencent folder
 * inventories. Keys are immutable Tencent file IDs; values are seller WeChat
 * IDs visible in the frozen title or recovered in the prior frozen scan.
 */
export const SELLER_WECHAT_BY_SOURCE_FILE = Object.freeze({
  // dJwldHrckeFY / ido-mango
  daFlBxlHqYgN: 'kirihitoha1992',
  dAITjBKriQUO: 'ghxingqing1204',
  dAixkqYdjpxN: 'vicky1004863445',
  dAohXbqCBmRc: 'DuoLeAiWo',
  daPvazwBAeDB: 'woshikinoko',
  daTSJvATAeVZ: 'wwwcomfm',
  dBctMykPVZcF: 'sura40477687',
  dBGpuCUHXKDI: 'szgavin68',
  dBqLfDOHlCPX: 'Calla0618',
  dBtlLHnamNJS: 'Sunrise521199',
  dCAFwfetqVfM: 'fishball_ballfish',
  dCxVKjIeRanQ: 'sophia1056213768',
  ddabJBmgAkZY: 'Kagetsu99',
  ddvNgcOlzQjr: 'RisePeak_dt',
  dEHwpZlkUnNL: 'Amzing-2021',
  dENzurFwapFo: 'aa1571655',
  dEqXjakCfibh: 'w903488068',
  deRbMXDnDMQw: 'w903488068',
  dFbHcWuwZhGU: 'HilIBusi',
  dFEejAgTANoI: 'xyb807497556',
  dFNMpQalYiOV: 'dt2008666',
  dfuiLTOlvIkb: 'skc755',
  dfwRDwBAcUOM: 'wlx',
  dgKMBEQurZCa: 'Baodan-easy',
  dGPYgxLPboMp: 'fw215282256',
  dHDTzgCseWYd: 'daklle',
  dhFxoSgKFUgp: 'xqh_1216',
  dhmvCrmpxXfI: 'LZGY741098',
  dhuMnipfrkLo: 'wsc1014315602',
  djgxlyqoyoNS: 'Youny07',
  dJIrpXWzNDzz: 'SinSoledadme',
  djIWmLCRQYzZ: 'yinxc520',
  dpkbvRljLPMr: 'yinxc520',
  dXvmzWzOWFCE: 'yinxc520',
  dJkKdQlVcNpL: 'Simone_x_',
  djOMwpqRPkVZ: 'K00077',
  djToUfNChsQh: 'ZWJ23570',
  dJyEtRjykMbd: 'amazonajiu',
  dKFTcrFNIWSv: 'wxid_href30e3bnie22',
  dKuacDRpAdzp: 'chen304527605',
  dmQMRGdxJfMb: 'numb995501338',
  dmlOnAFakLdw: 'tippixiaoyan',
  dnKMBpVmJfEY: 'gexiaochi_721',
  dnOGdCfHhpmp: 'wxid_3m7uhnv97g3o22',
  dnSbHxjdfxkG: 'z472091212',
  dNRMCketfMUP: 'ccx8723',
  dnhAMPhOajOC: 'Rs3456',
  dpEafaqWnCmn: 'somi923',
  dQiTmlYoYppL: 'zhengzehang31478686',
  dQdTPKxAbmCf: 'xuli1117',
  dqddCMzMiKdn: 'riririka2020',
  dqzdeLJJHvuD: 'katty450',
  dRXFJjgdKUrG: 'y1131042702',
  dSJAtaOtjSAZ: 'Hitorisukikamo',
  dsRmBrwbRRqL: 'Alexandella',
  dspwEcxDcVNP: 'w17346222664',
  dsUUVseUjGZM: 'laibifang',
  dTHuetRBoTut: 'q359973282',
  dtRhnPyaNyXB: 'Calla0618',
  dTuzskaNOERm: 'New_Life90',
  duAfJNoAqgfQ: 'FFBBGG2022',
  duKavUhXlmGH: 'Sally-li-er',
  duNgKlqoPdUQ: 'Lucky-One-M',
  duwSjcYNbjOQ: 'Michael_er',
  dvBUaEGeGZwf: 'Anty_WB',
  dVdUSwoPNzrN: 'Manmanfan2000',
  dVpWHYQBqJoK: 'chenjian11063396',
  dWNfLpsJDeVF: 'SIMONE',
  dwnQJpKFOTcS: 'CX15900197369',
  dwurmpUcBBCF: 'kirihitoha1992',
  dxIeAOJbDSzj: 'lb1b629',
  dXrwdnJnBmSx: 'asintop',
  dxYhgKacnsBp: 'No_Fish_Guan',
  dZTqdIICXGNC: 'mss521lxy',
  dzrpjsIEZHkq: 'MDSH_zhang',
  dZzsJRcmvuXZ: 'willa-office',
  dMXikYQCltcG: 'AngleLHZ1314',
  dkEeSJBcdNeW: 'G_GKiki',
  djwIkloLFusZ: 'one-one',
  dmtMCGQaKvjz: 'YONG-1229',

  // dDUYsBOrYoEk / ygbceping
  daClUVDawrkm: 'MaxLiu2970',
  dajlJYDyPUei: 'ls381048211',
  daMrnvMqdbtX: 'LiuYun-5288',
  dbOGrmcMuWqM: 'zzz2245453596',
  dbUkUAcuDWrl: 'Armmmm234',
  dDcpXqMXgdBA: 'jocelynwyj',
  ddkzJUtYdSRU: 'contr38294',
  ddoIaPPqIktp: 'BlackCoor',
  dDwyvnKTpKlU: 'wxid_ydb7evu6d5w512',
  dftcHriAzCSh: 'BbLonG22',
  dGDUaiSCGcdm: 'achou-99033',
  dGkeWbbmsOZP: 'auxcelery',
  dKKWnIHsSyMe: 'Jantow15914303692',
  dkzHtvSRXxKt: 'Navy_Duan',
  dOFMpIeAkYWa: 'lwbaster',
  dOMlwITkGMkE: 'Harrie-fighting',
  dVodrCYxZcWT: 'lofehuang',
  dVYDPWdXNPSF: 'L_Scorpio_Nov06',
  WaIGnhctNpEg: 'huzs-88',
  dzgSOVjLvFjs: 'Redamancy202601',
  duXRsKAkxLtY: 'ricky4819',
  WKWnLbekbqpc: 'HJJ930918',
  dqGGNaHRRjfK: 'hxjhzy98',
  dQrIrvRdUDLM: 'wxid_rgqc2wj3qtcy22',
  WJsydMreOyrt: 'Skulls_Yu',
  dzfXXiUxyQxd: 'beamskai',
  dSLsGtPCuqcG: 'wml19981108wml',
  duUmUCRjvaHn: 'lucky101124',
  dsPQZudVRhbr: 'yunyifafafa131419',
  dWEXhrpSUHDU: 'he2085754',
  dramrabdzBep: 'z1610603273',
  dRgUeAOrmMHi: 'bestwishes0225_',
  WJULUCZohBeW: 'jade-viviyu',
  dwwnxxNxRtDG: 'wxid_zk5quog40j7s12',
  dTVLhQlLWiLv: 'William',
  dVFdNwrKPlTo: 'hbszz001',
  dqYDbiXAwUaF: 'Kiri-Natsu',
  dSfeCBsvscId: 'janp168888',
  dvAKbRBhXYAb: 'shiguo0317',
  dQUfCMYajpdX: 'Jyoutei09',
  dtnlEntorRbW: 'Cici',

  // davLDVdZLoPV / yinghua1942
  dcyOQqtrJSEy: 'DADIANJAI2021',

  // dhtkJdpmZEgh / yueguangbaiai
  dDkKmyLgiUOc: 'youqiejinyouya',
  dEHMsHdCMxqE: 'Sakura09100821',
  dEuGwJYuZRwc: 'wuyan191314',
  dEWWZrWtfXzq: 'LJQ2181422450',
  dfWAWpXXpSHb: 'zzw8280',
  dGhhxYMlGGwn: 'GGsimida008_',
  dGirhdwXFYqO: 'apple837750167',
  dLRKDVEJhURW: 'apple837750167',
  dHIbriLUdOhF: 'wxid_uguftm56917c21',
  dhwSrMfuVBhB: 'Meicuojiushiwoo',
  dMMqBapTzdZm: 'tanwei501900',
  dmzpjFUVbBxz: 'qq851032182',
  dNBAGUuSBcGr: 'FFF3377M',
  dncftILxqEAu: 'Tortillv',
  dnNUnOJgYODB: 'Cyting_310',
  doaDbxNAlPoY: 'Johnwen7',
  dPHVjiEQcmUT: 'F80_7GHY',
  dPZurdVHkMDH: 'pearl323',
  dQFmdvABGusr: 'Y18237437368',
  dQnATZanHVOB: 'janp168888',
  dQWyzvIhQkXV: 'liunian8908',
  dRCLARUoIjNx: 'wzcplaywzc01',
  dRsRKkNxrruz: 'chenweijxxs',
  dSCpfELdaxQz: 'w903488068',
  dtJtnhyMMdNn: 'w903488068',
  dsOmcvqPkyvf: 'gzcaojin',
  dTjHRYLznzFB: 'y13071559173',
  dtWtXNmzWECT: 'z9590959',
  dwNKnYdsPYRd: 'Guanming9573',
  dXToEAIrteAe: 'sensohou',
  dzgPdpoqolAJ: 'Chen_abby-168_',
  dZoTJNoktRdS: 'wakaba00',
  WUHrvsmHIKMR: 'wxid_vmsiw9jpimpq21',
} as const satisfies Readonly<Record<string, string>>);

export function buildHistoricalSellerDirectoryPlan(
  files: readonly HistoricalSellerFile[],
): HistoricalSellerDirectoryPlan {
  const grouped = new Map<string, { displayWechat: string; sources: HistoricalSellerFile[] }>();
  const unresolvedFiles: HistoricalSellerFile[] = [];
  for (const file of files) {
    const seller = SELLER_WECHAT_BY_SOURCE_FILE[file.sourceFileId as keyof typeof SELLER_WECHAT_BY_SOURCE_FILE];
    if (!seller) {
      unresolvedFiles.push(file);
      continue;
    }
    const normalizedWechat = seller.normalize('NFKC').trim().toLocaleLowerCase('en-US');
    const current = grouped.get(normalizedWechat) ?? { displayWechat: seller, sources: [] };
    current.sources.push(file);
    grouped.set(normalizedWechat, current);
  }
  const customers = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(
    ([normalizedWechat, value]) => {
      const digest = createHash('sha256').update(normalizedWechat).digest('hex').slice(0, 24);
      const first = [...value.sources].sort((a, b) =>
        a.sourceFolderId.localeCompare(b.sourceFolderId)
        || a.sourceFileId.localeCompare(b.sourceFileId))[0]!;
      return Object.freeze({
        normalizedWechat,
        displayWechat: value.displayWechat,
        organizationId: `historical-seller-org-${digest}`,
        sellerCode: `historical-${digest}`,
        channelCode: HISTORICAL_SELLER_FOLDER_CHANNELS[
          first.sourceFolderId as keyof typeof HISTORICAL_SELLER_FOLDER_CHANNELS
        ],
        sources: Object.freeze([...value.sources]),
      });
    },
  );
  return Object.freeze({
    customers: Object.freeze(customers),
    unresolvedFiles: Object.freeze(unresolvedFiles),
    sourceFileCount: files.length,
    resolvedFileCount: files.length - unresolvedFiles.length,
  });
}
