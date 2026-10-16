import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Global, Inject, Injectable, Module, ServiceUnavailableException } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config.js';

export interface UploadTicket {
  /** Endereço para enviar o arquivo (PUT). */
  uploadUrl: string;
  /** Cabeçalhos que o app precisa mandar junto, tal como assinados. */
  headers: Record<string, string>;
}

/** Fotos do pedido e do chat vão direto do app para o storage por URL assinada (ADR 0005 e 0009). */
export abstract class Storage {
  abstract presignUpload(key: string, contentLength: number): Promise<UploadTicket>;
  abstract presignRead(key: string): Promise<string>;
}

const UPLOAD_TTL_S = 10 * 60;
/** Links de leitura valem 1 h: a API os gera a cada resposta, depois de conferir o acesso. */
const READ_TTL_S = 60 * 60;

/** Cloudflare R2 (compatível com S3). Um bucket por ambiente. */
@Injectable()
export class R2Storage extends Storage {
  private client: S3Client | null = null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    super();
  }

  async presignUpload(key: string, contentLength: number): Promise<UploadTicket> {
    const { client, bucket } = this.connection();
    const uploadUrl = await getSignedUrl(
      client,
      new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: 'image/jpeg', ContentLength: contentLength }),
      { expiresIn: UPLOAD_TTL_S, signableHeaders: new Set(['content-type', 'content-length']) },
    );
    return { uploadUrl, headers: { 'content-type': 'image/jpeg' } };
  }

  presignRead(key: string): Promise<string> {
    const { client, bucket } = this.connection();
    return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: READ_TTL_S });
  }

  private connection(): { client: S3Client; bucket: string } {
    const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = this.config;
    if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
      throw new ServiceUnavailableException('Armazenamento de fotos não configurado');
    }
    this.client ??= new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    });
    return { client: this.client, bucket: R2_BUCKET };
  }
}

@Global()
@Module({ providers: [{ provide: Storage, useClass: R2Storage }], exports: [Storage] })
export class StorageModule {}
