import type {
  DriveArchiveAdapter,
  DriveArchiveReadResult,
  DriveArchiveUploadInput,
  DriveArchiveUploadResult,
  SupportedFileMime,
} from '@ygb/contracts';

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface GoogleDriveArchiveConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  folderId: string;
  ownerAccountKey: string;
}

export class GoogleDriveArchiveAdapter implements DriveArchiveAdapter {
  private accessToken: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly config: GoogleDriveArchiveConfig,
    private readonly fetcher: Fetcher = fetch,
  ) { validateConfig(config); }

  async upload(input: DriveArchiveUploadInput): Promise<DriveArchiveUploadResult> {
    const token = await this.token();
    let session = input.resumeSessionKey ?? null;
    if (session&&!safeResumableSession(session)) throw new Error('drive_upload_session_invalid');
    let offset=0;
    if(session){
      const status=await this.fetcher(session,{method:'PUT',headers:{Authorization:`Bearer ${token}`,
        'Content-Length':'0','Content-Range':`bytes */${input.byteSize}`}});
      if(status.status===404||status.status===410) session=null;
      else if(status.status===308) offset=resumeOffset(status.headers.get('Range'),input.byteSize);
      else if(status.ok) return completed(await responseFileId(status),this.config);
      else throw providerError('drive_upload_status_failed',status.status);
    }
    if (!session) {
      const response = await this.fetcher(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,parents',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json; charset=utf-8',
            'X-Upload-Content-Type': input.mimeType,
            'X-Upload-Content-Length': String(input.byteSize),
          },
          body: JSON.stringify({
            name: input.fileName,
            parents: [this.config.folderId],
            appProperties: {
              ygb_file_object_id: input.fileObjectId,
              ygb_sha256: input.sha256,
            },
          }),
        },
      );
      if (!response.ok) throw providerError('drive_upload_session_failed', response.status);
      session = response.headers.get('Location');
      if (!session||!safeResumableSession(session)) throw new Error('drive_upload_session_missing');
    }
    if(offset<0||offset>=input.byteSize) throw new Error('drive_upload_offset_invalid');
    const remaining=input.bytes.slice(offset);
    const uploaded = await this.fetcher(session, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': input.mimeType,
        'Content-Length': String(remaining.byteLength),
        'Content-Range': `bytes ${offset}-${input.byteSize - 1}/${input.byteSize}`,
      },
      body: remaining,
    });
    if (uploaded.status === 308) {
      return {completed:false,fileId:null,folderId:this.config.folderId,
        ownerAccountKey:this.config.ownerAccountKey,resumeSessionKey:session};
    }
    if (!uploaded.ok) throw providerError('drive_upload_failed', uploaded.status);
    return completed(await responseFileId(uploaded),this.config);
  }

  async readFile(fileId: string): Promise<DriveArchiveReadResult> {
    if (!safeId(fileId,500)) throw new Error('invalid_drive_file_id');
    const response = await this.fetcher(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
      {headers:{Authorization:`Bearer ${await this.token()}`}},
    );
    if (!response.ok) throw providerError('drive_read_failed',response.status);
    const mimeType = response.headers.get('Content-Type')?.split(';',1)[0]?.trim();
    if (!isMime(mimeType)) throw new Error('drive_read_mime_invalid');
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {bytes,mimeType,byteSize:bytes.byteLength};
  }

  private async token(): Promise<string> {
    const now = Date.now();
    if (this.accessToken && this.accessToken.expiresAt > now + 30_000) return this.accessToken.value;
    const body = new URLSearchParams({
      client_id:this.config.clientId,
      client_secret:this.config.clientSecret,
      refresh_token:this.config.refreshToken,
      grant_type:'refresh_token',
    });
    const response = await this.fetcher('https://oauth2.googleapis.com/token',{
      method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body,
    });
    if (!response.ok) throw providerError('drive_oauth_refresh_failed',response.status);
    const value = await response.json() as {access_token?:unknown;expires_in?:unknown};
    if (typeof value.access_token !== 'string' || value.access_token.length < 1
      || !Number.isSafeInteger(value.expires_in) || Number(value.expires_in) < 60) {
      throw new Error('drive_oauth_response_invalid');
    }
    this.accessToken={value:value.access_token,expiresAt:now+Number(value.expires_in)*1000};
    return value.access_token;
  }
}

function validateConfig(config:GoogleDriveArchiveConfig):void {
  for (const value of [config.clientId,config.clientSecret,config.refreshToken,config.folderId,config.ownerAccountKey]) {
    if (!safeId(value,500)) throw new Error('invalid_drive_archive_config');
  }
}
function safeId(value:string,maximum:number):boolean { return value.length>=1 && value.length<=maximum && !/[\u0000-\u001f\u007f]/u.test(value); }
function safeResumableSession(value:string):boolean {
  if(!safeId(value,500)) return false;
  try { const url=new URL(value); return url.protocol==='https:'&&url.hostname==='www.googleapis.com'; }
  catch { return false; }
}
function resumeOffset(range:string|null,total:number):number {
  if(range===null) return 0;
  const match=/^bytes=0-(\d+)$/u.exec(range);
  if(!match) throw new Error('drive_upload_range_invalid');
  const last=Number(match[1]);
  if(!Number.isSafeInteger(last)||last<0||last>=total) throw new Error('drive_upload_range_invalid');
  return last+1;
}
async function responseFileId(response:Response):Promise<string> {
  const body=await response.json() as {id?:unknown};
  if(typeof body.id!=='string'||!safeId(body.id,500)) throw new Error('drive_upload_response_invalid');
  return body.id;
}
function completed(fileId:string,config:GoogleDriveArchiveConfig):DriveArchiveUploadResult {
  return {completed:true,fileId,folderId:config.folderId,
    ownerAccountKey:config.ownerAccountKey,resumeSessionKey:null};
}
function isMime(value:string|undefined):value is SupportedFileMime { return value==='image/jpeg'||value==='image/png'||value==='image/webp'||value==='application/pdf'; }
function providerError(code:string,status:number):Error {
  const error=new Error(code==='drive_read_failed'&&status===404?'drive_missing':code);
  error.name=status===401||status===403?'DriveAuthorizationError':'DriveProviderError';
  return error;
}
