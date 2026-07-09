import { Workflow } from '@/features/workflow/types';
import { generateUUID } from '@/utils/uuid';
import { createSubjectCutoutAsync } from 'comfy-subject-cutout';
import * as Clipboard from 'expo-clipboard';
import { Directory, File, Paths } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

interface SaveMediaOptions {
  serverId: string;
  workflowId: string;
  mediaUrl: string;
  workflow: Workflow;
  prompt?: string;
  delete?: boolean;
}

export interface ImageCropRect {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

export interface ImageDimensions {
  width: number;
  height: number;
}

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'heic', 'heif'];
const MIME_TYPES_BY_EXTENSION: Record<string, string> = {
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};
const IOS_UTI_BY_EXTENSION: Record<string, string> = {
  gif: 'com.compuserve.gif',
  heic: 'public.heic',
  heif: 'public.heif',
  jpeg: 'public.jpeg',
  jpg: 'public.jpeg',
  png: 'public.png',
  webp: 'org.webmproject.webp',
};

function getGeneratedDir(serverId: string, workflowId: string) {
  return new Directory(Paths.document, 'server', serverId, 'workflows', workflowId, 'generated');
}

function getThumbnailDir(serverId: string, workflowId: string) {
  return new Directory(Paths.document, 'server', serverId, 'workflows', workflowId, 'thumbnail');
}

function getStickerDir() {
  return new Directory(Paths.document, 'stickers');
}

function getStickerSourceDir() {
  return new Directory(Paths.cache, 'sticker-sources');
}

function ensureDirectory(dir: Directory) {
  dir.create({ intermediates: true, idempotent: true });
}

function getFileExtension(uri: string) {
  return uri.split('?')[0].split('#')[0].split('.').pop()?.toLowerCase();
}

function isImageUri(uri: string) {
  const ext = getFileExtension(uri);
  return Boolean(ext && IMAGE_EXTENSIONS.includes(ext));
}

async function saveImageToPhotoLibrary(uri: string) {
  if (Platform.OS === 'web' || !isImageUri(uri)) return false;

  try {
    const permission = await MediaLibrary.requestPermissionsAsync(true);
    if (!permission.granted) {
      return false;
    }

    await MediaLibrary.saveToLibraryAsync(uri);
    return true;
  } catch (error) {
    console.warn('Failed to auto-save generated image:', error);
    return false;
  }
}

export async function saveGeneratedMedia({
  serverId,
  workflowId,
  mediaUrl,
  workflow,
  prompt,
  delete: shouldDelete,
}: SaveMediaOptions) {
  try {
    const generatedDir = getGeneratedDir(serverId, workflowId);

    if (shouldDelete) {
      const filename = mediaUrl.split('/').pop()?.split('?')[0];
      if (!filename) throw new Error('Invalid media URL');

      new File(generatedDir, filename).delete();
      try {
        new File(generatedDir, `${filename}.json`).delete();
      } catch (error) {
        void error;
        // Ignore if metadata file doesn't exist
      }
      return;
    }

    ensureDirectory(generatedDir);

    const uuid = await generateUUID();
    const timestamp = new Date().toISOString();
    const originalExt = mediaUrl.split('.').pop()?.split('?')[0] || 'png';
    const filename = `${timestamp}-${uuid}.${originalExt}`;

    const mediaFile = new File(generatedDir, filename);
    if (mediaUrl.startsWith('file://')) {
      new File(mediaUrl).copy(mediaFile);
    } else {
      await File.downloadFileAsync(mediaUrl, mediaFile, { idempotent: true });
    }

    const savedToPhotoLibrary = await saveImageToPhotoLibrary(mediaFile.uri);

    const metadataFile = new File(generatedDir, `${filename}.json`);
    metadataFile.create({ intermediates: true, overwrite: true });

    const metadata = {
      timestamp,
      workflow,
      originalUrl: mediaUrl,
      savedToPhotoLibrary,
      ...(prompt ? { prompt } : {}),
    };

    metadataFile.write(JSON.stringify(metadata, null, 2), { encoding: 'utf8' });

    return {
      path: mediaFile.uri,
      metadata,
    };
  } catch (error) {
    console.error('Failed to save/delete generated media:', error);
    throw error;
  }
}

export async function createStickerFromImage(imageUri: string) {
  if (!isImageUri(imageUri)) {
    throw new Error('Only image files can be used as stickers.');
  }

  const stickerDir = getStickerDir();
  ensureDirectory(stickerDir);

  const uuid = await generateUUID();
  const timestamp = new Date().toISOString();
  const ext = getFileExtension(imageUri) || 'png';
  const stickerFile = new File(stickerDir, `${timestamp}-${uuid}.${ext}`);

  new File(imageUri).copy(stickerFile);

  return {
    path: stickerFile.uri,
  };
}

export async function getImageDimensions(imageUri: string): Promise<ImageDimensions> {
  if (!isImageUri(imageUri)) {
    throw new Error('Only image files have dimensions.');
  }

  const image = await manipulateAsync(imageUri, [], {
    compress: 1,
    format: SaveFormat.PNG,
  });

  return {
    width: image.width,
    height: image.height,
  };
}

export async function createStickerFromFocusedImage(imageUri: string, crop: ImageCropRect) {
  if (!isImageUri(imageUri)) {
    throw new Error('Only image files can be used as stickers.');
  }

  const croppedImage = await manipulateAsync(
    imageUri,
    [
      {
        crop: {
          originX: Math.max(0, Math.floor(crop.originX)),
          originY: Math.max(0, Math.floor(crop.originY)),
          width: Math.max(1, Math.floor(crop.width)),
          height: Math.max(1, Math.floor(crop.height)),
        },
      },
    ],
    {
      compress: 1,
      format: SaveFormat.PNG,
    },
  );

  return createStickerFromImage(croppedImage.uri);
}

async function getLocalImageForSubjectCutout(imageUri: string) {
  if (imageUri.startsWith('file://')) {
    return imageUri;
  }

  if (!imageUri.startsWith('http://') && !imageUri.startsWith('https://')) {
    return imageUri;
  }

  const sourceDir = getStickerSourceDir();
  ensureDirectory(sourceDir);

  const uuid = await generateUUID();
  const ext = getFileExtension(imageUri) || 'png';
  const sourceFile = new File(sourceDir, `${uuid}.${ext}`);
  await File.downloadFileAsync(imageUri, sourceFile, { idempotent: true });
  return sourceFile.uri;
}

export async function createSubjectStickerFromImage(imageUri: string) {
  if (!isImageUri(imageUri)) {
    throw new Error('Only image files can be used as stickers.');
  }

  const localImageUri = await getLocalImageForSubjectCutout(imageUri);
  const subject = await createSubjectCutoutAsync(localImageUri);
  return createStickerFromImage(subject.uri);
}

export async function copyImageToClipboard(imageUri: string) {
  if (!isImageUri(imageUri)) {
    throw new Error('Only image files can be copied as images.');
  }

  const base64Image = await new File(imageUri).base64();
  await Clipboard.setImageAsync(base64Image);
}

export async function copyImageAsSticker(imageUri: string) {
  const sticker = await createSubjectStickerFromImage(imageUri);
  await copyImageToClipboard(sticker.path);
  return sticker;
}

export async function copyFocusedImageAsSticker(imageUri: string, crop: ImageCropRect) {
  void crop;
  const sticker = await createSubjectStickerFromImage(imageUri);
  await copyImageToClipboard(sticker.path);
  return sticker;
}

export async function shareImageAsSticker(imageUri: string) {
  const sticker = await createStickerFromImage(imageUri);
  const isShareAvailable = await Sharing.isAvailableAsync();

  if (!isShareAvailable) {
    throw new Error('Sharing is not available on this device.');
  }

  const ext = getFileExtension(sticker.path) || 'png';
  await Sharing.shareAsync(sticker.path, {
    mimeType: MIME_TYPES_BY_EXTENSION[ext] || 'image/png',
    UTI: IOS_UTI_BY_EXTENSION[ext] || 'public.png',
  });

  return sticker;
}

export async function getGeneratedMedia(serverId: string, workflowId: string) {
  try {
    const generatedDir = getGeneratedDir(serverId, workflowId);
    const dirInfo = Paths.info(generatedDir.uri);

    if (!dirInfo.exists) {
      ensureDirectory(generatedDir);
    } else if (dirInfo.isDirectory === false) {
      new File(generatedDir.uri).delete();
      ensureDirectory(generatedDir);
    }

    const supportedExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.mp4', '.gif', '.mov'];
    const mediaFiles = generatedDir
      .list()
      .filter((entry): entry is File => entry instanceof File)
      .filter((file) => supportedExtensions.some((ext) => file.name.toLowerCase().endsWith(ext)));

    return Promise.all(
      mediaFiles.map(async (file) => {
        const metadataFile = new File(generatedDir, `${file.name}.json`);
        try {
          const metadataStr = await metadataFile.text();
          const metadata = JSON.parse(metadataStr);
          return { path: file.uri, metadata };
        } catch (error) {
          void error;
          return { path: file.uri, metadata: null };
        }
      }),
    );
  } catch (error) {
    console.error('failed to get generated media:', error);
    return [];
  }
}

export async function loadHistoryMedia(serverId: string, workflowId: string) {
  try {
    const mediaItems = await getGeneratedMedia(serverId, workflowId);

    return mediaItems
      .filter((item) => item.metadata)
      .map((item) => ({
        url: item.path,
        timestamp: new Date(item.metadata.timestamp).getTime(),
      }))
      .sort((a, b) => b.timestamp - a.timestamp);
  } catch (error) {
    console.error('failed to load history media:', error);
    return [];
  }
}

export async function loadHistoryMediaWithPrompt(serverId: string, workflowId: string) {
  try {
    const mediaItems = await getGeneratedMedia(serverId, workflowId);

    return mediaItems
      .filter((item) => item.metadata)
      .map((item) => ({
        url: item.path,
        prompt: item.metadata.prompt as string | undefined,
        timestamp: new Date(item.metadata.timestamp).getTime(),
      }))
      .sort((a, b) => b.timestamp - a.timestamp);
  } catch (error) {
    console.error('failed to load history media with prompt:', error);
    return [];
  }
}

export async function loadAllHistoryMediaWithPrompt() {
  try {
    const serverDir = new Directory(Paths.document, 'server');
    const serverInfo = Paths.info(serverDir.uri);
    if (!serverInfo.exists || serverInfo.isDirectory === false) {
      return [];
    }

    const allItems: {
      url: string;
      prompt?: string;
      timestamp: number;
      serverId: string;
      workflowId: string;
    }[] = [];

    for (const entry of serverDir.list()) {
      if (!(entry instanceof Directory)) continue;
      const serverId = entry.name;
      const workflowsDir = new Directory(Paths.document, 'server', serverId, 'workflows');
      const workflowsInfo = Paths.info(workflowsDir.uri);
      if (!workflowsInfo.exists || workflowsInfo.isDirectory === false) continue;

      for (const workflowEntry of workflowsDir.list()) {
        if (!(workflowEntry instanceof Directory)) continue;
        const workflowId = workflowEntry.name;
        const items = await loadHistoryMediaWithPrompt(serverId, workflowId);
        allItems.push(
          ...items.map((item) => ({
            ...item,
            serverId,
            workflowId,
          })),
        );
      }
    }

    return allItems.sort((a, b) => b.timestamp - a.timestamp);
  } catch (error) {
    console.error('failed to load all history media with prompt:', error);
    return [];
  }
}

export async function saveWorkflowThumbnail({
  serverId,
  workflowId,
  imageUri,
  delete: shouldDelete,
  mimeType,
}: {
  serverId: string;
  workflowId: string;
  imageUri: string;
  delete?: boolean;
  mimeType?: string;
}) {
  try {
    const thumbnailDir = getThumbnailDir(serverId, workflowId);

    if (shouldDelete) {
      try {
        thumbnailDir.delete();
      } catch (error) {
        void error;
        // Ignore if directory doesn't exist
      }
      return;
    }

    ensureDirectory(thumbnailDir);

    // Keep only one thumbnail file.
    try {
      const files = thumbnailDir.list().filter((entry): entry is File => entry instanceof File);
      files.forEach((file) => {
        try {
          file.delete();
        } catch (error) {
          void error;
          // Ignore cleanup failures
        }
      });
    } catch (error) {
      void error;
      // Directory might not exist yet, which is fine
    }

    let ext: string;
    if (mimeType) {
      switch (mimeType) {
        case 'image/jpeg':
          ext = 'jpg';
          break;
        case 'image/png':
          ext = 'png';
          break;
        case 'image/webp':
          ext = 'webp';
          break;
        case 'image/heic':
          ext = 'heic';
          break;
        default:
          ext = mimeType.split('/')[1] || 'jpg';
      }
    } else {
      ext = imageUri.split('.').pop()?.toLowerCase() || 'jpg';
    }

    const thumbnailFile = new File(thumbnailDir, `thumbnail.${ext}`);
    new File(imageUri).copy(thumbnailFile);

    const fileInfo = thumbnailFile.info();
    if (!fileInfo.exists) {
      throw new Error('Failed to verify thumbnail file exists after saving');
    }

    return {
      path: thumbnailFile.uri,
    };
  } catch (error) {
    console.error('failed to save/delete workflow thumbnail:', error);
    throw error;
  }
}

export async function cleanupServerData(serverId: string) {
  try {
    const serverDir = new Directory(Paths.document, 'server', serverId);
    try {
      serverDir.delete();
    } catch (error) {
      void error;
      // Ignore if directory doesn't exist
    }
  } catch (error) {
    console.error('failed to cleanup server data:', error);
  }
}

export async function cleanupWorkflowData(serverId: string, workflowId: string) {
  try {
    const workflowDir = new Directory(Paths.document, 'server', serverId, 'workflows', workflowId);
    try {
      workflowDir.delete();
    } catch (error) {
      void error;
      // Ignore if directory doesn't exist
    }
  } catch (error) {
    console.error('failed to cleanup workflow data:', error);
  }
}
