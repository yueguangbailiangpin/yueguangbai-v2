import type {
  DriveArchiveAdapter,
  DriveArchiveReadResult,
  DriveArchiveUploadInput,
  DriveArchiveUploadResult,
} from '@ygb/contracts';

export class MockDriveArchiveAdapter implements DriveArchiveAdapter {
  readonly files = new Map<string, DriveArchiveReadResult>();
  uploadCalls = 0;
  readCalls = 0;
  private failures = new Set<'upload'|'read'>();
  private interruptions = 0;

  failNext(operation:'upload'|'read'):void { this.failures.add(operation); }
  interruptNextUpload():void { this.interruptions += 1; }

  async upload(input:DriveArchiveUploadInput):Promise<DriveArchiveUploadResult> {
    this.uploadCalls += 1;
    if (this.failures.delete('upload')) throw new Error('mock_drive_upload_failed');
    const session=input.resumeSessionKey??`mock-session:${input.fileObjectId}`;
    if (this.interruptions>0) {
      this.interruptions -= 1;
      return {completed:false,fileId:null,folderId:'mock-folder',ownerAccountKey:'mock-owner',resumeSessionKey:session};
    }
    const fileId=`mock-drive:${input.fileObjectId}`;
    this.files.set(fileId,{bytes:copy(input.bytes),mimeType:input.mimeType,byteSize:input.byteSize});
    return {completed:true,fileId,folderId:'mock-folder',ownerAccountKey:'mock-owner',resumeSessionKey:null};
  }

  async readFile(fileId:string):Promise<DriveArchiveReadResult> {
    this.readCalls += 1;
    if (this.failures.delete('read')) throw new Error('mock_drive_read_failed');
    const file=this.files.get(fileId);
    if (!file) throw new Error('mock_drive_file_missing');
    return {bytes:copy(file.bytes),mimeType:file.mimeType,byteSize:file.byteSize};
  }

  tamper(fileId:string,patch:Partial<DriveArchiveReadResult>):void {
    const file=this.files.get(fileId);
    if (!file) throw new Error('mock_drive_file_missing');
    this.files.set(fileId,{...file,...patch,bytes:patch.bytes?copy(patch.bytes):file.bytes});
  }
}
function copy(input:Uint8Array<ArrayBufferLike>):Uint8Array<ArrayBuffer> { const value=new Uint8Array(input.byteLength); value.set(input); return value; }
