import { describe,expect,it } from 'vitest';
import { GoogleDriveArchiveAdapter } from './drive-adapter';

const png=new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1]);
describe('Google Drive HTTP adapter contract',()=>{
  it('refreshes server-side OAuth, uses resumable upload and reads bytes back without real network',async()=>{
    const calls:{url:string;init:RequestInit|undefined}[]=[];
    const fetcher=async(input:RequestInfo|URL,init?:RequestInit):Promise<Response>=>{
      const url=String(input); calls.push({url,init});
      if(url.includes('oauth2.googleapis.com')) return Response.json({access_token:'test-access',expires_in:3600});
      if(url.includes('upload_id=session-1')) return Response.json({id:'drive-file-1'});
      if(url.includes('uploadType=resumable')) return new Response(null,{status:200,headers:{Location:'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=session-1'}});
      return new Response(png,{status:200,headers:{'Content-Type':'image/png'}});
    };
    const adapter=new GoogleDriveArchiveAdapter({clientId:'client',clientSecret:'secret',refreshToken:'refresh',
      folderId:'folder',ownerAccountKey:'owner'},fetcher);
    const uploaded=await adapter.upload({fileObjectId:'file-1',fileName:'evidence.png',mimeType:'image/png',
      byteSize:png.byteLength,sha256:'a'.repeat(64),bytes:png});
    expect(uploaded).toEqual({completed:true,fileId:'drive-file-1',folderId:'folder',ownerAccountKey:'owner',resumeSessionKey:null});
    expect(await adapter.readFile('drive-file-1')).toEqual({bytes:png,mimeType:'image/png',byteSize:png.byteLength});
    expect(calls.filter((call)=>call.url.includes('oauth2.googleapis.com'))).toHaveLength(1);
    expect(String(calls[1]?.init?.body)).toContain('ygb_file_object_id');
    expect(JSON.stringify(uploaded)).not.toContain('access');
  });
  it('classifies revoked OAuth without exposing the provider body',async()=>{
    const adapter=new GoogleDriveArchiveAdapter({clientId:'client',clientSecret:'secret',refreshToken:'refresh',
      folderId:'folder',ownerAccountKey:'owner'},async()=>new Response('sensitive provider body',{status:401}));
    await expect(adapter.readFile('file-1')).rejects.toMatchObject({name:'DriveAuthorizationError',
      message:'drive_oauth_refresh_failed'});
  });
  it('queries a resumable session and continues from the accepted byte offset',async()=>{
    const uploads:{range:string|null;length:string|null;bodyBytes:number}[]=[];
    let calls=0;
    const adapter=new GoogleDriveArchiveAdapter({clientId:'client',clientSecret:'secret',refreshToken:'refresh',
      folderId:'folder',ownerAccountKey:'owner'},async(_input,init)=>{
        calls+=1;
        if(calls===1) return Response.json({access_token:'test-access',expires_in:3600});
        if(calls===2) return new Response(null,{status:308,headers:{Range:'bytes=0-3'}});
        const body=init?.body as Uint8Array;
        uploads.push({range:new Headers(init?.headers).get('Content-Range'),
          length:new Headers(init?.headers).get('Content-Length'),bodyBytes:body.byteLength});
        return Response.json({id:'drive-file-resumed'});
      });
    const result=await adapter.upload({fileObjectId:'file-1',fileName:'evidence.png',mimeType:'image/png',
      byteSize:png.byteLength,sha256:'a'.repeat(64),bytes:png,
      resumeSessionKey:'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=session-2'});
    expect(result.fileId).toBe('drive-file-resumed');
    expect(uploads).toEqual([{range:`bytes 4-${png.byteLength-1}/${png.byteLength}`,
      length:String(png.byteLength-4),bodyBytes:png.byteLength-4}]);
  });
  it('classifies a missing archived file without exposing the provider body',async()=>{
    let calls=0;
    const adapter=new GoogleDriveArchiveAdapter({clientId:'client',clientSecret:'secret',refreshToken:'refresh',
      folderId:'folder',ownerAccountKey:'owner'},async()=>{
        calls+=1;
        return calls===1?Response.json({access_token:'test-access',expires_in:3600})
          :new Response('sensitive provider body',{status:404});
      });
    await expect(adapter.readFile('file-1')).rejects.toMatchObject({name:'DriveProviderError',
      message:'drive_missing'});
  });
});
