import { Storage, type UploadTicket } from '../../src/storage/storage.js';

/** Storage falso: não guarda nada; só devolve endereços previsíveis para os testes conferirem. */
export class FakeStorage extends Storage {
  readonly uploads: { key: string; contentLength: number }[] = [];
  readonly deleted: string[] = [];

  async presignUpload(key: string, contentLength: number): Promise<UploadTicket> {
    this.uploads.push({ key, contentLength });
    return { uploadUrl: `https://storage.test/upload/${key}`, headers: { 'content-type': 'image/jpeg' } };
  }

  async presignRead(key: string): Promise<string> {
    return `https://storage.test/read/${key}`;
  }

  async delete(key: string): Promise<void> {
    this.deleted.push(key);
  }
}
