import { Icon } from '@/components/ui/icon';
import { Modal, ModalBackdrop, ModalBody, ModalContent } from '@/components/ui/modal';
import { Text } from '@/components/ui/text';
import { copyImageAsSticker, copyImageToClipboard } from '@/services/image-storage';
import { showToast } from '@/utils/toast';
import { Image } from 'expo-image';
import { Copy, ImageIcon, PlayCircle, Wand2, X } from 'lucide-react-native';
import { MotiView } from 'moti';
import React, { memo, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import PagerView from 'react-native-pager-view';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MediaActions } from './media-actions';
import { ProgressOverlay } from './progress-overlay';
import { ZoomableMedia } from './zoomable-media';

import { useGenerationProgress, useGenerationStatus } from '@/features/generation/context/generation-context';

import { useVideoPlayer, VideoView } from 'expo-video';

const VIDEO_EXTENSIONS = ['mp4', 'mov', 'm4v', 'webm'];

const isVideoUrl = (url: string): boolean => {
  const ext = url.split('.').pop()?.toLowerCase() || '';
  return VIDEO_EXTENSIONS.includes(ext);
};

interface ParallaxMediaProps {
  workflowId?: string;
  serverId?: string;
}

const VideoPreview = ({ url }: { url: string }) => {
  const player = useVideoPlayer(url, (player) => {
    player.loop = false;
    player.pause();
    player.muted = true;
  });

  return (
    <VideoView player={player} style={{ width: '100%', height: '100%' }} contentFit="contain" nativeControls={false} />
  );
};

/**
 * A component that displays media with parallax scrolling effect and preview functionality
 */
export const MediaPreview = memo(function ParallaxMedia({ workflowId, serverId }: ParallaxMediaProps) {
  const { generatedMedia, status } = useGenerationStatus();
  const { progress } = useGenerationProgress();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [showActionsheet, setShowActionsheet] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const safeAreaInsets = useSafeAreaInsets();
  const pagerRef = useRef<PagerView>(null);
  const modalPagerRef = useRef<PagerView>(null);

  // Sync active index when media change (e.g. new generation)
  useEffect(() => {
    if (generatedMedia.length > 0) {
      setActiveIndex(0);
    }
  }, [generatedMedia]);

  const handlePageSelected = (e: any) => {
    setActiveIndex(e.nativeEvent.position);
  };

  // When modal closes, sync the main pager to the last viewed index
  const handleModalClose = () => {
    pagerRef.current?.setPageWithoutAnimation(activeIndex);
    setIsPreviewOpen(false);
  };

  const handleZoomableMediaClose = () => {
    handleModalClose();
  };

  const handleZoomableMediaLongPress = () => {
    setShowActionsheet(true);
  };

  const handleCopySticker = async (mediaUrl = generatedMedia[activeIndex]) => {
    if (!mediaUrl || isVideoUrl(mediaUrl)) return;

    if (Platform.OS !== 'ios') {
      showToast.error('iOS only', 'Stickers are only available on iOS.', safeAreaInsets.top + 8);
      return;
    }

    try {
      await copyImageAsSticker(mediaUrl);
      showToast.success('Sticker copied', 'Paste it in Messages to send as a sticker.', safeAreaInsets.top + 8);
    } catch (error) {
      console.error('Failed to copy sticker:', error);
      showToast.error('Sticker Failed', 'Unable to create a sticker from this image.', safeAreaInsets.top + 8);
    }
  };

  const handleCopyEntireImage = async (mediaUrl = generatedMedia[activeIndex]) => {
    if (!mediaUrl || isVideoUrl(mediaUrl)) return;

    try {
      await copyImageToClipboard(mediaUrl);
      showToast.success('Image copied', undefined, safeAreaInsets.top + 8);
    } catch (error) {
      console.error('Failed to copy image:', error);
      showToast.error('Copy Failed', 'Unable to copy the image.', safeAreaInsets.top + 8);
    }
  };

  return (
    <View
      className="relative w-full flex-1 flex-col items-start justify-start"
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setContainerSize({ width, height });
      }}
    >
      {generatedMedia.length > 0 ? (
        <View className="h-auto w-full flex-1 justify-start">
          <PagerView
            key={generatedMedia.join('-')}
            ref={pagerRef}
            style={{ flex: 1, width: '100%' }}
            initialPage={0}
            onPageSelected={handlePageSelected}
          >
            {generatedMedia.map((mediaUrl, index) => (
              <View key={`${mediaUrl}-${index}`} className="flex-1">
                <Pressable className="flex-1" onPress={() => setIsPreviewOpen(true)}>
                  {isVideoUrl(mediaUrl) ? (
                    <View className="bg-black flex-1 items-center justify-center">
                      <VideoPreview url={mediaUrl} />
                      <View className="inset-0 bg-black/20 absolute items-center justify-center">
                        <Icon as={PlayCircle} className="text-white h-12 w-12 opacity-90" />
                      </View>
                    </View>
                  ) : (
                    <View className="flex-1">
                      <Image
                        source={{ uri: mediaUrl }}
                        style={{
                          width: containerSize.width || screenWidth,
                          height: containerSize.height || screenHeight,
                          aspectRatio: undefined,
                        }}
                        contentFit="contain"
                        contentPosition="top"
                        cachePolicy="memory-disk"
                      />
                      <View className="right-3 bottom-3 gap-2 absolute flex-row">
                        {Platform.OS === 'ios' && (
                          <Pressable
                            accessibilityLabel="Copy image subject as sticker"
                            onPress={(event) => {
                              event.stopPropagation?.();
                              handleCopySticker(mediaUrl);
                            }}
                            className="h-10 w-10 bg-black/55 items-center justify-center rounded-full"
                          >
                            <Icon as={Wand2} size="sm" className="text-white" />
                          </Pressable>
                        )}
                        <Pressable
                          accessibilityLabel="Copy entire image"
                          onPress={(event) => {
                            event.stopPropagation?.();
                            handleCopyEntireImage(mediaUrl);
                          }}
                          className="h-10 w-10 bg-black/55 items-center justify-center rounded-full"
                        >
                          <Icon as={Copy} size="sm" className="text-white" />
                        </Pressable>
                      </View>
                    </View>
                  )}
                </Pressable>
              </View>
            ))}
          </PagerView>

          {/* Page Indicator */}
          {generatedMedia.length > 1 && (
            <View className="bottom-4 left-0 right-0 gap-2 absolute flex-row justify-center">
              {generatedMedia.map((_, index) => (
                <View
                  key={index}
                  className={`h-2 w-2 rounded-full ${index === activeIndex ? 'bg-primary-500' : 'bg-border-300'}`}
                />
              ))}
            </View>
          )}

          {/* Status Indicators */}
          <View className="top-3 right-3 gap-2 absolute flex-row">
            <View className="bg-black/50 px-2.5 py-1 min-w-[48px] items-center justify-center rounded-full">
              <Text className="text-xs font-medium text-white text-center">
                {isVideoUrl(generatedMedia[activeIndex] || '') ? 'Video' : 'Image'}
              </Text>
            </View>
            {generatedMedia.length > 1 && (
              <View className="bg-black/50 px-2.5 py-1 min-w-[48px] items-center justify-center rounded-full">
                <Text className="text-xs font-medium text-white text-center">
                  {activeIndex + 1}/{generatedMedia.length}
                </Text>
              </View>
            )}
          </View>

          <Modal
            isOpen={isPreviewOpen}
            onClose={handleModalClose}
            useRNModal={false}
            avoidKeyboard={false}
            closeOnOverlayClick
            size="full"
            className="m-0 p-0"
          >
            <ModalBackdrop />
            <ModalContent
              className="m-0 bg-black p-0 h-full rounded-none border-0"
              style={{ shadowColor: 'transparent', elevation: 0 }}
              transition={{
                type: 'timing',
                duration: 250,
              }}
            >
              <ModalBody
                className="p-0 h-full flex-1"
                contentContainerStyle={{
                  flex: 1,
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                  margin: 0,
                }}
              >
                {isPreviewOpen && (
                  <PagerView
                    key={generatedMedia.join('-')}
                    ref={modalPagerRef}
                    style={{ flex: 1, width: '100%', height: '100%' }}
                    initialPage={activeIndex}
                    onPageSelected={handlePageSelected}
                  >
                    {generatedMedia.map((mediaUrl, index) => (
                      <View key={`modal-${mediaUrl}-${index}`} className="flex-1">
                        <ZoomableMedia
                          mediaUrl={mediaUrl}
                          onClose={handleZoomableMediaClose}
                          onLongPress={handleZoomableMediaLongPress}
                        />
                      </View>
                    ))}
                  </PagerView>
                )}

                <MotiView
                  from={{ opacity: 1 }}
                  animate={{ opacity: 0 }}
                  transition={{ type: 'timing', duration: 300, delay: 2000 }}
                  className="bottom-16 left-0 right-0 pointer-events-none absolute items-center justify-center"
                >
                  <Text className="text-sm font-medium text-white/70">Long press to open menu</Text>
                </MotiView>

                {generatedMedia.length > 1 && (
                  <View className="bottom-8 left-0 right-0 gap-2 pointer-events-none absolute flex-row justify-center">
                    {generatedMedia.map((_, index) => (
                      <View
                        key={index}
                        className={`h-2 w-2 rounded-full ${index === activeIndex ? 'bg-white' : 'bg-white/50'}`}
                      />
                    ))}
                  </View>
                )}

                <TouchableOpacity
                  activeOpacity={0.5}
                  onPress={handleModalClose}
                  style={{
                    position: 'absolute',
                    top: safeAreaInsets.top + 12,
                    right: 12,
                    backgroundColor: 'rgba(0,0,0,0.3)',
                    borderRadius: 8,
                    padding: 8,
                    zIndex: 30,
                  }}
                >
                  <Icon as={X} size="sm" className="text-white" />
                </TouchableOpacity>
              </ModalBody>
              <MediaActions
                isOpen={showActionsheet}
                onClose={() => setShowActionsheet(false)}
                mediaUrl={generatedMedia[activeIndex]}
                workflowId={workflowId}
                serverId={serverId}
              />
            </ModalContent>
          </Modal>
        </View>
      ) : (
        <View className="bg-background-0 h-full w-full items-center justify-center">
          <View className="gap-4 px-6 items-center">
            <View className="bg-background-50 p-3 rounded-full">
              <Icon as={ImageIcon} size="xl" className="h-10 w-10 text-typography-300" />
            </View>
            <View className="gap-1 items-center">
              <Text className="text-base font-semibold text-typography-800">No Media Yet</Text>
              <Text className="text-sm text-typography-500 text-center">
                Generate an image to preview results here.
              </Text>
              {status === 'generating' && progress.max > 0 && (
                <Text className="text-xs text-typography-400">
                  Generating... {Math.round((progress.value / progress.max) * 100)}%
                </Text>
              )}
            </View>
          </View>
        </View>
      )}

      {status === 'generating' && progress.value > 0 && progress.value < progress.max && (
        <ProgressOverlay current={progress.value} total={progress.max} />
      )}
    </View>
  );
});
