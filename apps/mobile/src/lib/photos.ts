import { PHOTO_JPEG_QUALITY, PHOTO_MAX_PX, type PhotoPurpose, type UploadTicket } from '@despacho/shared';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { api } from './api';

/** Foto já redimensionada, pronta para enviar. */
export interface Photo {
  uri: string;
}

/**
 * Escolhe uma foto na galeria (ou câmera) e a redimensiona antes de qualquer envio: no máximo 1000 px no
 * lado maior, JPEG ~80% (CLAUDE.md). Devolve null se a pessoa cancelar ou negar a permissão.
 */
export async function pickPhoto(source: 'library' | 'camera' = 'library'): Promise<Photo | null> {
  const permission =
    source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return null;
  const picked =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
  if (picked.canceled) return null;
  const asset = picked.assets[0];

  const context = ImageManipulator.manipulate(asset.uri);
  if (Math.max(asset.width, asset.height) > PHOTO_MAX_PX) {
    context.resize(asset.width >= asset.height ? { width: PHOTO_MAX_PX } : { height: PHOTO_MAX_PX });
  }
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: PHOTO_JPEG_QUALITY });
  return { uri: saved.uri };
}

/** Envia a foto direto ao storage por URL assinada e devolve a chave para usar no pedido ou na mensagem. */
export async function uploadPhoto(photo: Photo, purpose: PhotoPurpose, companyId: string): Promise<string> {
  const blob = await (await fetch(photo.uri)).blob();
  const ticket = await api<UploadTicket & { key: string }>('/company/uploads', {
    method: 'POST',
    body: { purpose, contentLength: blob.size },
    companyId,
  });
  const res = await fetch(ticket.uploadUrl, { method: 'PUT', headers: ticket.headers, body: blob });
  if (!res.ok) throw new Error('Não foi possível enviar a foto. Tente de novo.');
  return ticket.key;
}
